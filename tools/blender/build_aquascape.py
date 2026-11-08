"""Composes the aquascape from real scans, following reference/aquascape/inspiration.png, and writes its assets.

Run with: blender --background --factory-startup --python tools/blender/build_aquascape.py -- --out public/assets/aquascape
"""
import json
import sys
from dataclasses import replace
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import aquascape_layout as layout  # noqa: E402
from build_plants import grow_plants, paint_leaf_atlas  # noqa: E402
from fish_body import MeshPart, add_mesh_object, grid_faces, merge_parts  # noqa: E402
from scan_library import Template, along_axis, load_templates, rotation  # noqa: E402

SEED = 11
COLLIDER_CELL = 0.05
LEAF_CELL = 0.04
ATLAS_SIZE = 2048
# The small-leaved scan is far brighter and greener than the other plants, and would glow beside them.
SMALL_LEAF_BRIGHTNESS = 0.75
SMALL_LEAF_PALENESS = 0.45


def output_dir() -> Path:
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if "--out" not in arguments:
        raise SystemExit("Missing argument: pass -- --out public/assets/aquascape after the Blender arguments.")
    return Path(arguments[arguments.index("--out") + 1])


def placed(template: Template, scale: float, yaw: float, tilt: float, position: tuple, sway: bool, phase: float, tone: float) -> MeshPart:
    """A copy of a scan in the tank. Vertex colours: r sway weight, g phase, b colour variation, a brightness."""
    points = layout.fit_inside((template.vertices * scale) @ rotation(yaw, tilt).T + np.array(position))
    colors = np.zeros((points.shape[0], 4))
    if sway:
        colors[:, 0] = np.clip(template.vertices[:, 1] / max(template.height, 1e-6), 0.0, 1.0)
    colors[:, 1] = phase
    colors[:, 2] = tone
    # The photo's bush on the right is lit far more brightly than the plants on the left.
    colors[:, 3] = np.clip(0.5 + (points[:, 0].mean() + layout.INNER_X) / (2 * layout.INNER_X) * 0.5, 0.0, 1.0)
    return MeshPart(points, template.faces, template.uvs, colors)


class Collection:
    """Gathers placed copies by material, to write out as one mesh each."""

    def __init__(self) -> None:
        self.parts: dict = {}

    def add(self, prefix: str, template: Template, part: MeshPart) -> None:
        self.parts.setdefault((prefix, template.material.name), (template.material, []))[1].append(part)

    def write(self) -> list:
        objects = []
        for index, ((prefix, _), (material, parts)) in enumerate(self.parts.items()):
            obj = add_mesh_object(f"{prefix}_{index}", merge_parts(parts))
            obj.data.materials.append(material)
            objects.append(obj)
        return objects


def whole_plants(templates: list) -> list:
    """Keeps complete plants: upright, and not stray single leaves split off from them."""
    largest = max(template.faces.shape[0] for template in templates)
    return [template for template in templates if template.faces.shape[0] > largest * 0.25 and template.height > template.size * 0.4]


def build_rocks(collection: Collection, rng: np.random.Generator) -> np.ndarray:
    """Large mossy rocks and craggy boulders in the middle and to the right."""
    mossy = whole_plants(load_templates("rock_moss_set_01", 60000, 0.14))
    craggy = load_templates("boulder_01", 26000, 0.0)
    points = []
    for x, z, size, lift, kind in layout.ROCK_PLACEMENTS:
        pool = mossy if kind == "mossy" else craggy
        template = pool[int(rng.integers(len(pool)))]
        scale = size / template.size
        part = placed(template, scale, rng.uniform(0, 6.28), rng.uniform(-0.15, 0.15), (x, layout.ground_y(x, z) - size * lift, z), False, 0.0, 0.5)
        collection.add("rock", template, part)
        points.append(part.vertices)
    return np.concatenate(points)


def build_wood(collection: Collection) -> np.ndarray:
    """Long scanned tree trunks, as heavy driftwood."""
    trunks = {"dead_tree_trunk": load_templates("dead_tree_trunk", 42000, 0.0)[0], "dead_tree_trunk_02": load_templates("dead_tree_trunk_02", 42000, 0.0)[0]}
    points = []
    for asset, start, end, thickness, roll in layout.TRUNKS:
        template = trunks[asset]
        vertices = layout.fit_inside(along_axis(template, np.array(start), np.array(end), thickness, roll, 0.55, 0.0))
        colors = np.zeros((vertices.shape[0], 4))
        part = MeshPart(vertices, template.faces, template.uvs, colors)
        collection.add("wood", template, part)
        points.append(vertices)
    return np.concatenate(points)


def build_branches(collection: Collection) -> np.ndarray:
    """Real dry branches, darkened as driftwood, for the gnarled shapes that smooth trunks lack."""
    templates = load_templates("dry_branches_medium_01", 16000, 0.0)
    points = []
    forked = {name: load_templates(name, 14000, 0.0)[0] for name in {spec[0] for spec in layout.FORKED_BRANCHES}}
    for name, start, end, thickness, roll, tip_share, bend in layout.FORKED_BRANCHES:
        template = forked[name]
        vertices = layout.fit_inside(along_axis(template, np.array(start), np.array(end), thickness, roll, tip_share, bend))
        collection.add("branch", template, MeshPart(vertices, template.faces, template.uvs, np.zeros((vertices.shape[0], 4))))
        points.append(vertices)
    for x, y, z, longest, turn in layout.BRANCHES:
        template = templates[0]
        part = placed(template, longest / template.size, turn, 0.0, (x, y, z), False, 0.0, 0.5)
        collection.add("wood", template, part)
        points.append(part.vertices)
    return np.concatenate(points)


def scale_to_height(template: Template, height: float) -> float:
    """Scale that gives a plant this height, without letting a low, wide one spread enormously."""
    return min(height / template.height, height * 1.25 / template.size)


def scatter(collection: Collection, templates: list, count: int, area: tuple, heights: tuple, rng: np.random.Generator) -> None:
    """Scatters a kind of plant over an area of the ground, taller toward the back."""
    x_low, x_high, z_low, z_high = area
    for _ in range(count):
        template = templates[int(rng.integers(len(templates)))]
        x, z = rng.uniform(x_low, x_high), rng.uniform(z_low, z_high)
        toward_back = (z_high - z) / max(z_high - z_low, 1e-6)
        height = (heights[0] + (heights[1] - heights[0]) * (toward_back * 0.7 + rng.uniform(0, 0.3)))
        part = placed(template, scale_to_height(template, height), rng.uniform(0, 6.28), rng.uniform(-0.12, 0.12), (x, layout.ground_y(x, z) - 0.01, z), True, float(rng.random()), float(rng.random()))
        collection.add("plantscan", template, part)


def colour_image(material: bpy.types.Material) -> bpy.types.Image:
    """The colour map of a scanned material, wherever it sits upstream of Base Color."""

    def images_above(socket: bpy.types.NodeSocket) -> set:
        found = set()
        for link in socket.links:
            node = link.from_node
            if node.type == "TEX_IMAGE":
                found.add(node.image)
            else:
                for upstream in node.inputs:
                    found |= images_above(upstream)
        return found

    surface = next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    images = images_above(surface.inputs["Base Color"])
    if len(images) != 1:
        raise SystemExit(f"{material.name}: expected one image feeding Base Color, found {sorted(image.name for image in images)}; nodes {[node.type for node in material.node_tree.nodes]}.")
    return images.pop()


def image_pixels(image: bpy.types.Image) -> np.ndarray:
    width, height = image.size
    pixels = np.zeros(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    return pixels.reshape(height, width, 4)


def without_flowers(templates: list) -> list:
    """Removes the faces of a scan that show flowers, which are the only parts where green is the weakest colour."""

    def leaves_only(template: Template) -> Template:
        pixels = image_pixels(colour_image(template.material))
        height, width = pixels.shape[:2]

        def is_flower(uvs: np.ndarray) -> np.ndarray:
            colours = pixels[(np.mod(uvs[..., 1], 1.0) * height).astype(int), (np.mod(uvs[..., 0], 1.0) * width).astype(int)]
            return (colours[..., 0] > colours[..., 1]) & (colours[..., 2] > colours[..., 1])

        corners = template.uvs[template.faces]
        flowers = is_flower(corners).any(axis=1) | is_flower(corners.mean(axis=1))
        return replace(template, faces=template.faces[~flowers])

    return [leaves_only(template) for template in templates]


def repaint_small_leaves(material: bpy.types.Material) -> None:
    """Prepares the small-leaved scan's colour map: brown twigs and dead leaves turn green, and all of it is calmed."""
    image = colour_image(material)
    pixels = image_pixels(image)
    dead = pixels[..., 0] > pixels[..., 1]
    pixels[dead, 0], pixels[dead, 1] = pixels[dead, 1], pixels[dead, 0].copy()
    grey = pixels[..., :3].mean(axis=-1, keepdims=True)
    pixels[..., :3] = (pixels[..., :3] * (1 - SMALL_LEAF_PALENESS) + grey * SMALL_LEAF_PALENESS) * SMALL_LEAF_BRIGHTNESS
    image.pixels.foreach_set(pixels.ravel())
    image.update()


def crown(collection: Collection, templates: list, count: int, area: tuple, lifts: tuple, heights: tuple, rng: np.random.Generator) -> None:
    """Raises plants from inside a bush, so that their stems stay hidden and their small leaves top it."""
    x_low, x_high, z_low, z_high = area
    for _ in range(count):
        template = templates[int(rng.integers(len(templates)))]
        x, z = rng.uniform(x_low, x_high), rng.uniform(z_low, z_high)
        base = (x, layout.ground_y(x, z) + rng.uniform(*lifts), z)
        part = placed(template, scale_to_height(template, rng.uniform(*heights)), rng.uniform(0, 6.28), rng.uniform(-0.2, 0.2), base, True, float(rng.random()), float(rng.random()))
        collection.add("plantscan", template, part)


def on_surface(collection: Collection, templates: list, points: np.ndarray, count: int, heights: tuple, rng: np.random.Generator) -> None:
    """Grows plants directly from spots on the wood and rocks."""
    order = rng.permutation(points.shape[0])[:count]
    for point in points[order]:
        template = templates[int(rng.integers(len(templates)))]
        height = rng.uniform(*heights)
        part = placed(template, scale_to_height(template, height), rng.uniform(0, 6.28), rng.uniform(-0.2, 0.2), tuple(point), True, float(rng.random()), float(rng.random()))
        collection.add("plantscan", template, part)


def build_colliders(points: np.ndarray, soft: list, out_path: Path, rng: np.random.Generator) -> None:
    """Covers the hardscape with spheres for fish to avoid, one per occupied cell of a grid."""
    cells = np.floor(points / COLLIDER_CELL).astype(int)
    colliders = []
    for key in np.unique(cells, axis=0):
        members = points[(cells == key).all(axis=1)]
        centre = members.mean(axis=0)
        radius = float(np.linalg.norm(members - centre, axis=1).max()) + 0.002
        colliders.append({"center": centre.round(5).tolist(), "radius": round(radius, 5)})
    colliders += soft
    samples = points[rng.choice(len(points), 400, replace=False)]
    columns, rows = 64, 20
    xs = np.linspace(-layout.INNER_X, layout.INNER_X, columns)
    zs = np.linspace(-layout.INNER_Z, layout.INNER_Z, rows)
    grid_x, grid_z = np.meshgrid(xs, zs)
    heights = layout.FLOOR_Y + layout.terrain_height(grid_x, grid_z)
    ground_grid = {"minX": float(xs[0]), "minZ": float(zs[0]), "stepX": float(xs[1] - xs[0]), "stepZ": float(zs[1] - zs[0]), "columns": columns, "rows": rows, "heights": heights.round(4).ravel().tolist()}
    out_path.write_text(json.dumps({"colliders": colliders, "hardscapeSamples": samples.round(5).tolist(), "ground": ground_grid}))


def build_terrain() -> MeshPart:
    """Substrate as a height field, with skirts at the glass. Colour r is the sand mask."""
    rows, columns = 96, 380
    x = np.linspace(-layout.INNER_X, layout.INNER_X, columns)
    z = np.linspace(-layout.INNER_Z, layout.INNER_Z, rows)
    grid_x, grid_z = np.meshgrid(x, z)
    y = layout.FLOOR_Y + layout.terrain_height(grid_x, grid_z)
    vertices = np.stack([grid_x, y, grid_z], axis=-1).reshape(-1, 3)
    uvs = np.stack([grid_x, grid_z], axis=-1).reshape(-1, 2)
    colors = np.zeros((rows * columns, 4))
    colors[:, 0] = layout.sand_mask(grid_x, grid_z).ravel()
    parts = [MeshPart(vertices, grid_faces(rows, columns, False)[:, ::-1], uvs, colors)]

    def skirt(edge_x: np.ndarray, edge_z: np.ndarray, is_sand: float) -> MeshPart:
        rows_down = 6
        top = layout.FLOOR_Y + layout.terrain_height(edge_x, edge_z)
        fractions = np.linspace(0.0, 1.0, rows_down)[:, None]
        ys = top[None, :] * (1 - fractions) + layout.FLOOR_Y * fractions
        xs = np.broadcast_to(edge_x, ys.shape)
        zs = np.broadcast_to(edge_z, ys.shape)
        run = np.broadcast_to(edge_x + edge_z, ys.shape)
        skirt_colors = np.zeros((rows_down * edge_x.shape[0], 4))
        skirt_colors[:, 0] = is_sand
        return MeshPart(np.stack([xs, ys, zs], axis=-1).reshape(-1, 3), grid_faces(rows_down, edge_x.shape[0], False), np.stack([run, ys * 0.6], axis=-1).reshape(-1, 2), skirt_colors)

    parts.append(skirt(x, np.full_like(x, layout.INNER_Z), 1.0))
    parts.append(skirt(np.full_like(z, layout.INNER_X), z, 0.0))
    parts.append(skirt(np.full_like(z, -layout.INNER_X), z, 0.0))
    return merge_parts(parts)


def build_pipe(name: str, x: float, z: float, radius: float, bottom: float) -> MeshPart:
    """A black pipe from `bottom` up through the water, ribbed where it strains water."""
    rows, columns = 90, 20
    ys = np.linspace(bottom, layout.SURFACE_Y + 0.01, rows)
    angle = np.linspace(0.0, 2 * np.pi, columns, endpoint=False)
    ribs = 1.0 + 0.09 * (np.sin(ys * 700) > 0.3) * (ys < bottom + 0.14) if name != "heater" else np.ones_like(ys)
    px = x + (radius * ribs)[:, None] * np.cos(angle)[None, :]
    pz = z + (radius * ribs)[:, None] * np.sin(angle)[None, :]
    py = np.repeat(ys[:, None], columns, axis=1)
    return MeshPart(np.stack([px, py, pz], axis=-1).reshape(-1, 3), grid_faces(rows, columns, True), np.zeros((rows * columns, 2)), np.zeros((rows * columns, 4)))


def export_glb(objects: list, path: Path, materials: str) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True, export_materials=materials,
        export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_normals=True, export_yup=True, export_image_format="AUTO",
    )


def write_leaf_points(vertex_sets: list, out_path: Path) -> None:
    """Where the leaves are, one point per occupied cell, so that the app can tell when a fish brushes them."""
    points = np.concatenate(vertex_sets)
    cells = np.unique(np.floor(points / LEAF_CELL).astype(int), axis=0)
    out_path.write_text(json.dumps(((cells + 0.5) * LEAF_CELL).round(3).tolist()))
    print(f"Leaf points: {cells.shape[0]}")


def surface_spots(points: np.ndarray, x_low: float, x_high: float, y_low: float) -> np.ndarray:
    keep = (points[:, 0] > x_low) & (points[:, 0] < x_high) & (points[:, 1] > y_low)
    return points[keep]


def main() -> None:
    out = output_dir()
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(SEED)
    bpy.ops.wm.read_factory_settings(use_empty=True)

    hard = Collection()
    rock_points = build_rocks(hard, rng)
    wood_points = np.concatenate([build_wood(hard), build_branches(hard)])
    hard_points = np.concatenate([rock_points, wood_points])

    broad = whole_plants(load_templates("anthurium_botany_01", 8000, 0.2)) + whole_plants(load_templates("calathea_orbifolia_01", 16000, 0.17))
    ferns = whole_plants(load_templates("fern_02", 8000, 0.26))
    moss = sorted(load_templates("moss_01", 7000, 0.0), key=lambda template: -template.faces.shape[0])
    print(f"Templates: broad {len(broad)}, ferns {len(ferns)}, moss {len(moss)}")

    plants = Collection()
    # The large bush on the right stays low under its crown, and the left is feathery with ferns.
    scatter(plants, broad, 26, layout.deepen_area((0.45, 1.42, -0.29, -0.1)), (0.4, 0.72), rng)
    scatter(plants, ferns, 8, layout.deepen_area((0.8, 1.42, -0.2, 0.0)), (0.3, 0.5), rng)
    scatter(plants, ferns, 22, layout.deepen_area((-1.46, -0.8, -0.28, -0.02)), (0.38, 0.75), rng)
    scatter(plants, broad, 8, layout.deepen_area((-1.42, -0.8, -0.26, -0.1)), (0.4, 0.7), rng)
    # Lower growth along the front, with room for the sand.
    scatter(plants, ferns, 10, layout.deepen_area((-0.75, 1.3, -0.05, 0.08)), (0.14, 0.26), rng)
    scatter(plants, ferns, 44, layout.deepen_area((-1.15, 1.42, -0.06, 0.11)), (0.1, 0.2), rng)
    # Growing from the wood itself.
    on_surface(plants, broad, surface_spots(wood_points, 0.3, 1.05, layout.FLOOR_Y + 0.3), 16, (0.2, 0.42), rng)
    on_surface(plants, ferns, surface_spots(wood_points, -1.2, -0.45, layout.FLOOR_Y + 0.6), 12, (0.2, 0.36), rng)
    # A little growth clinging to the two tall limbs, so they sit in the scape rather than on it.
    on_surface(plants, ferns, surface_spots(wood_points, -0.45, 0.28, layout.FLOOR_Y + 0.55), 7, (0.1, 0.18), rng)
    # Cushions of real moss over low rocks and the ground, flattened against them.
    for point in rock_points[rng.permutation(rock_points.shape[0])[:12]]:
        template = moss[0]
        size = rng.uniform(0.14, 0.26)
        part = placed(template, size / template.size, rng.uniform(0, 6.28), 0.0, (point[0], point[1] - size * 0.32, point[2]), False, 0.0, float(rng.random()))
        plants.add("plantscan", template, part)
    for _ in range(22):
        x, z = rng.uniform(-0.95, 1.3), layout.deepen_z(rng.uniform(-0.08, 0.1))
        size = rng.uniform(0.14, 0.28)
        part = placed(moss[0], size / moss[0].size, rng.uniform(0, 6.28), 0.0, (x, layout.ground_y(x, z) - size * 0.55, z), False, 0.0, float(rng.random()))
        plants.add("plantscan", moss[0], part)

    # Small pale leaves over the right bush, as in the photo. Their own random stream leaves every other plant in place.
    small_leaved = without_flowers(whole_plants(load_templates("periwinkle_plant", 10000, 0.2)))
    for material in {template.material for template in small_leaved}:
        repaint_small_leaves(material)
    crown(plants, small_leaved, 90, layout.deepen_area((0.4, 1.4, -0.27, -0.03)), (0.3, 0.55), (0.2, 0.34), np.random.default_rng(SEED + 1))

    soft = [{"center": [round(float(x), 4), round(layout.ground_y(float(x), float(z)) + height, 4), round(float(z), 4)], "radius": round(radius, 4)}
            for x, z, height, radius in layout.PLANT_MASSES]
    build_colliders(hard_points, soft, out / "colliders.json", rng)

    terrain = add_mesh_object("terrain", build_terrain())
    pipes = [add_mesh_object(pipe[0], build_pipe(*pipe)) for pipe in layout.PIPES]
    export_glb([*hard.write(), terrain, *pipes], out / "hardscape.glb", "EXPORT")

    grown = grow_plants(SEED)
    generated = add_mesh_object("plants", grown)
    print(f"Generated plant faces: {len(generated.data.polygons)}")
    export_glb([generated], out / "plants.glb", "NONE")
    write_leaf_points([part.vertices for _, parts in plants.parts.values() for part in parts] + [grown.vertices], out / "plant_points.json")
    scans = plants.write()
    print(f"Scanned plant triangles: {sum(len(obj.data.polygons) for obj in scans)}")
    export_glb(scans, out / "plantscans.glb", "EXPORT")
    paint_leaf_atlas(out / "leaves", ATLAS_SIZE, SEED)


main()
