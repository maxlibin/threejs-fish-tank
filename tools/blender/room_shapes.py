"""Mesh shapes for the living room, as numpy arrays. Coordinates are world metres: x right, y up, z toward the viewer."""
import numpy as np

from fish_body import MeshPart, grid_faces, merge_parts


def box(centre: tuple, size: tuple) -> MeshPart:
    """A box with separate faces, so its edges stay hard. UVs are in metres along each face."""
    cx, cy, cz = centre
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    corners = {
        "+x": [(hx, -hy, hz), (hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz)],
        "-x": [(-hx, -hy, -hz), (-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz)],
        "+y": [(-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz), (-hx, hy, -hz)],
        "-y": [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz), (-hx, -hy, hz)],
        "+z": [(-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)],
        "-z": [(hx, -hy, -hz), (-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz)],
    }
    parts = []
    for axis, face in corners.items():
        vertices = np.array(face) + np.array(centre)
        if axis[1] == "x":
            uvs = vertices[:, [2, 1]]
        elif axis[1] == "y":
            uvs = vertices[:, [0, 2]]
        else:
            uvs = vertices[:, [0, 1]]
        parts.append(MeshPart(vertices, np.array([[0, 1, 2, 3]]), uvs, np.zeros((4, 4))))
    return merge_parts(parts)


def cylinder(start: tuple, end: tuple, radius: float) -> MeshPart:
    """A thin rod between two points, for cables, stems, and lamp heads."""
    a, b = np.array(start, dtype=float), np.array(end, dtype=float)
    axis = (b - a) / max(float(np.linalg.norm(b - a)), 1e-9)
    helper = np.array([0.0, 0.0, 1.0]) if abs(axis[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    u = np.cross(axis, helper)
    u /= np.linalg.norm(u)
    v = np.cross(axis, u)
    angle = np.linspace(0.0, 2 * np.pi, 16, endpoint=False)
    ring = u[None, :] * np.cos(angle)[:, None] + v[None, :] * np.sin(angle)[:, None]
    vertices = np.concatenate([a + ring * radius, b + ring * radius])
    uvs = np.stack([np.tile(angle, 2) * radius, np.concatenate([np.zeros(16), np.full(16, np.linalg.norm(b - a))])], axis=1)
    side = grid_faces(2, 16, True)
    return MeshPart(vertices, side, uvs, np.zeros((32, 4)))


def pillow(centre: tuple, size: tuple, corner: float, puff: float, sag: float, lean: tuple, rng: np.random.Generator) -> MeshPart:
    """A soft upholstered form: a rounded box that bulges in the middle of each face, sags, and wrinkles."""
    half = np.array(size, dtype=float) / 2
    steps = 34
    grid = np.linspace(-1.0, 1.0, steps)
    a, b = np.meshgrid(grid, grid, indexing="ij")
    faces_of_cube = [
        np.stack([np.ones_like(a), a, b], -1), np.stack([-np.ones_like(a), b, a], -1),
        np.stack([b, np.ones_like(a), a], -1), np.stack([a, -np.ones_like(a), b], -1),
        np.stack([a, b, np.ones_like(a)], -1), np.stack([b, a, -np.ones_like(a)], -1),
    ]
    wave_phases = rng.uniform(0.0, 6.28, 8)
    parts = []
    for cube in faces_of_cube:
        scaled = cube * half
        inner = np.clip(scaled, -(half - corner), half - corner)
        outward = scaled - inner
        outward /= np.maximum(np.linalg.norm(outward, axis=-1, keepdims=True), 1e-9)
        rounded = inner + outward * corner
        face_axis = int(np.argmax(np.abs(cube).reshape(-1, 3).mean(axis=0)))
        others = [axis for axis in (0, 1, 2) if axis != face_axis]
        fx, fy = cube[..., others[0]], cube[..., others[1]]
        bulge = puff * (1 - fx**2) * (1 - fy**2)
        rounded = rounded + outward * bulge[..., None]
        # Soft creases radiate from corners and run across the fabric where it has been sat on.
        crease = (
            np.sin(fx * 4.1 + fy * 2.3 + wave_phases[0]) * 0.5 + np.sin(fx * 7.7 - fy * 5.1 + wave_phases[1]) * 0.28
            + np.sin(fx * 15.3 + fy * 11.1 + wave_phases[2]) * 0.1 + np.sin(fy * 19.0 - fx * 7.0 + wave_phases[3]) * 0.07
        )
        rounded = rounded + outward * (crease * (0.0035 + puff * 0.09) * (1 - fx**4) * (1 - fy**4))[..., None]
        # The top of a seat dips under its own softness.
        depth = (1 - (rounded[..., 0] / half[0]) ** 2) * (1 - (rounded[..., 2] / half[2]) ** 2)
        rounded[..., 1] -= sag * np.clip(depth, 0.0, 1.0) * (rounded[..., 1] > 0)
        # Lean tips the top of the form toward a direction, as back cushions rest against a frame.
        height = (rounded[..., 1] / half[1] + 1) * 0.5
        rounded[..., 0] += lean[0] * height
        rounded[..., 2] += lean[1] * height
        vertices = rounded.reshape(-1, 3) + np.array(centre)
        uvs = np.stack([(fx * half[others[0]]).ravel(), (fy * half[others[1]]).ravel()], axis=1)
        faces = grid_faces(steps, steps, False)
        # Wind every face outward; the bake traces light from the side a face points to.
        grid_vertices = vertices.reshape(steps, steps, 3)
        middle = steps // 2
        edge_a = grid_vertices[middle + 1, middle] - grid_vertices[middle, middle]
        edge_b = grid_vertices[middle, middle + 1] - grid_vertices[middle, middle]
        winding_normal = np.cross(edge_b, edge_a)
        if np.dot(winding_normal, outward[middle, middle]) < 0:
            faces = faces[:, ::-1]
        parts.append(MeshPart(vertices, faces, uvs, np.zeros((steps * steps, 4))))
    return merge_parts(parts)


def curtain(x: float, z_start: float, z_end: float, height: float, rng: np.random.Generator) -> MeshPart:
    """Long drapes in irregular vertical folds, hanging from near the ceiling."""
    columns, rows = 420, 24
    z = np.linspace(z_start, z_end, columns)
    y = np.linspace(0.02, height, rows)
    zz, yy = np.meshgrid(z, y)
    phase = rng.uniform(0.0, 6.28, 3)
    folds = 0.035 * np.sin(zz * 21 + phase[0] + 0.6 * np.sin(zz * 7)) + 0.018 * np.sin(zz * 47 + phase[1]) + 0.007 * np.sin(zz * 113 + phase[2] + yy)
    xx = x - folds * (0.65 + 0.35 * yy / height) - 0.04
    vertices = np.stack([xx, yy, zz], axis=-1).reshape(-1, 3)
    uvs = np.stack([zz, yy], axis=-1).reshape(-1, 2)
    return MeshPart(vertices, grid_faces(rows, columns, False), uvs, np.zeros((rows * columns, 4)))
