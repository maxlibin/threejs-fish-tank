"""Where everything sits in the tank, in world metres (x right, y up, z toward the viewer).

Composition follows reference/aquascape/inspiration.png: a branch sweeping up on the left, a low
log forming a cave in the middle, craggy rocks centre-right, tall plants at both ends, open water
in the upper middle, a low foreground, and a pale strip of sand along the front glass.
"""
import numpy as np

INNER_X = 1.485
INNER_Z = 0.485
# Layout tables in real metres were drawn for a tank with this half depth, and spread out to fit.
DRAWN_INNER_Z = 0.335
DEEPEN = INNER_Z / DRAWN_INNER_Z
FLOOR_Y = 0.615
SURFACE_Y = 1.92
GLASS_CLEARANCE = 0.004

# The tables below are drawn on a 1.2 m design sheet and scaled to the real tank here.
SHEET_X, SHEET_Z, SHEET_FLOOR, SHEET_SURFACE = 0.588, 0.213, 0.762, 1.22
SCALE_X = INNER_X / SHEET_X
SCALE_Z = INNER_Z / SHEET_Z
SCALE_Y = (SURFACE_Y - FLOOR_Y) / (SHEET_SURFACE - SHEET_FLOOR)
SCALE_SIZE = 2.1
SCALE_ROCK = 2.75
# Plants and the substrate grow less than the water does, so leaves stay a believable size.
SCALE_PLANT = 2.15
SCALE_TERRAIN = 1.7


def sheet_y(y: float) -> float:
    """Converts a height on the design sheet to a real height in the tank."""
    return FLOOR_Y + (y - SHEET_FLOOR) * SCALE_Y


def terrain_height(x_real: np.ndarray, z_real: np.ndarray) -> np.ndarray:
    """Substrate height above the floor glass: a low front rising to a bank at the back."""
    return _sheet_terrain(x_real / SCALE_X, z_real / SCALE_Z) * SCALE_TERRAIN


def _sheet_terrain(x: np.ndarray, z: np.ndarray) -> np.ndarray:
    bank = 0.018 + 0.1 * np.clip((0.1 - z) / 0.28, 0.0, 1.0) ** 0.8
    centre_mound = 0.03 * np.exp(-(((x - 0.14) / 0.2) ** 2) - (((z + 0.04) / 0.13) ** 2))
    left_mound = 0.028 * np.exp(-(((x + 0.28) / 0.2) ** 2) - (((z + 0.05) / 0.14) ** 2))
    ripple = 0.003 * np.sin(x * 31 + np.sin(z * 17) * 2) * np.sin(z * 23 + x * 7)
    return bank + centre_mound + left_mound + ripple


def sand_mask(x_real: np.ndarray, z_real: np.ndarray) -> np.ndarray:
    """1 on the pale sand strip along the front, 0 on dark soil, with a natural wandering edge."""
    x, z = x_real / SCALE_X, z_real / SCALE_Z
    edge = 0.055 + 0.022 * np.sin(x * 9.0 + 1.1) + 0.01 * np.sin(x * 23.0)
    return np.clip((z - edge) / 0.012, 0.0, 1.0)


def fit_inside(vertices: np.ndarray) -> np.ndarray:
    """Keeps one object inside the glass and under the water: shrunk if too large, then moved in."""
    low = np.array([-INNER_X + GLASS_CLEARANCE, FLOOR_Y + GLASS_CLEARANCE, -INNER_Z + GLASS_CLEARANCE])
    high = np.array([INNER_X - GLASS_CLEARANCE, SURFACE_Y - GLASS_CLEARANCE, INNER_Z - GLASS_CLEARANCE])
    lowest, highest = vertices.min(axis=0), vertices.max(axis=0)
    shrink = min(1.0, float(((high - low) / np.maximum(highest - lowest, 1e-6)).min()))
    centre = (lowest + highest) / 2
    scaled = centre + (vertices - centre) * shrink
    lowest, highest = scaled.min(axis=0), scaled.max(axis=0)
    return scaled + np.maximum(low - lowest, 0.0) - np.maximum(highest - high, 0.0)


def ground_y(x: float, z: float) -> float:
    return FLOOR_Y + float(terrain_height(np.array(x), np.array(z)))


# Equipment, from the floor to above the water; (name, x, z, radius, bottom y).
PIPES = [("filter_intake", 1.4, -0.41, 0.014, 0.85), ("heater", 1.28, -0.43, 0.015, 1.1), ("filter_return", -1.4, -0.39, 0.014, 1.6)]

# Only tall background grass, foreground tufts, and stems are still generated; every other plant is a scan.
TALL_GRASS = [(-0.55, -0.15), (-0.47, -0.175), (-0.36, -0.18)]
FOREGROUND_TUFTS = [(-0.54, 0.1, 0.13), (-0.47, 0.135, 0.075), (-0.51, 0.05, 0.15), (-0.24, 0.13, 0.03), (0.27, 0.13, 0.03), (0.54, 0.12, 0.06)]
STEM_PATCHES = [(0.12, -0.19, 0.2), (-0.13, -0.19, 0.16), (-0.28, -0.185, 0.24)]


def _spot(x: float, z: float) -> tuple:
    return (x * SCALE_X, z * SCALE_Z)


def _doubled(rows: list) -> list:
    """Each spot plus a neighbour, so the larger tank stays as lush as the design sheet."""
    result = []
    for index, row in enumerate(rows):
        x, z = row[0], row[1]
        # Irregular neighbours, so that plants do not fall into visible rows.
        shift = (0.043, -0.061, 0.029, -0.034, 0.057)[index % 5]
        depth = (0.018, -0.024, 0.031, -0.012, -0.03)[index % 5]
        for offset_x, offset_z, scale in ((0.0, 0.0, 1.0), (shift, depth, 0.74)):
            result.append((*_spot(x + offset_x, z + offset_z), *[value * SCALE_PLANT * scale for value in row[2:]]))
    return result


TALL_GRASS = _doubled(TALL_GRASS)
FOREGROUND_TUFTS = _doubled(FOREGROUND_TUFTS)
STEM_PATCHES = _doubled(STEM_PATCHES)

# Rocks: (x, z, largest dimension, share of it sunk into the ground, kind). Real metres.
ROCK_PLACEMENTS = [
    (0.42, 0.04, 0.5, 0.2, "craggy"),
    (0.47, -0.03, 0.34, 0.02, "mossy"),
    (0.78, -0.05, 0.56, 0.2, "mossy"),
    (0.98, 0.07, 0.34, 0.25, "craggy"),
    (0.14, 0.1, 0.26, 0.28, "mossy"),
    (-0.48, -0.02, 0.56, 0.2, "mossy"),
    (-0.86, 0.03, 0.42, 0.22, "craggy"),
    (-0.2, -0.04, 0.48, 0.2, "mossy"),
    (-0.08, 0.16, 0.2, 0.25, "mossy"),
    (0.66, 0.17, 0.24, 0.25, "craggy"),
    (-1.13, 0.14, 0.22, 0.25, "mossy"),
    (1.26, 0.13, 0.22, 0.25, "mossy"),
]

# Trunks: (scan, start, end, thickness, roll). Real metres; the two low logs are as heavy as the photo's.
TRUNKS = [
    ("dead_tree_trunk", (-1.28, 0.84, 0.03), (0.42, 1.0, -0.08), 0.33, 0.4),
    ("dead_tree_trunk_02", (-0.1, 0.99, 0.0), (1.3, 0.92, -0.03), 0.27, 1.3),
    ("dead_tree_trunk_02", (0.1, 0.95, -0.02), (-1.08, 1.8, -0.22), 0.2, 2.1),
    ("dead_tree_trunk", (0.42, 0.98, -0.12), (0.72, 1.46, -0.25), 0.13, 2.6),
]

# Real forked branches rising from the logs: (scan, start, end, thickness, roll, tip share, bend).
FORKED_BRANCHES = [
    ("dead_quiver_branch_01", (-0.5, 1.0, -0.02), (-0.82, 1.42, -0.18), 0.17, 0.5, 0.35, 0.05),
    # The two tall limbs rising from the middle of the main log, leaning apart.
    ("dead_quiver_branch_02", (-0.16, 0.98, 0.0), (-0.5, 1.72, -0.2), 0.2, 0.7, 0.22, 0.11),
    ("dead_quiver_branch_01", (0.02, 1.0, -0.04), (0.3, 1.66, -0.22), 0.19, 2.5, 0.2, -0.1),
    ("dead_quiver_branch_01", (0.32, 1.02, -0.08), (0.58, 1.34, -0.2), 0.12, 3.1, 0.35, 0.04),
]

# Real gnarled branches resting on the logs: (x, base height, z, longest dimension, turn).
BRANCHES = [(-0.42, 1.0, -0.08, 1.15, 1.57), (0.3, 1.04, -0.14, 1.05, -1.57), (0.86, 0.96, -0.18, 0.9, 1.57)]

# Dense plant masses that fish keep out of: (x, z, height above ground, radius).
PLANT_MASSES = [(0.7, -0.17, 0.3, 0.2), (1.05, -0.17, 0.3, 0.22), (0.7, -0.17, 0.62, 0.17), (1.05, -0.17, 0.62, 0.18), (0.7, -0.15, 0.9, 0.18), (1.05, -0.15, 0.9, 0.18), (-1.05, -0.1, 0.25, 0.22), (-1.25, -0.1, 0.45, 0.2)]


def deepen_z(z: float) -> float:
    return z * DEEPEN


def deepen_area(area: tuple) -> tuple:
    """An (x low, x high, z low, z high) area, spread to fill the deeper tank."""
    return (area[0], area[1], area[2] * DEEPEN, area[3] * DEEPEN)


ROCK_PLACEMENTS = [(x, z * DEEPEN, *rest) for x, z, *rest in ROCK_PLACEMENTS]
TRUNKS = [(scan, (start[0], start[1], start[2] * DEEPEN), (end[0], end[1], end[2] * DEEPEN), *rest) for scan, start, end, *rest in TRUNKS]
FORKED_BRANCHES = [(scan, (start[0], start[1], start[2] * DEEPEN), (end[0], end[1], end[2] * DEEPEN), *rest) for scan, start, end, *rest in FORKED_BRANCHES]
BRANCHES = [(x, y, z * DEEPEN, *rest) for x, y, z, *rest in BRANCHES]
# Only the dense core of each mass stops a fish; it pushes through the leaves around it, and they shake.
PLANT_MASSES = [(x, z * DEEPEN, height, radius * 0.45) for x, z, height, radius in PLANT_MASSES]

