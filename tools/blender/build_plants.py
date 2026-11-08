"""Grows the aquarium's plants, leaf by leaf, as one mesh with a shared leaf atlas.

Vertex colours: r sway weight (0 base, 1 tip of plant), g plant phase, b colour variation, a position along the leaf.
"""
from pathlib import Path

import numpy as np

import aquascape_layout as layout
from fish_body import MeshPart, grid_faces, merge_parts
from fish_textures import mix, noise, smoothstep, write_png

ATLAS_COLUMNS = 8
ATLAS_ROWS = 2
KIND = {"ribbon": 0, "sword": 1, "anubias": 2, "fern": 3, "crypt": 4, "rotala": 5, "moss": 6, "stem": 7}


def normalize(vector: np.ndarray) -> np.ndarray:
    return vector / max(float(np.linalg.norm(vector)), 1e-9)


def shape_ribbon(t: np.ndarray) -> np.ndarray:
    return np.clip((1 - t) / 0.12, 0.0, 1.0) ** 0.6 * (0.75 + 0.25 * np.clip(t / 0.3, 0.0, 1.0))


def shape_sword(t: np.ndarray) -> np.ndarray:
    return np.sin(np.pi * t**0.72) ** 0.85


def shape_oval(t: np.ndarray) -> np.ndarray:
    return np.sin(np.pi * t**0.8) ** 0.55


def shape_lance(t: np.ndarray) -> np.ndarray:
    return np.sin(np.pi * t**0.62) ** 1.05


def build_leaf(plant: dict, base: np.ndarray, direction: np.ndarray, length: float, width: float, shape, kind: str, rng: np.random.Generator, options: dict) -> MeshPart:
    """A leaf or stem as a bent strip. Options: droop, fold, wave, twist, segments, across, aged."""
    segments, across = options["segments"], options["across"]
    t = np.linspace(0.0, 1.0, segments + 1)
    a = np.linspace(-1.0, 1.0, across)
    forward = normalize(direction)
    horizontal = normalize(np.cross(forward, np.array([0.0, 1.0, 0.0])) + rng.normal(0.0, 0.05, 3))
    drooped = normalize(np.cross(horizontal, forward))
    # Integrate the centre line as it bends over under its own weight.
    angles = options["droop"] * t**1.5
    directions = forward[None, :] * np.cos(angles)[:, None] + (-drooped)[None, :] * np.sin(angles)[:, None]
    steps = np.vstack([np.zeros(3), (directions[1:] + directions[:-1]) * 0.5 * (length / segments)])
    centre = base[None, :] + np.cumsum(steps, axis=0)
    normal = np.cross(horizontal[None, :], directions)
    half_width = width * shape(t)
    phase = rng.uniform(0.0, 6.28)
    twist = options["twist"] * t + rng.uniform(-0.2, 0.2)
    wave = options["wave"] * half_width * np.sin(t * 19.0 + phase)
    across_grid, along_grid = a[None, :], t[:, None]
    offset = across_grid * half_width[:, None]
    positions = (
        centre[:, None, :]
        + horizontal[None, None, :] * (offset * np.cos(twist)[:, None])[..., None]
        + normal[:, None, :] * ((offset * np.sin(twist)[:, None]) + options["fold"] * np.abs(offset) + wave[:, None] * across_grid**2)[..., None]
    )
    column = KIND[kind]
    row = 1 if options["aged"] else 0
    variant = rng.uniform(-0.12, 0.12)
    u = (column + 0.5 + np.clip(across_grid * 0.46 + variant, -0.48, 0.48)) / ATLAS_COLUMNS
    v = (row + 0.01 + along_grid * 0.98) / ATLAS_ROWS
    uvs = np.stack([np.broadcast_to(u, offset.shape), np.broadcast_to(v, offset.shape)], axis=-1).reshape(-1, 2)
    sway = np.clip((positions[..., 1] - plant["ground"]) / plant["height"], 0.0, 1.0)
    # Alpha is how far along its leaf a point sits: shaded where leaves crowd together near their bases.
    along_leaf = np.broadcast_to(along_grid, sway.shape)
    colors = np.stack([sway, np.full_like(sway, plant["phase"]), np.full_like(sway, 1.0 if plant["tone"] > 1.5 else float(np.clip(plant["tone"] + rng.uniform(-0.22, 0.22), 0.0, 0.88))), along_leaf], axis=-1).reshape(-1, 4)
    return MeshPart(positions.reshape(-1, 3), grid_faces(segments + 1, across, False), uvs, colors)


def plant_settings(ground: float, height: float, rng: np.random.Generator) -> dict:
    return {"ground": ground, "height": height, "phase": float(rng.uniform(0.0, 1.0)), "tone": float(rng.uniform(0.15, 0.85))}


def leaf_options(rng: np.random.Generator, droop: float, fold: float, wave: float, twist: float, segments: int, across: int, aged_share: float) -> dict:
    return {"droop": droop, "fold": fold, "wave": wave, "twist": twist, "segments": segments, "across": across, "aged": bool(rng.random() < aged_share)}


def grass_tuft(x: float, z: float, height: float, count: int, spread: float, rng: np.random.Generator) -> list:
    """Narrow ribbons fanning out and arching over, like vallisneria or dwarf grass."""
    parts = []
    ground = layout.ground_y(x, z)
    plant = plant_settings(ground, height, rng)
    for _ in range(count):
        base = np.array([x + rng.normal(0, spread * 0.45), ground - 0.004, z + rng.normal(0, spread * 0.35)])
        angle = rng.uniform(0.0, 6.28)
        lean = rng.uniform(0.04, 0.42)
        direction = np.array([np.cos(angle) * lean, 1.0, np.sin(angle) * lean])
        options = leaf_options(rng, rng.uniform(0.35, 1.5), 0.08, 0.14, rng.uniform(-1.2, 1.2), 12 if height > 0.2 else 7, 3, 0.1)
        parts.append(build_leaf(plant, base, direction, height * rng.uniform(0.55, 1.05), max(0.0022, height * 0.016) * rng.uniform(0.75, 1.3), shape_ribbon, "ribbon", rng, options))
    return parts


def sword_plant(x: float, z: float, height: float, rng: np.random.Generator) -> list:
    """Broad, bright leaves on long stalks from a central crown, the big plants on the right of the reference."""
    parts = []
    ground = layout.ground_y(x, z)
    plant = plant_settings(ground, height, rng)
    leaves = int(rng.integers(20, 30))
    for index in range(leaves):
        angle = index * 2.39996 + rng.uniform(-0.2, 0.2)
        rank = index / leaves
        lean = 0.14 + rank * 0.55
        direction = normalize(np.array([np.cos(angle) * lean, 1.0, np.sin(angle) * lean]))
        stalk_length = height * (0.28 + 0.1 * rng.random()) * (1.05 - rank * 0.4)
        base = np.array([x + np.cos(angle) * 0.006, ground - 0.002, z + np.sin(angle) * 0.006])
        parts.append(build_leaf(plant, base, direction, stalk_length, 0.0022, shape_ribbon, "stem", rng, leaf_options(rng, 0.25, 0.0, 0.0, 0.0, 5, 2, 0.0)))
        blade_base = base + direction * stalk_length
        blade = height * rng.uniform(0.45, 0.72) * (1.05 - rank * 0.35)
        options = leaf_options(rng, rng.uniform(0.5, 1.15), 0.22, 0.08, rng.uniform(-0.25, 0.25), 13, 7, 0.24)
        parts.append(build_leaf(plant, blade_base, direction, blade, blade * rng.uniform(0.11, 0.17), shape_sword, "sword", rng, options))
    return parts


def crypt_plant(x: float, z: float, height: float, rng: np.random.Generator) -> list:
    """A rosette of wavy, pointed leaves for the mid-ground and foreground."""
    parts = []
    ground = layout.ground_y(x, z)
    plant = plant_settings(ground, height, rng)
    # A few plants are red-bronze, the accent colour of a planted tank.
    if rng.random() < 0.24:
        plant["tone"] = 2.0
    leaves = int(rng.integers(20, 34))
    for index in range(leaves):
        angle = index * 2.39996 + rng.uniform(-0.3, 0.3)
        lean = rng.uniform(0.25, 1.1)
        direction = normalize(np.array([np.cos(angle) * lean, 1.0, np.sin(angle) * lean]))
        base = np.array([x + rng.normal(0, 0.006), ground - 0.002, z + rng.normal(0, 0.006)])
        length = height * rng.uniform(0.65, 1.15)
        options = leaf_options(rng, rng.uniform(0.3, 1.0), 0.16, 0.42, rng.uniform(-0.35, 0.35), 11, 5, 0.22)
        parts.append(build_leaf(plant, base, direction, length, length * rng.uniform(0.07, 0.105), shape_lance, "crypt", rng, options))
    return parts


def stem_plant(x: float, z: float, height: float, rng: np.random.Generator) -> list:
    """Upright stems carrying whorls of small leaves."""
    parts = []
    ground = layout.ground_y(x, z)
    plant = plant_settings(ground, height, rng)
    for _ in range(int(rng.integers(16, 26))):
        base = np.array([x + rng.normal(0, 0.022), ground - 0.002, z + rng.normal(0, 0.011)])
        lean = rng.normal(0, 0.09, 2)
        direction = normalize(np.array([lean[0], 1.0, lean[1]]))
        stem_height = height * rng.uniform(0.62, 1.05)
        parts.append(build_leaf(plant, base, direction, stem_height, 0.0011, shape_ribbon, "stem", rng, leaf_options(rng, 0.15, 0.0, 0.0, 0.0, 8, 2, 0.0)))
        whorls = int(stem_height / 0.0115)
        for whorl in range(whorls):
            along = (whorl + 0.5) / whorls
            centre = base + direction * stem_height * along
            for leaf in range(3):
                angle = leaf * 2.094 + whorl * 0.95 + rng.uniform(-0.2, 0.2)
                outward = normalize(np.array([np.cos(angle), 0.55 + 0.5 * along, np.sin(angle)]))
                size = rng.uniform(0.016, 0.028) * (1.1 - 0.45 * along)
                parts.append(build_leaf(plant, centre, outward, size, size * 0.24, shape_lance, "rotala", rng, leaf_options(rng, 0.5, 0.15, 0.0, 0.0, 2, 3, 0.06)))
    return parts


def broad_plant(point: np.ndarray, rng: np.random.Generator) -> list:
    """Big, bright lime leaves arching from high on the wood, the crown of the bush in the reference."""
    parts = []
    plant = plant_settings(float(point[1]) - 0.06, 0.34, rng)
    plant["tone"] = float(rng.uniform(0.05, 0.45))
    for index in range(int(rng.integers(9, 16))):
        angle = index * 2.39996 + rng.uniform(-0.4, 0.4)
        lean = rng.uniform(0.2, 0.95)
        direction = normalize(np.array([np.cos(angle) * lean, 1.0, np.sin(angle) * lean * 0.7]))
        stalk = rng.uniform(0.03, 0.08)
        base = point + rng.normal(0, 0.008, 3)
        parts.append(build_leaf(plant, base, direction, stalk, 0.0024, shape_ribbon, "stem", rng, leaf_options(rng, 0.2, 0.0, 0.0, 0.0, 3, 2, 0.0)))
        length = rng.uniform(0.11, 0.21)
        options = leaf_options(rng, rng.uniform(0.5, 1.25), 0.2, 0.09, rng.uniform(-0.25, 0.25), 10, 5, 0.1)
        parts.append(build_leaf(plant, base + direction * stalk, direction, length, length * rng.uniform(0.17, 0.25), shape_sword, "sword", rng, options))
    return parts


def attached_plant(point: np.ndarray, kind: str, rng: np.random.Generator) -> list:
    """Anubias or java fern growing directly from wood and rock."""
    parts = []
    is_fern = kind == "fern"
    if kind == "broad":
        return broad_plant(point, rng)
    height = rng.uniform(0.15, 0.3) if is_fern else rng.uniform(0.075, 0.15)
    plant = plant_settings(float(point[1]) - 0.05, 0.3, rng)
    plant["tone"] = float(rng.uniform(0.2, 0.8))
    for index in range(int(rng.integers(10, 20))):
        angle = index * 2.39996 + rng.uniform(-0.4, 0.4)
        lean = rng.uniform(0.15, 0.8) if is_fern else rng.uniform(0.4, 1.0)
        direction = normalize(np.array([np.cos(angle) * lean, 1.0, np.sin(angle) * lean]))
        base = point + rng.normal(0, 0.006, 3)
        length = height * rng.uniform(0.75, 1.2)
        if is_fern:
            options = leaf_options(rng, rng.uniform(0.3, 1.0), 0.18, 0.28, rng.uniform(-0.3, 0.3), 12, 5, 0.12)
            parts.append(build_leaf(plant, base, direction, length, length * rng.uniform(0.1, 0.14), shape_lance, "fern", rng, options))
        else:
            stalk = length * 0.45
            parts.append(build_leaf(plant, base, direction, stalk, 0.0016, shape_ribbon, "stem", rng, leaf_options(rng, 0.2, 0.0, 0.0, 0.0, 3, 2, 0.0)))
            options = leaf_options(rng, rng.uniform(0.4, 1.1), 0.14, 0.05, rng.uniform(-0.2, 0.2), 8, 5, 0.1)
            parts.append(build_leaf(plant, base + direction * stalk, direction, length, length * rng.uniform(0.28, 0.36), shape_oval, "anubias", rng, options))
    return parts


def moss_clump(point: np.ndarray, normal: np.ndarray, rng: np.random.Generator) -> list:
    """A soft, dense cushion of tiny fronds, lying along the surface it grows on."""
    parts = []
    side = normalize(np.cross(normal, np.array([0.31, 0.87, 0.38])))
    other = np.cross(normal, side)
    plant = plant_settings(float(point[1]) - 0.03, 0.2, rng)
    for _ in range(int(rng.integers(85, 130))):
        # Thick in the middle, thinning to nothing at the edge of the cushion.
        radius = 0.03 * float(rng.random()) ** 0.8
        angle = rng.uniform(0.0, 6.28)
        base = point + (side * np.cos(angle) + other * np.sin(angle)) * radius + normal * rng.uniform(-0.002, 0.006)
        direction = normalize(normal + rng.normal(0, 0.6, 3))
        size = rng.uniform(0.006, 0.013)
        parts.append(build_leaf(plant, base, direction, size, size * 0.3, shape_oval, "moss", rng, leaf_options(rng, 0.5, 0.0, 0.0, 0.0, 3, 3, 0.05)))
    return parts


def fitted(parts: list) -> MeshPart:
    """One whole plant, kept inside the glass."""
    plant = merge_parts(parts)
    return MeshPart(layout.fit_inside(plant.vertices), plant.faces, plant.uvs, plant.colors)


def grow_plants(seed: int) -> MeshPart:
    """The plants still generated: tall background grass, foreground tufts, and fine stems."""
    rng = np.random.default_rng(seed)
    parts = []
    for x, z in layout.TALL_GRASS:
        parts.append(fitted(grass_tuft(x, z, rng.uniform(0.27, 0.34) * layout.SCALE_PLANT, 34, 0.04, rng)))
    for x, z, height in layout.FOREGROUND_TUFTS:
        parts.append(fitted(grass_tuft(x, z, height, 42, 0.04, rng)))
    for x, z, height in layout.STEM_PATCHES:
        parts.append(fitted(stem_plant(x, z, height, rng)))
    return merge_parts(parts)


def paint_leaf_atlas(out_dir: Path, size: int, seed: int) -> None:
    """Paints the leaf atlas: base colour (a = holes), normal, and material (r roughness, b translucency)."""
    rng = np.random.default_rng(seed)
    out_dir.mkdir(parents=True, exist_ok=True)
    cell_width, cell_height = size // ATLAS_COLUMNS, size // ATLAS_ROWS
    palette = {
        "ribbon": ((0.2, 0.36, 0.06), (0.46, 0.58, 0.13), 0.42), "sword": ((0.14, 0.62, 0.03), (0.42, 0.9, 0.07), 0.36),
        "anubias": ((0.05, 0.38, 0.05), (0.14, 0.6, 0.07), 0.36), "fern": ((0.09, 0.46, 0.04), (0.28, 0.72, 0.07), 0.38),
        "crypt": ((0.14, 0.52, 0.04), (0.36, 0.76, 0.07), 0.38), "rotala": ((0.28, 0.42, 0.08), (0.54, 0.64, 0.15), 0.44),
        "moss": ((0.1, 0.38, 0.03), (0.28, 0.62, 0.05), 0.78), "stem": ((0.18, 0.28, 0.08), (0.3, 0.4, 0.12), 0.5),
    }
    color_map = np.zeros((size, size, 4), dtype=np.float32)
    height_map = np.zeros((size, size), dtype=np.float32)
    material = np.zeros((size, size, 4), dtype=np.float32)
    large = noise((size, size), 60, rng)
    medium = noise((size, size), 14, rng)
    small = noise((size, size), 3, rng)
    for kind, column in KIND.items():
        dark, light, roughness = palette[kind]
        dark_c, light_c = np.array(dark, dtype=np.float32), np.array(light, dtype=np.float32)
        for row in range(ATLAS_ROWS):
            aged = row == 1
            top, left = (ATLAS_ROWS - 1 - row) * cell_height, column * cell_width
            v, u = np.mgrid[0:cell_height, 0:cell_width].astype(np.float32)
            along = 1 - v / (cell_height - 1)
            across = u / (cell_width - 1) * 2 - 1
            big, mid, tiny = (field[top : top + cell_height, left : left + cell_width] for field in (large, medium, small))
            midrib = np.exp(-((across / 0.05) ** 2))
            # Side veins sweep out from the midrib toward the tip; ribbons have parallel veins instead.
            if kind == "ribbon" or kind == "stem":
                veins = 0.5 + 0.5 * np.cos(across * 60)
                veins = veins**6
            else:
                sweep = along * 44.0 - np.abs(across) * 7.0 + mid * 0.5
                veins = np.abs(np.sin(sweep)) ** 18
            shade = 0.5 + 0.28 * big + 0.1 * mid + 0.3 * (along - 0.5)
            color = mix(dark_c[None, None], light_c[None, None], np.clip(shade, 0.0, 1.0))
            color = mix(color, light_c[None, None] * 1.25, np.clip(midrib * 0.55 + veins * 0.2, 0.0, 1.0))
            color = color * (1 + tiny[..., None] * 0.07)
            if kind == "fern":
                spots = smoothstep(0.55, 0.8, np.sin(along * 90 + across * 3) * np.sin(across * 26) + mid * 0.2)
                color = mix(color, dark_c[None, None] * 0.35, spots * 0.35)
            if kind == "crypt":
                color = mix(color, np.array([0.34, 0.14, 0.09], dtype=np.float32)[None, None], smoothstep(0.1, 0.8, big) * 0.3 + midrib * 0.12)
            alpha = np.ones_like(along)
            if aged:
                edge = smoothstep(0.55, 0.98, np.abs(across) + mid * 0.16)
                yellow = np.clip(edge * 0.8 + smoothstep(0.35, 0.8, big) * 0.35, 0.0, 1.0)
                color = mix(color, np.array([0.42, 0.36, 0.1], dtype=np.float32)[None, None], yellow)
                # Algae specks and small holes make older leaves look lived-in.
                specks = smoothstep(0.58, 0.72, mid + tiny * 0.35)
                color = mix(color, np.array([0.1, 0.1, 0.05], dtype=np.float32)[None, None], specks * 0.5)
                alpha = 1 - smoothstep(0.72, 0.76, mid * 0.75 + big * 0.4)
            leaf_height = 0.5 + midrib * -0.2 + veins * -0.1 + mid * 0.1 + tiny * 0.012
            color_map[top : top + cell_height, left : left + cell_width, :3] = color
            color_map[top : top + cell_height, left : left + cell_width, 3] = alpha
            height_map[top : top + cell_height, left : left + cell_width] = leaf_height
            material[top : top + cell_height, left : left + cell_width, 0] = roughness + tiny * 0.04
            material[top : top + cell_height, left : left + cell_width, 2] = 0.7
            material[top : top + cell_height, left : left + cell_width, 3] = 1.0
    dy, dx = np.gradient(height_map)
    normal = np.stack([-dx * 14, dy * 14, np.ones_like(height_map)], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    write_png(out_dir / "baseColor.png", color_map)
    write_png(out_dir / "normal.png", np.concatenate([normal * 0.5 + 0.5, np.ones((size, size, 1), dtype=np.float32)], axis=-1))
    write_png(out_dir / "material.png", material)
