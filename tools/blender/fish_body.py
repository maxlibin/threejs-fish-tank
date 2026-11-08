"""Builds a fish mesh from a traced profile. Coordinates: x forward, y up, z sideways, in metres.

All functions are pure numpy except add_mesh_object, which writes the result into Blender.
"""
from dataclasses import dataclass

import bpy
import numpy as np


@dataclass(frozen=True)
class MeshPart:
    """Per-vertex arrays for one piece of a fish. color channels: spine, fin flex, pectoral, gill/mouth."""
    vertices: np.ndarray
    faces: np.ndarray
    uvs: np.ndarray
    colors: np.ndarray


def smooth_interp(points: list, x: np.ndarray) -> np.ndarray:
    """Interpolates y(x) through control points with Catmull-Rom smoothing."""
    px, py = np.array(points, dtype=float).T
    dense = np.linspace(0.0, 1.0, 64)
    xs, ys = [], []
    for i in range(len(px) - 1):
        p0, p3 = max(i - 1, 0), min(i + 2, len(px) - 1)
        for values, target in ((px, xs), (py, ys)):
            a, b, c, d = values[p0], values[i], values[i + 1], values[p3]
            target.append(0.5 * (2 * b + (c - a) * dense + (2 * a - 5 * b + 4 * c - d) * dense**2 + (3 * b - a - 3 * c + d) * dense**3))
    return np.interp(x, np.concatenate(xs), np.concatenate(ys))


def resample_polyline(points: list, count: int) -> np.ndarray:
    """Returns `count` points evenly spaced along a smoothed polyline."""
    p = np.array(points, dtype=float)
    t = np.linspace(0.0, 1.0, len(p))
    fine = np.linspace(0.0, 1.0, 512)
    curve = np.stack([smooth_interp(np.stack([t, p[:, axis]], axis=1).tolist(), fine) for axis in (0, 1)], axis=1)
    lengths = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(curve, axis=0), axis=1))])
    targets = np.linspace(0.0, lengths[-1], count)
    return np.stack([np.interp(targets, lengths, curve[:, axis]) for axis in (0, 1)], axis=1)


def canvas_uv(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Side-view texture space: main canvas for the body and median fins, in length units."""
    return np.stack([(x + 0.04) / CANVAS_SPAN, (y + CANVAS_SPAN * 0.5) / CANVAS_SPAN], axis=-1)


# The canvas is square, 1.9 lengths wide. The right-hand side holds the paired fins.
CANVAS_SPAN = 1.9
PAIRED_CANVAS_OFFSET = {"pectoral": (0.84, 0.35), "ventral": (0.84, -0.05), "barbel": (0.84, 0.72)}


def grid_faces(rows: int, columns: int, wrap: bool) -> np.ndarray:
    """Quads for a rows-by-columns vertex grid; `wrap` joins the last column to the first."""
    last_column = columns if wrap else columns - 1
    row, column = np.meshgrid(np.arange(rows - 1), np.arange(last_column), indexing="ij")
    a = row * columns + column
    b = row * columns + (column + 1) % columns
    c = (row + 1) * columns + (column + 1) % columns
    d = (row + 1) * columns + column
    return np.stack([a, b, c, d], axis=-1).reshape(-1, 4)


def body_features(profile: dict, x: np.ndarray, y: np.ndarray) -> tuple:
    """Head sculpting as thickness multipliers, plus the mask for breathing motion."""
    eye, gill, mouth = profile["eye"], profile["gill_arc"], profile["mouth"]
    eye_distance = np.hypot(x - eye["x"], y - eye["y"])
    socket = 0.16 * np.exp(-((eye_distance / (eye["radius"] * 1.7)) ** 2))
    gill_distance = np.hypot(x - gill["x"], (y - gill["y"]) * 0.7)
    behind_cover = np.clip((gill_distance - gill["radius"]) / 0.012, 0.0, 1.0)
    in_cover = np.clip((gill["radius"] - gill_distance) / 0.09, 0.0, 1.0)
    # Only the lower and rear part of the gill cover has a free edge; it blends into the head above the eye.
    free_edge = np.clip((eye["y"] + 0.02 - y) / 0.06, 0.0, 1.0)
    cover = (-0.028 * behind_cover * np.exp(-(((gill_distance - gill["radius"]) / 0.05) ** 2)) + 0.018 * in_cover) * free_edge
    near_mouth = np.exp(-((x / mouth["length"]) ** 2))
    groove = -0.18 * near_mouth * np.exp(-(((y - mouth["y"]) / 0.0055) ** 2))
    lips = 0.08 * near_mouth * np.exp(-(((y - mouth["y"]) / 0.016) ** 2))
    breathing = np.clip(1.0 - np.abs(gill_distance - gill["radius"]) / 0.05, 0.0, 1.0)
    mouth_motion = np.clip(1.0 - x / 0.05, 0.0, 1.0)
    return 1.0 + socket + cover + groove + lips, np.maximum(breathing, mouth_motion)


def build_body(profile: dict) -> MeshPart:
    """Lofts the laterally flattened body along the traced outlines."""
    length = profile["length_m"]
    rows, columns = profile["mesh"]["rows"], profile["mesh"]["columns"]
    x = profile["body_end"] * np.linspace(0.0, 1.0, rows) ** 1.7
    top = smooth_interp(profile["top"], x)
    bottom = smooth_interp(profile["bottom"], x)
    thickness = smooth_interp(profile["thickness"], x)
    angle = np.linspace(0.0, 2 * np.pi, columns, endpoint=False)
    xs = np.repeat(x[:, None], columns, axis=1)
    centre = (top + bottom) * 0.5
    half = (top - bottom) * 0.5
    ys = centre[:, None] + half[:, None] * np.sin(angle)[None, :]
    # Flat flanks that narrow quickly to a keel at the top and bottom edges.
    flatness = np.sign(np.cos(angle)) * np.abs(np.cos(angle)) ** 0.78
    features, gill_mouth = body_features(profile, xs, ys)
    zs = thickness[:, None] * flatness[None, :] * features
    vertices = np.stack([0.5 - xs, ys, zs], axis=-1).reshape(-1, 3) * length
    uvs = canvas_uv(xs, ys).reshape(-1, 2)
    colors = np.zeros((rows * columns, 4))
    colors[:, 0] = xs.ravel()
    colors[:, 3] = gill_mouth.ravel()
    return MeshPart(vertices, grid_faces(rows, columns, True), uvs, colors)


def build_fin(fin: dict, length: float, side: float, uv_offset: tuple, pectoral: bool) -> MeshPart:
    """A sheet of fin rays fanning from the base curve to the tip curve, pleated along the rays."""
    rays, segments = fin["rays"], fin["ray_segments"]
    columns = (rays - 1) * 2 + 1
    base = resample_polyline(fin["base"], columns)
    tip = resample_polyline(fin["tip"], columns)
    t = (np.linspace(0.0, 1.0, segments + 1) ** 1.15)[:, None]
    s = np.linspace(0.0, 1.0, columns)
    xy = base[None, :, :] * (1 - t[:, :, None]) + tip[None, :, :] * t[:, :, None]
    pleat = np.cos(s * (rays - 1) * 2 * np.pi)[None, :] * fin["corrugation"] * np.sqrt(np.clip(t, 0.0, 1.0))
    if side == 0.0:
        z = pleat
    else:
        z = side * (fin["spread"] * (0.45 + t)) + pleat
    vertices = np.stack([0.5 - xy[:, :, 0], xy[:, :, 1], np.broadcast_to(z, xy.shape[:2])], axis=-1).reshape(-1, 3) * length
    uvs = canvas_uv(xy[:, :, 0] + uv_offset[0], xy[:, :, 1] + uv_offset[1]).reshape(-1, 2)
    colors = np.zeros((vertices.shape[0], 4))
    colors[:, 0] = np.clip(xy[:, :, 0].ravel(), 0.0, 1.0)
    flex = np.broadcast_to(t, xy.shape[:2]).ravel()
    colors[:, 2 if pectoral else 1] = flex
    return MeshPart(vertices, grid_faces(segments + 1, columns, False), uvs, colors)


def build_eye(profile: dict, side: float) -> MeshPart:
    """A ball set in the head that bulges through the socket; its UVs centre the pupil on the outward pole."""
    length = profile["length_m"]
    eye = profile["eye"]
    rows, columns = profile["mesh"]["eye_rows"], profile["mesh"]["eye_columns"]
    polar = np.linspace(0.0, np.pi, rows)
    azimuth = np.linspace(0.0, 2 * np.pi, columns, endpoint=False)
    p, a = np.meshgrid(polar, azimuth, indexing="ij")
    r = eye["radius"]
    surface = smooth_interp(profile["thickness"], np.array([eye["x"]]))[0]
    # Set deep, so only a shallow cap of the ball shows through the socket.
    cx, cy, cz = eye["x"], eye["y"], side * (surface * 1.0 - r * 0.62)
    xs = cx + r * np.sin(p) * np.cos(a)
    ys = cy + r * np.sin(p) * np.sin(a)
    zs = cz + side * r * np.cos(p)
    vertices = np.stack([0.5 - xs, ys, zs], axis=-1).reshape(-1, 3) * length
    # Projected from the side so the iris pattern lies flat on the visible cap.
    uvs = np.stack([(xs - cx) / r * 0.5 + 0.5, (ys - cy) / r * 0.5 + 0.5], axis=-1).reshape(-1, 2)
    colors = np.zeros((rows * columns, 4))
    colors[:, 0] = cx
    faces = grid_faces(rows, columns, True)
    if side < 0:
        faces = faces[:, ::-1]
    return MeshPart(vertices, faces, uvs, colors)


def merge_parts(parts: list) -> MeshPart:
    """Concatenates mesh parts into one."""
    offsets = np.cumsum([0] + [part.vertices.shape[0] for part in parts[:-1]])
    return MeshPart(
        np.concatenate([part.vertices for part in parts]),
        np.concatenate([part.faces + offset for part, offset in zip(parts, offsets)]),
        np.concatenate([part.uvs for part in parts]),
        np.concatenate([part.colors for part in parts]),
    )


def build_fish_body(profile: dict) -> MeshPart:
    """The whole fish except the eyes, as one mesh."""
    length = profile["length_m"]
    parts = [build_body(profile)]
    parts += [build_fin(fin, length, 0.0, (0.0, 0.0), False) for fin in profile["fins"].values()]
    for name, fin in profile["paired_fins"].items():
        for side in (1.0, -1.0):
            parts.append(build_fin(fin, length, side, PAIRED_CANVAS_OFFSET[name], name == "pectoral"))
    merged = merge_parts(parts)
    # Traced tails stop a little short of the photo's axis; the swimming shader needs spine position 0 to 1.
    merged.colors[:, 0] /= merged.colors[:, 0].max()
    return merged


def build_fish_eyes(profile: dict) -> MeshPart:
    return merge_parts([build_eye(profile, 1.0), build_eye(profile, -1.0)])


def add_mesh_object(name: str, part: MeshPart) -> bpy.types.Object:
    """Writes a part into the Blender scene, mapping x forward, y up, z sideways to Blender's z-up axes."""
    vertices = np.stack([part.vertices[:, 0], -part.vertices[:, 2], part.vertices[:, 1]], axis=1)
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices.tolist(), [], part.faces.tolist())
    mesh.update()
    loop_vertices = np.zeros(len(mesh.loops), dtype=int)
    mesh.loops.foreach_get("vertex_index", loop_vertices)
    uv_layer = mesh.uv_layers.new(name="UVMap")
    uv_layer.data.foreach_set("uv", part.uvs[loop_vertices].ravel().astype(np.float32))
    colors = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    colors.data.foreach_set("color", part.colors.ravel().astype(np.float32))
    mesh.color_attributes.active_color_index = 0
    mesh.color_attributes.render_color_index = 0
    mesh.polygons.foreach_set("use_smooth", np.ones(len(mesh.polygons), dtype=bool))
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj
