"""Paints a fish's texture maps as a flat side view, with numpy.

Maps: baseColor (rgb, a = opacity), normal (tangent space), material (r roughness, g metalness,
b iridescence, a thickness), and eye (iris). Fish skin detail all derives from one scale height field.
"""
import struct
import zlib
from pathlib import Path

import bpy
import numpy as np

from fish_body import CANVAS_SPAN, PAIRED_CANVAS_OFFSET, resample_polyline, smooth_interp

SEED = 7
NOSE_MARGIN = 0.04


def write_png(path: Path, image: np.ndarray) -> None:
    """Writes an RGBA float image (0-1) as an 8-bit PNG."""
    data = (np.clip(image, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
    height, width = data.shape[:2]
    raw = np.concatenate([np.zeros((height, 1), dtype=np.uint8), data.reshape(height, -1)], axis=1).tobytes()

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", zlib.crc32(tag + payload))

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def noise(shape: tuple, cutoff: float, rng: np.random.Generator) -> np.ndarray:
    """Smooth noise, normalized to about -1..1, whose feature size is `cutoff` pixels."""
    spectrum = np.fft.rfft2(rng.standard_normal(shape))
    fy = np.fft.fftfreq(shape[0])[:, None]
    fx = np.fft.rfftfreq(shape[1])[None, :]
    result = np.fft.irfft2(spectrum * np.exp(-((fx**2 + fy**2) * (cutoff * 2.4) ** 2)), s=shape).astype(np.float32)
    return result / (result.std() * 2.5)


def smoothstep(low: float, high: float, value: np.ndarray) -> np.ndarray:
    t = np.clip((value - low) / (high - low), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def mix(a: np.ndarray, b: np.ndarray, t: np.ndarray) -> np.ndarray:
    return a * (1 - t[..., None]) + b * t[..., None]


def cell_random(row: np.ndarray, column: np.ndarray, salt: int) -> np.ndarray:
    """A repeatable random value in 0..1 per scale."""
    value = np.sin(row * 127.1 + column * 311.7 + salt * 74.7) * 43758.5453
    return (value - np.floor(value)).astype(np.float32)


def paint_scales(x: np.ndarray, t: np.ndarray, half: np.ndarray, profile: dict, warp: np.ndarray) -> tuple:
    """Overlapping scales, front ones over back ones. Returns height (0-1), random value, exposed-edge mask, and tilt."""
    row_height = 2.0 * float(np.max(half)) / profile["scale_rows"]
    column_width = profile["scale_length"]
    # A slow warp keeps rows from reading as a printed grid.
    row_coord = t * half / row_height + warp * 0.9
    warped_x = x + warp * 0.008
    radius = 0.82

    best_height = np.zeros_like(x, dtype=np.float32)
    best_random = np.zeros_like(x, dtype=np.float32)
    best_edge = np.zeros_like(x, dtype=np.float32)
    best_tilt_x = np.zeros_like(x, dtype=np.float32)
    best_tilt_y = np.zeros_like(x, dtype=np.float32)
    filled = np.zeros_like(x, dtype=bool)
    nearest_row = np.floor(row_coord)
    # Front-most candidates are painted first and win, since each scale's free edge overlaps the next.
    for offset_column in (-1.5, -1.0, -0.5, 0.0, 0.5, 1.0):
        for offset_row in (0.0, -1.0, 1.0):
            row = nearest_row + offset_row
            shift = 0.5 * (np.mod(row, 2.0))
            column_coord = warped_x / column_width + shift
            column = np.floor(column_coord) + offset_column
            dx = column_coord - (column + 0.5)
            dy = (row_coord - (row + 0.5)) * 1.3
            distance = np.hypot(dx, dy)
            inside = (distance < radius) & ~filled
            if not np.any(inside):
                continue
            exposed = np.clip((dx + radius) / (2 * radius), 0.0, 1.0)
            height = 0.25 + 0.75 * exposed**1.5 * (1 - smoothstep(0.72, 1.0, distance / radius) * 0.75)
            best_height[inside] = height[inside]
            best_random[inside] = cell_random(row[inside], column[inside], 1)
            best_tilt_x[inside] = cell_random(row[inside], column[inside], 2) - 0.5
            best_tilt_y[inside] = cell_random(row[inside], column[inside], 3) - 0.5
            best_edge[inside] = smoothstep(0.82, 0.98, distance[inside] / radius)
            filled |= inside
    return best_height, best_random, best_edge, best_tilt_x, best_tilt_y


def paint_body(canvas: dict, profile: dict, rng: np.random.Generator) -> None:
    """Paints the body: colour zones, dark bars, scales, head markings."""
    x, y = canvas["x"], canvas["y"]
    colors = {name: np.array(value, dtype=np.float32) for name, value in profile["colors"].items()}
    end = profile["body_end"]
    in_range = (x >= 0.0) & (x <= end)
    top = smooth_interp(profile["top"], x)
    bottom = smooth_interp(profile["bottom"], x)
    half = np.maximum((top - bottom) * 0.5, 1e-4)
    centre = (top + bottom) * 0.5
    t = (y - centre) / half
    mask = in_range & (np.abs(t) <= 1.015)

    size = x.shape[0]
    wide, fine, micro = noise((size, size), 50, rng), noise((size, size), 10, rng), noise((size, size), 2.2, rng)
    colour_drift = noise((size, size), 180, rng)

    height, scale_random, edge, tilt_x, tilt_y = paint_scales(x, t, half, profile, wide)
    head = 1.0 - smoothstep(profile["gill_arc"]["x"] + 0.05, profile["gill_arc"]["x"] + 0.13, x + wide * 0.012)

    # Colour zones: pale belly, silver flank, olive-gold back and head.
    flank = mix(colors["belly"][None, None], colors["flank"][None, None], smoothstep(profile.get("red_from", -0.65), profile.get("red_to", 0.0), t + colour_drift * 0.12))
    backed = mix(flank, colors["back"][None, None], smoothstep(0.15, 0.72, t + wide * 0.08))
    painted = mix(backed, colors["head"][None, None], head * smoothstep(-0.55, 0.15, t) * 0.92)

    # Per-scale shifts in tone are most of what makes the flank read as scales from a distance.
    tone = 1.0 + (scale_random - 0.5) * 0.09 * (1 - head) + fine * 0.035 + micro * 0.02
    painted = painted * tone[..., None]
    painted = painted * (1.0 - 0.07 * edge * (1 - head))[..., None]

    # Dark vertical bars with soft, mottled edges, and a scatter of pigment cells near them.
    bar_total = np.zeros_like(x, dtype=np.float32)
    for bar in profile["bars"]:
        path = bar["x"] + bar["curve"] * (t * t) - bar["curve"] * 0.5
        wobble = fine * 0.0012 + wide * 0.005
        distance = np.abs(x + wobble - path)
        # Bars narrow toward the belly and are soft-edged, as pigment under the scales is.
        local_width = bar["width"] * (0.72 + 0.28 * smoothstep(-1.0, 0.4, t))
        band = (1 - smoothstep(local_width * 0.15, local_width * 1.1, distance)) ** 1.2
        limit = smoothstep(bar["bottom"] - 0.04, bar["bottom"] + 0.04, t) * (1 - smoothstep(bar["top"] - 0.04, bar["top"] + 0.04, t))
        bar_total = np.maximum(bar_total, band * limit)
    speckle = smoothstep(0.35, 0.8, micro + fine * 0.5)
    bar_total = np.clip(bar_total + speckle * smoothstep(0.0, 0.5, bar_total) * 0.08, 0.0, 1.0)
    painted = mix(painted, colors["bar"][None, None], bar_total * 0.9)

    # A cardinal tetra's neon stripe: its colour shifts with viewing angle, from iridescence.
    stripe = np.zeros_like(x, dtype=np.float32)
    if "stripe" in profile:
        band = profile["stripe"]
        along = smoothstep(band["start"], band["start"] + 0.03, x) * (1 - smoothstep(band["end"] - 0.05, band["end"], x))
        stripe = (1 - smoothstep(band["half_width"] * 0.72, band["half_width"] * 1.1, np.abs(t - band["centre"] + wide * 0.015))) * along
        painted = mix(painted, colors["stripe"][None, None], stripe)

    # Dark pigment blotches, for the speckled catfish.
    if "spots" in profile:
        blotches = smoothstep(0.42, 0.6, noise((size, size), 22, rng) + fine * 0.2) * smoothstep(-0.9, -0.2, t)
        painted = mix(painted, colors["bar"][None, None] + 0.04, blotches * profile["spots"])

    # Mouth line, nostril, gill cover shadow.
    mouth = profile["mouth"]
    mouth_line = (1 - smoothstep(0.0, 0.0028, np.abs(y - mouth["y"]))) * (1 - smoothstep(mouth["length"] * 0.7, mouth["length"], x))
    painted = painted * (1 - 0.8 * mouth_line)[..., None]
    gill = profile["gill_arc"]
    gill_distance = np.hypot(x - gill["x"], (y - gill["y"]) * 0.82) + wide * 0.003
    gill_edge = np.exp(-(((gill_distance - gill["radius"]) / 0.0028) ** 2)) * smoothstep(gill["x"], gill["x"] + 0.04, x)
    painted = painted * (1 - 0.1 * gill_edge)[..., None]
    nostril = np.hypot(x - 0.055, y - 0.05) < 0.0035
    painted = np.where(nostril[..., None], painted * 0.25, painted)

    # Height: scales on the flank, fading to smooth skin on the head.
    skin_height = height * (1 - head) * 0.34 + (0.4 + fine * 0.025) * head - gill_edge * 0.16 - mouth_line * 0.4 + micro * 0.012

    silver = (1 - bar_total) * (1 - head * 0.5) * smoothstep(0.75, -0.2, t) * profile["silver_share"]
    roughness = 0.4 - 0.14 * silver + (scale_random - 0.5) * 0.08 * (1 - head) + micro * 0.03
    # Fish silver is a mirror of guanine crystals, so it behaves more like metal than paint.
    metalness = np.clip(0.28 * (1 - bar_total) + silver * (0.55 + (scale_random - 0.5) * 0.3), 0.0, 1.0)
    iridescence = np.clip(silver * (0.3 + scale_random * 0.12), 0.0, 1.0)
    if profile.get("stripe_shines", False):
        metalness = np.maximum(metalness, stripe * 0.92)
        iridescence = np.maximum(iridescence, stripe)
        roughness = roughness * (1 - stripe * 0.45)

    canvas["color"][mask] = painted[mask]
    canvas["alpha"][mask] = 1.0
    canvas["height"][mask] = skin_height[mask]
    canvas["roughness"][mask] = roughness[mask]
    canvas["metalness"][mask] = metalness[mask]
    canvas["iridescence"][mask] = iridescence[mask]
    canvas["thickness"][mask] = 1.0
    # Each scale catches the light at its own angle, which is what makes real fish sparkle.
    canvas["tilt_x"][mask] = (tilt_x * (1 - head) * 0.11)[mask]
    canvas["tilt_y"][mask] = (tilt_y * (1 - head) * 0.11)[mask]


def rasterize_param(canvas: dict, fin: dict, offset: tuple, samples: int) -> tuple:
    """Maps canvas pixels to fin coordinates: s across the rays, t from base to tip, by dense splatting."""
    size = canvas["size"]
    columns = samples
    base = resample_polyline(fin["base"], columns)
    tip = resample_polyline(fin["tip"], columns)
    s_values = np.linspace(0.0, 1.0, columns)
    t_values = np.linspace(0.0, 1.0, samples)
    s_map = np.full((size, size), -1.0, dtype=np.float32)
    t_map = np.full((size, size), -1.0, dtype=np.float32)
    for t in t_values:
        point = base * (1 - t**1.15) + tip * t**1.15
        px = (point[:, 0] + offset[0] + NOSE_MARGIN) / CANVAS_SPAN * size
        py = (CANVAS_SPAN * 0.5 - (point[:, 1] + offset[1])) / CANVAS_SPAN * size
        ix, iy = np.clip(px.astype(int), 0, size - 1), np.clip(py.astype(int), 0, size - 1)
        s_map[iy, ix] = s_values
        t_map[iy, ix] = t
    return s_map, t_map


def fill_small_holes(s_map: np.ndarray, t_map: np.ndarray) -> None:
    """Fills single-pixel gaps left by splatting, from each side in turn."""
    for shift in ((0, 1), (0, -1), (1, 0), (-1, 0), (0, 1), (1, 0)):
        holes = s_map < 0.0
        s_next, t_next = np.roll(s_map, shift, axis=(0, 1)), np.roll(t_map, shift, axis=(0, 1))
        use = holes & (s_next >= 0.0)
        s_map[use] = s_next[use]
        t_map[use] = t_next[use]


def paint_fin(canvas: dict, fin: dict, offset: tuple, base_color: np.ndarray, band_color: np.ndarray, rng: np.random.Generator) -> None:
    """Paints a fin: visible rays, thin membrane, smoky colour, dark bands, fraying toward the tips."""
    size = canvas["size"]
    s_map, t_map = rasterize_param(canvas, fin, offset, 3200)
    fill_small_holes(s_map, t_map)
    mask = s_map >= 0.0
    # Do not paint over the body.
    mask &= canvas["alpha"] < 0.99

    fine = noise((size, size), 5, rng)
    rays = fin["rays"]
    ray_phase = s_map * (rays - 1)
    ray_distance = np.abs(ray_phase - np.round(ray_phase))
    ray_width = 0.1 + 0.05 * (1 - t_map)
    ray_line = 1 - smoothstep(ray_width * 0.5, ray_width * 1.4, ray_distance)
    # Rays split into finer branches toward the tip.
    branch_phase = ray_phase * 2.0
    branch_distance = np.abs(branch_phase - np.round(branch_phase))
    branch_line = (1 - smoothstep(0.08, 0.22, branch_distance)) * smoothstep(0.45, 0.8, t_map)
    all_rays = np.maximum(ray_line, branch_line * 0.7)

    # Fins carry rows of small dark spots along the rays, seen clearly in the reference photo.
    segment = np.sin(t_map * 95.0 + s_map * 13.0 + fine * 1.4 + np.round(ray_phase) * 2.1)
    ray_spots = smoothstep(0.3, 0.95, segment) * ray_line * (0.45 + 0.55 * fine)

    membrane = fin["opacity"] * (0.82 + fine * 0.1) * (1 - smoothstep(0.86, 1.0, t_map) * 0.55)
    alpha = np.clip(membrane * (0.8 + 0.2 * smoothstep(0.75, 0.1, t_map)) + all_rays * 0.28, 0.0, 1.0)

    color = base_color[None, None] * (0.92 + fine[..., None] * 0.1)
    color = mix(color, base_color[None, None] * 0.55, all_rays * 0.3)
    color = mix(color, band_color[None, None], np.clip(ray_spots, 0.0, 1.0) * 0.5)
    if fin["bands"] > 0.0:
        leading = 1 - smoothstep(0.0, 0.12, s_map if fin["base"][0][1] != 0 else s_map)
        trailing_band = np.exp(-(((s_map - fin["bands"]) / 0.075) ** 2))
        dark = np.clip(trailing_band * 0.85 + leading * 0.7, 0.0, 1.0) * smoothstep(0.0, 0.06, t_map)
        color = mix(color, band_color[None, None], dark * 0.93)
        alpha = np.clip(alpha + dark * 0.25, 0.0, 1.0)

    height = 0.5 + all_rays * 0.35 + fine * 0.015
    canvas["color"][mask] = color[mask]
    canvas["alpha"][mask] = alpha[mask]
    canvas["height"][mask] = height[mask]
    canvas["roughness"][mask] = 0.46
    canvas["metalness"][mask] = 0.0
    canvas["iridescence"][mask] = 0.12
    canvas["thickness"][mask] = np.clip(0.12 + all_rays[mask] * 0.3, 0.0, 1.0)


def load_photo(path: str) -> np.ndarray:
    """Reads a photo as rows from the top, in its stored colour values."""
    image = bpy.data.images.load(path)
    width, height = image.size
    pixels = np.zeros(width * height * image.channels, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    return pixels.reshape(height, width, pixels.shape[0] // (width * height))[::-1, :, :3]


def sample_photo(photo: np.ndarray, px: np.ndarray, py: np.ndarray) -> np.ndarray:
    """Bilinear lookup at pixel positions, clamped to the picture."""
    height, width = photo.shape[:2]
    x = np.clip(px, 0.0, width - 1.001)
    y = np.clip(py, 0.0, height - 1.001)
    x0, y0 = x.astype(np.int32), y.astype(np.int32)
    fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    top = photo[y0, x0] * (1 - fx) + photo[y0, x0 + 1] * fx
    bottom = photo[y0 + 1, x0] * (1 - fx) + photo[y0 + 1, x0 + 1] * fx
    return top * (1 - fy) + bottom * fy


def fish_to_photo(profile: dict, x: np.ndarray, y: np.ndarray) -> tuple:
    """Where a position on the fish falls in its photo."""
    photo = profile["photo"]
    nose, tail = np.array(photo["nose"], dtype=float), np.array(photo["tail"], dtype=float)
    axis = tail - nose
    up = np.array([axis[1], -axis[0]])
    if up[1] > 0:
        up = -up
    return nose[0] + x * axis[0] + y * up[0], nose[1] + x * axis[1] + y * up[1]


def variety_skin(variety: dict, t: np.ndarray, detail: np.ndarray, rng: np.random.Generator) -> tuple:
    """A colour variety of a barred fish: its own colours, paler toward the belly, keeping only the photo's fine scales."""
    bellyward = np.clip((1.0 - t) / 2.0, 0.0, 1.0)
    scales = 1.0 + np.clip(detail * 5.0, -0.42, 0.42)[..., None]
    size = t.shape[0]
    painted = mix(np.array(variety["back"], dtype=np.float32)[None, None], np.array(variety["belly"], dtype=np.float32)[None, None], bellyward)
    # Koi-style varieties carry irregular patches of colour.
    for patch in variety["patches"]:
        field = noise((size, size), patch["cells"], rng)
        share = smoothstep(patch["above"], patch["above"] + 0.14, field)
        painted = mix(painted, np.array(patch["color"], dtype=np.float32)[None, None], share)
    fins = np.array(variety["fin"], dtype=np.float32)[None, None] * (0.8 + np.clip(detail * 3.0, -0.3, 0.3))[..., None]
    return np.clip(painted * scales, 0.0, 1.0), np.clip(fins, 0.0, 1.0)


def overlay_photo(canvas: dict, profile: dict, root: Path, size: int, rng: np.random.Generator) -> None:
    """Replaces the painted skin with the real fish's photo, and derives surface detail from it."""
    photo = load_photo(str(root / profile["photo"]["file"]))
    x, y = canvas["x"], canvas["y"]
    end = profile["body_end"]
    top = smooth_interp(profile["top"], x)
    bottom = smooth_interp(profile["bottom"], x)
    half = np.maximum((top - bottom) * 0.5, 1e-4)
    centre = (top + bottom) * 0.5
    t = (y - centre) / half
    # The painted body can run a little past the traced outline, and would show as a pale block at the tail.
    body = ((x >= 0.0) & (x <= end) & (np.abs(t) <= 1.015)) | (canvas["body_alpha"] >= 0.99)
    # Sample just inside the outline, so that the photo's background cannot bleed onto the edge.
    px, py = fish_to_photo(profile, x, np.where(body, centre + np.clip(t, -1.0, 1.0) * half * 0.955, y))
    sampled = sample_photo(photo, px, py)

    main_area = x < 1.03
    fins = (canvas["alpha"] > 0.0) & ~body & main_area
    grey = sampled @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
    blur = np.fft.irfft2(np.fft.rfft2(grey) * np.exp(-((np.fft.rfftfreq(size)[None, :] ** 2 + np.fft.fftfreq(size)[:, None] ** 2) * (14.0 * size / 2048) ** 2)), s=(size, size)).astype(np.float32)
    detail = grey - blur

    if "variety" in profile["photo"]:
        variety_body, variety_fins = variety_skin(profile["photo"]["variety"], t, detail, rng)
        canvas["color"][body] = variety_body[body]
        canvas["color"][fins] = variety_fins[fins]
    elif profile["photo"]["fin_style"] == "photo":
        canvas["color"][body | fins] = sampled[body | fins]
    else:
        canvas["color"][body] = sampled[body]
        # A nearly clear fin: only the rays show, from the photo's fine detail.
        pale = np.clip(0.8 + detail * 3.2, 0.0, 1.0)
        canvas["color"][fins] = (pale[..., None] * np.array([0.92, 0.9, 0.86], dtype=np.float32))[fins]
    canvas["height"][body | fins] = (0.5 + detail * 0.8)[body | fins]
    canvas["metalness"][body] = 0.06
    canvas["roughness"][body] = 0.42
    # Blue-green where the photo's neon stripe shines, which then shifts with viewing angle.
    neon = np.clip((sampled[..., 2] - sampled[..., 0]) * 2.4 - 0.1, 0.0, 1.0)
    canvas["iridescence"][body] = (0.12 + neon * 0.8)[body]
    canvas["tilt_x"][body] = 0.0
    canvas["tilt_y"][body] = 0.0


def paint_photo_eye(profile: dict, root: Path, size: int) -> np.ndarray:
    """The eye, cut straight from the photo, with coordinates matching the eye mesh's side-on UVs."""
    photo = load_photo(str(root / profile["photo"]["file"]))
    eye = profile["photo"]["eye"]
    nose, tail = np.array(profile["photo"]["nose"], dtype=float), np.array(profile["photo"]["tail"], dtype=float)
    axis = (tail - nose) / np.linalg.norm(tail - nose)
    up = np.array([axis[1], -axis[0]])
    if up[1] > 0:
        up = -up
    row, column = np.mgrid[0:size, 0:size].astype(np.float32) / (size - 1) * 2 - 1
    px = eye[0] + (column * axis[0] - row * up[0]) * eye[2] * 1.02
    py = eye[1] + (column * axis[1] - row * up[1]) * eye[2] * 1.02
    return np.concatenate([sample_photo(photo, px, py), np.ones((size, size, 1), dtype=np.float32)], axis=-1)


def height_to_normal(height: np.ndarray, strength: float, tilt_x: np.ndarray, tilt_y: np.ndarray) -> np.ndarray:
    """Derives a tangent-space normal map; rows run top to bottom, so y is flipped."""
    dy, dx = np.gradient(height)
    normal = np.stack([-dx * strength + tilt_x, dy * strength + tilt_y, np.ones_like(height)], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    return normal * 0.5 + 0.5


def paint_iris(profile: dict, size: int, rng: np.random.Generator) -> np.ndarray:
    """The eye seen from the side: black pupil, red-gold iris, dark rim."""
    colors = profile["colors"]
    v, u = np.mgrid[0:size, 0:size].astype(np.float32) / (size - 1) * 2 - 1
    radius = np.hypot(u, v)
    angle = np.arctan2(v, u)
    fibres = 0.86 + 0.14 * (np.sin(angle * 62) * 0.5 + np.sin(angle * 141 + 1.3) * 0.5)
    outer = np.array(colors["iris_outer"], dtype=np.float32)
    inner = np.array(colors["iris_inner"], dtype=np.float32)
    iris = mix(inner[None, None], outer[None, None], smoothstep(0.42, 0.72, radius))
    iris = iris * fibres[..., None] * (0.9 + noise((size, size), 8, rng)[..., None] * 0.14)
    iris = mix(iris, np.array([0.008, 0.007, 0.007], dtype=np.float32)[None, None], 1 - smoothstep(0.4, 0.44, radius))
    iris = mix(iris, np.array([0.02, 0.02, 0.018], dtype=np.float32)[None, None], smoothstep(0.7, 0.9, radius))
    return np.concatenate([iris, np.ones((size, size, 1), dtype=np.float32)], axis=-1)


def bake_fish_textures(profile: dict, out_dir: Path, size: int) -> None:
    """Paints every map for a fish into out_dir."""
    rng = np.random.default_rng(SEED)
    out_dir.mkdir(parents=True, exist_ok=True)
    rows, columns = np.mgrid[0:size, 0:size].astype(np.float32)
    canvas = {
        "size": size,
        "x": (columns + 0.5) / size * CANVAS_SPAN - NOSE_MARGIN,
        "y": CANVAS_SPAN * 0.5 - (rows + 0.5) / size * CANVAS_SPAN,
        "color": np.zeros((size, size, 3), dtype=np.float32),
        "alpha": np.zeros((size, size), dtype=np.float32),
        "height": np.full((size, size), 0.5, dtype=np.float32),
        "roughness": np.full((size, size), 0.5, dtype=np.float32),
        "metalness": np.zeros((size, size), dtype=np.float32),
        "iridescence": np.zeros((size, size), dtype=np.float32),
        "thickness": np.zeros((size, size), dtype=np.float32),
        "tilt_x": np.zeros((size, size), dtype=np.float32),
        "tilt_y": np.zeros((size, size), dtype=np.float32),
    }
    colors = profile["colors"]
    fin_color = np.array(colors["fin"], dtype=np.float32)
    band = np.array(colors["fin_band"], dtype=np.float32)

    paint_body(canvas, profile, rng)
    canvas["body_alpha"] = canvas["alpha"].copy()
    for fin in profile["fins"].values():
        paint_fin(canvas, fin, (0.0, 0.0), fin_color, band, rng)
    paired_colors = {"pectoral": fin_color * 1.1, "ventral": np.array(colors["ventral"], dtype=np.float32), "barbel": fin_color}
    for name, fin in profile["paired_fins"].items():
        paint_fin(canvas, fin, PAIRED_CANVAS_OFFSET[name], paired_colors[name], band, rng)

    root = Path(__file__).resolve().parent.parent.parent
    if "photo" in profile:
        overlay_photo(canvas, profile, root, size, rng)

    base_color = np.concatenate([canvas["color"], canvas["alpha"][..., None]], axis=-1)
    write_png(out_dir / "baseColor.png", base_color)
    normal = height_to_normal(canvas["height"], 7.0 * size / 4096, canvas["tilt_x"], canvas["tilt_y"])
    write_png(out_dir / "normal.png", np.concatenate([normal, np.ones((size, size, 1), dtype=np.float32)], axis=-1))
    material = np.stack([canvas["roughness"], canvas["metalness"], canvas["iridescence"], canvas["thickness"]], axis=-1)
    write_png(out_dir / "material.png", material)
    # A variety's photo is of a barred fish, whose eye sits in a black bar.
    has_photo_eye = "photo" in profile and "variety" not in profile["photo"]
    eye = paint_photo_eye(profile, root, 512) if has_photo_eye else paint_iris(profile, 768, rng)
    write_png(out_dir / "eye.png", eye)
