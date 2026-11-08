"""Reads scanned assets into plain arrays, split into separate plants or rocks, ready to place in the tank."""
from dataclasses import dataclass
from pathlib import Path

import bmesh
import bpy
import numpy as np

CACHE = Path(__file__).parent / "cache" / "polyhaven"


@dataclass(frozen=True)
class Template:
    """One scanned object in world axes (x right, y up, z toward the viewer), its base at the origin."""
    material: bpy.types.Material
    vertices: np.ndarray
    faces: np.ndarray
    uvs: np.ndarray

    @property
    def height(self) -> float:
        return float(self.vertices[:, 1].max() - self.vertices[:, 1].min())

    @property
    def size(self) -> float:
        return float((self.vertices.max(axis=0) - self.vertices.min(axis=0)).max())


def _connected_groups(vertex_count: int, faces: np.ndarray) -> np.ndarray:
    parent = np.arange(vertex_count)

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    for a, b, c in faces:
        ra, rb, rc = find(a), find(b), find(c)
        parent[rb] = ra
        parent[rc] = ra
    return np.array([find(index) for index in range(vertex_count)])


def _cluster_islands(vertices: np.ndarray, faces: np.ndarray, gap: float) -> np.ndarray:
    """Groups mesh islands that sit close together, so that the leaves of one plant stay together."""
    groups = _connected_groups(vertices.shape[0], faces)
    labels = np.unique(groups)
    centres = np.array([vertices[groups == label].mean(axis=0) for label in labels])[:, [0, 2]]
    cluster = np.arange(labels.shape[0])
    for _ in range(12):
        for index in range(labels.shape[0]):
            near = np.linalg.norm(centres - centres[index], axis=1) < gap
            lowest = cluster[near].min()
            cluster[near] = lowest
    mapping = {label: cluster[index] for index, label in enumerate(labels)}
    return np.array([mapping[group] for group in groups])


def _read_mesh(obj: bpy.types.Object, target_triangles: int) -> list:
    """Reduces a mesh to its triangle budget, and returns (material, vertices, triangles, uvs) per material."""
    triangles = sum(len(polygon.vertices) - 2 for polygon in obj.data.polygons)
    if triangles > target_triangles:
        bpy.context.view_layer.objects.active = obj
        modifier = obj.modifiers.new("reduce", "DECIMATE")
        modifier.ratio = target_triangles / triangles
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    bmesh.ops.triangulate(mesh, faces=mesh.faces[:])
    uv_layer = mesh.loops.layers.uv.active
    matrix = obj.matrix_world
    results = []
    for slot_index, slot in enumerate(obj.material_slots):
        corner_keys: dict = {}
        vertices, uvs, faces = [], [], []
        for face in mesh.faces:
            if face.material_index != slot_index:
                continue
            corners = []
            for loop in face.loops:
                uv = tuple(loop[uv_layer].uv) if uv_layer is not None else (0.0, 0.0)
                key = (loop.vert.index, round(uv[0], 5), round(uv[1], 5))
                if key not in corner_keys:
                    corner_keys[key] = len(vertices)
                    world = matrix @ loop.vert.co
                    vertices.append((world.x, world.z, -world.y))
                    uvs.append(uv)
                corners.append(corner_keys[key])
            faces.append(corners)
        if len(faces) > 0:
            results.append((slot.material, np.array(vertices), np.array(faces), np.array(uvs)))
    mesh.free()
    return results


def load_templates(name: str, target_triangles: int, gap_share: float) -> list:
    """Imports a scan and returns its separate objects. Islands closer than gap_share of its width stay together."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(CACHE / name / f"{name}.gltf"))
    created = [obj for obj in bpy.data.objects if obj not in before]
    meshes = [obj for obj in created if obj.type == "MESH"]
    if len(meshes) == 0:
        raise SystemExit(f"{name}: the download held no mesh.")
    total = sum(len(obj.data.polygons) for obj in meshes)
    templates = []
    bpy.context.view_layer.update()
    for obj in meshes:
        for material, vertices, faces, uvs in _read_mesh(obj, max(int(target_triangles * len(obj.data.polygons) / total), 200)):
            material.use_fake_user = True
            width = float((vertices.max(axis=0) - vertices.min(axis=0))[[0, 2]].max())
            clusters = _cluster_islands(vertices, faces, width * gap_share) if gap_share > 0 else np.zeros(vertices.shape[0], dtype=int)
            for cluster in np.unique(clusters):
                keep = clusters == cluster
                renumber = np.cumsum(keep) - 1
                part_faces = renumber[faces[keep[faces].all(axis=1)]]
                if part_faces.shape[0] < 8:
                    continue
                part = vertices[keep]
                base = np.array([part[:, 0].mean(), part[:, 1].min(), part[:, 2].mean()])
                templates.append(Template(material, part - base, part_faces, uvs[keep]))
    for obj in created:
        bpy.data.objects.remove(obj)
    return templates


def rotation(yaw: float, tilt: float) -> np.ndarray:
    cy, sy, ct, st = np.cos(yaw), np.sin(yaw), np.cos(tilt), np.sin(tilt)
    around_y = np.array([[cy, 0.0, sy], [0.0, 1.0, 0.0], [-sy, 0.0, cy]])
    around_x = np.array([[1.0, 0.0, 0.0], [0.0, ct, -st], [0.0, st, ct]])
    return around_y @ around_x


def along_axis(template: Template, start: np.ndarray, end: np.ndarray, thickness: float, roll: float, tip_share: float, bend: float) -> np.ndarray:
    """Lays a long object from start to end, at the given thickness, stretching only its cross-section.

    Its cross-section narrows to tip_share of the thickness at the far end, and it arcs sideways by
    `bend` metres at the middle, so that a limb does not look like a straight post.
    """
    points = template.vertices - template.vertices.mean(axis=0)
    _, _, axes = np.linalg.svd(points[:: max(points.shape[0] // 4000, 1)], full_matrices=False)
    along, across, deep = axes[0], axes[1], axes[2]
    if np.dot(along, np.array([1.0, 0.0, 0.0])) < 0:
        along = -along
    u = points @ along
    v = points @ across
    w = points @ deep
    length = float(np.linalg.norm(end - start))
    current = max(float(v.max() - v.min()), float(w.max() - w.min()))
    direction = (end - start) / length
    side = np.cross(direction, np.array([0.0, 1.0, 0.0]))
    side /= np.linalg.norm(side)
    up = np.cross(side, direction)
    c, s = np.cos(roll), np.sin(roll)
    axis_a, axis_b = side * c + up * s, up * c - side * s
    scale_cross = thickness / current
    along_share = (u - u.min()) / float(u.max() - u.min())
    narrowing = (1.0 - along_share * (1.0 - tip_share))[:, None]
    arc = np.sin(along_share * np.pi)[:, None] * bend
    position = (start + end) / 2 + direction[None, :] * (u / float(u.max() - u.min()) * length)[:, None] + side[None, :] * arc
    return position + axis_a[None, :] * (v * scale_cross)[:, None] * narrowing + axis_b[None, :] * (w * scale_cross)[:, None] * narrowing
