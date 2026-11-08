"""Builds the living room around the tank and bakes its light in Cycles.

Follows reference/room/inspiration.png: grey-green walls, a warm ceiling, wood panels with an LED strip on
the left, a low four-door cabinet, a black hood with hanging track lights, a TV on a black console, a large
grey sectional in the foreground, a pale oak floor, and curtains on the right.

Writes room.glb, lightmap.exr, tank_light.exr (the tank's share of the light alone, so the app can recolour it),
and reflection.exr. Run with:
blender --background --factory-startup --python tools/blender/build_room.py -- --out public/assets/room
"""
import math
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from fish_body import MeshPart, add_mesh_object, merge_parts  # noqa: E402
from room_shapes import box, curtain, cylinder, pillow  # noqa: E402

MIN_X, MAX_X, MAX_Z, CEILING = -2.6, 2.6, 5.3, 2.45
# How far the furniture stands back from where it was first placed, leaving open floor in front of the tank.
SOFA_SHIFT_X = 0.65
SOFA_SHIFT_Z = 1.25
MEDIA_SHIFT_Z = 0.6
BACK_Z = -0.535
TANK_W, TANK_D, TANK_H, STAND_Y = 3.0, 1.0, 1.35, 0.6
LIGHTMAP_SIZE = 4096
# The tank's light changes slowly across the room, so half the resolution holds it.
TANK_LIGHT_SIZE = 2048
# On the left wood panel, between the back corner and the LED strip, at a usual switch height.
SWITCH_CENTRE = (MIN_X + 0.02, 1.15, 0.25)
BAKE_SAMPLES = 420
REFLECTION_SAMPLES = 160
GLOW = HERE.parent.parent / "public" / "assets" / "room" / "tank_glow.png"

# Albedo used only for light bouncing around during the bake; textures add the detail in the app.
BOUNCE_COLORS = {
    "behind_floor": (0.5, 0.42, 0.32), "behind_wall": (0.18, 0.2, 0.185), "behind_ceiling": (0.72, 0.69, 0.63), "behind_panel": (0.16, 0.12, 0.09),
    "front_cabinet": (0.6, 0.57, 0.5), "front_black": (0.02, 0.02, 0.02), "front_gloss": (0.015, 0.015, 0.018), "front_metal": (0.55, 0.55, 0.53),
    "front_fabric": (0.24, 0.25, 0.25), "front_curtain": (0.17, 0.17, 0.15), "front_speaker": (0.03, 0.03, 0.03),
    "front_switch": (0.8, 0.79, 0.76),
}
# Parts that give out light rather than receive it, so they stay out of the lightmap.
EMITTERS = ("front_screen", "front_switch_led")


def output_dir() -> Path:
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if "--out" not in arguments:
        raise SystemExit("Missing argument: pass -- --out public/assets/room after the Blender arguments.")
    return Path(arguments[arguments.index("--out") + 1])


def shell_of_room() -> dict:
    """Floor, walls, ceiling, and the wood panels with their LED recess."""
    width, depth = MAX_X - MIN_X, MAX_Z - BACK_Z
    centre_x, centre_z = (MAX_X + MIN_X) / 2, (MAX_Z + BACK_Z) / 2
    t = 0.05
    panels = [
        box((MIN_X - t / 2 + 0.02, CEILING / 2, (BACK_Z + 0.5) / 2), (t, CEILING, 0.5 - BACK_Z)),
        box((MIN_X - t / 2 + 0.02, CEILING / 2, (0.62 + MAX_Z) / 2), (t, CEILING, MAX_Z - 0.62)),
    ]
    return {
        "behind_floor": [box((centre_x, -t / 2, centre_z), (width + 2 * t, t, depth + 2 * t))],
        "behind_ceiling": [box((centre_x, CEILING + t / 2, centre_z), (width + 2 * t, t, depth + 2 * t))],
        "behind_wall": [
            box((centre_x, CEILING / 2, BACK_Z - t / 2), (width + 2 * t, CEILING, t)),
            box((MAX_X + t / 2, CEILING / 2, centre_z), (t, CEILING, depth)),
            box((centre_x, CEILING / 2, MAX_Z + t / 2), (width + 2 * t, CEILING, t)),
            box((MIN_X - t / 2 - 0.03, CEILING / 2, centre_z), (t, CEILING, depth)),
        ],
        "behind_panel": panels,
        "front_black": [box((MIN_X + 0.004, 0.04, centre_z), (0.015, 0.08, depth))],
    }


def cabinet() -> list:
    """A long, matte, four-door cabinet on a shadowed plinth, directly under the tank."""
    W = TANK_W + 0.04
    D = TANK_D + 0.03
    doors = 4
    gap = 0.005
    door_width = (W - gap * (doors + 1)) / doors
    parts = [box((0.0, STAND_Y - 0.012, 0.0), (W, 0.024, D))]
    # A recessed plinth, in shadow, carries the cabinet to the floor.
    parts.append(box((0.0, 0.035, -0.012), (W - 0.03, 0.07, D - 0.03)))
    for index in range(doors):
        x = -W / 2 + gap + door_width / 2 + index * (door_width + gap)
        parts.append(box((x, (STAND_Y - 0.03 + 0.07) / 2, D / 2 + 0.004), (door_width, STAND_Y - 0.03 - 0.07, 0.018)))
    parts.append(box((0.0, (STAND_Y - 0.024 + 0.07) / 2, D / 2 - 0.01), (W - 0.004, STAND_Y - 0.024 - 0.07, 0.01)))
    for side in (-1, 1):
        parts.append(box((side * W / 2, (STAND_Y + 0.07) / 2, 0.0), (0.012, STAND_Y - 0.07, D)))
    return parts


def tank_hardware() -> tuple:
    """The black hood, its LED bar, the hanging rail, and the ceiling track lights."""
    top = STAND_Y + TANK_H
    rail_y = top + 0.24
    black = [
        box((0.0, top + 0.035, 0.0), (TANK_W + 0.06, 0.06, TANK_D + 0.05)),
        box((0.0, rail_y, -0.03), (TANK_W + 0.1, 0.022, 0.022)),
    ]
    for x in (-1.1, 1.1):
        black.append(cylinder((x, top + 0.065, 0.0), (x, rail_y, -0.03), 0.004))
    for x in (-1.35, 1.35):
        black.append(cylinder((x, rail_y, -0.03), (x, CEILING, -0.03), 0.006))
    lamps = [(-1.2, 0.55), (0.05, 0.85), (1.3, 0.55)]
    spots = []
    for x, z in lamps:
        black.append(box((x, CEILING - 0.03, z), (0.3, 0.06, 0.08)))
        black.append(cylinder((x, CEILING - 0.06, z), (x, CEILING - 0.16, z), 0.009))
        black.append(cylinder((x, CEILING - 0.16, z), (x, CEILING - 0.26, z + 0.06), 0.038))
        spots.append((x, CEILING - 0.27, z + 0.07))
    led_bar = box((0.0, top + 0.0, TANK_D / 2 + 0.008), (TANK_W - 0.04, 0.008, 0.014))
    return black, led_bar, spots


def media_wall(rng: np.random.Generator) -> dict:
    """The TV on its black console, and a tall speaker, on the left."""
    console_x = MIN_X + 0.28
    screen_z = (1.3 + MEDIA_SHIFT_Z, 2.75 + MEDIA_SHIFT_Z)
    screen_centre = sum(screen_z) / 2
    gloss = [
        box((console_x, 0.3, 2.02 + MEDIA_SHIFT_Z), (0.46, 0.44, 1.9)),
        box((MIN_X + 0.1, 1.12, screen_centre), (0.04, 0.84, screen_z[1] - screen_z[0] + 0.03)),
        box((console_x + 0.16, 0.56, screen_centre), (0.09, 0.05, 0.42)),
    ]
    black = [box((console_x, 0.05, 2.02 + MEDIA_SHIFT_Z), (0.42, 0.1, 1.85))]
    metal = [box((console_x + 0.236, 0.32, 1.55 + MEDIA_SHIFT_Z), (0.008, 0.012, 0.42)), box((console_x + 0.236, 0.32, 2.5 + MEDIA_SHIFT_Z), (0.008, 0.012, 0.42))]
    speaker = [box((MIN_X + 0.16, 0.66, 0.92), (0.2, 1.32, 0.26))]
    screen = MeshPart(
        np.array([(MIN_X + 0.1225, 0.74, screen_z[1]), (MIN_X + 0.1225, 0.74, screen_z[0]), (MIN_X + 0.1225, 1.5, screen_z[0]), (MIN_X + 0.1225, 1.5, screen_z[1])]),
        np.array([[0, 1, 2, 3]]), np.array([(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)]), np.zeros((4, 4)),
    )
    return {"front_gloss": gloss, "front_black": black, "front_metal": metal, "front_speaker": speaker, "front_screen": [screen]}


def sectional(rng: np.random.Generator) -> list:
    """A large grey sectional: a long run on the right, and a section crossing the foreground, with soft cushions."""
    parts = []

    def soft(centre: tuple, size: tuple, corner: float, puff: float, sag: float, lean: tuple) -> None:
        parts.append(pillow((centre[0] + SOFA_SHIFT_X, centre[1], centre[2] + SOFA_SHIFT_Z), size, corner, puff, sag, lean, rng))

    # The long run along the right wall.
    run_x = 1.24
    soft((run_x + 0.42, 0.34, 1.86), (0.26, 0.68, 2.72), 0.05, 0.012, 0.0, (0.0, 0.0))
    soft((run_x - 0.03, 0.12, 1.86), (0.98, 0.2, 2.72), 0.04, 0.006, 0.0, (0.0, 0.0))
    soft((run_x - 0.03, 0.3, 0.54), (0.98, 0.56, 0.24), 0.08, 0.016, 0.0, (0.0, 0.0))
    for z, length in ((1.12, 0.94), (2.06, 0.94)):
        soft((run_x - 0.08, 0.31, z), (0.84, 0.18, length - 0.012), 0.045, 0.026, 0.012, (0.0, 0.0))
        soft((run_x + 0.25, 0.6, z), (0.22, 0.44, length - 0.02), 0.075, 0.042, 0.0, (-0.09, 0.0))
    # Big loose throw cushions at the near end of the run, as in the photograph.
    soft((run_x + 0.2, 0.67, 2.82), (0.2, 0.46, 0.58), 0.08, 0.05, 0.0, (-0.14, 0.04))
    soft((run_x + 0.1, 0.56, 2.36), (0.16, 0.36, 0.42), 0.06, 0.05, 0.0, (-0.1, 0.1))

    # The section crossing the foreground, its back toward the viewer.
    cross_z = 2.72
    soft((-0.02, 0.12, cross_z), (1.46, 0.2, 0.96), 0.04, 0.006, 0.0, (0.0, 0.0))
    soft((-0.02, 0.34, cross_z + 0.42), (1.46, 0.68, 0.24), 0.05, 0.012, 0.0, (0.0, 0.0))
    soft((-0.76, 0.3, cross_z - 0.03), (0.22, 0.56, 0.98), 0.08, 0.016, 0.0, (0.0, 0.0))
    for x, length in ((-0.38, 0.72), (0.34, 0.72)):
        soft((x, 0.31, cross_z - 0.08), (length - 0.012, 0.18, 0.82), 0.045, 0.026, 0.012, (0.0, 0.0))
        soft((x, 0.6, cross_z + 0.27), (length - 0.02, 0.44, 0.22), 0.075, 0.042, 0.0, (0.0, -0.09))
    return parts


def light_switch() -> tuple:
    """A wall plate that changes the colour of the tank light, with a thin indicator showing the current colour."""
    x, y, z = SWITCH_CENTRE
    plate = [box((x + 0.005, y, z), (0.01, 0.086, 0.086)), box((x + 0.012, y + 0.006, z), (0.006, 0.05, 0.05))]
    indicator = box((x + 0.0105, y - 0.031, z), (0.002, 0.004, 0.024))
    return plate, [indicator]


def build_parts(rng: np.random.Generator) -> tuple:
    """Everything in the room, grouped by material. Names starting with `behind_` draw before the tank."""
    groups = shell_of_room()
    black, led_bar, spots = tank_hardware()

    def add(name: str, parts: list) -> None:
        groups.setdefault(name, []).extend(parts)

    add("front_cabinet", cabinet())
    add("front_black", black)
    for name, parts in media_wall(rng).items():
        add(name, parts)
    add("front_fabric", sectional(rng))
    add("front_curtain", [curtain(MAX_X, 0.5, MAX_Z - 0.05, CEILING - 0.03, rng)])
    add("front_black", [box((MAX_X - 0.09, CEILING - 0.05, (0.5 + MAX_Z) / 2), (0.06, 0.03, MAX_Z - 0.45))])
    add("front_speaker", [box((1.74, 0.66, -0.22), (0.18, 1.32, 0.22))])
    plate, indicator = light_switch()
    add("front_switch", plate)
    add("front_switch_led", indicator)
    led_strip = box((MIN_X + 0.0, CEILING / 2, 0.56), (0.012, CEILING, 0.1))
    return {name: merge_parts(parts) for name, parts in groups.items()}, led_bar, led_strip, spots


def simple_material(name: str, color: tuple) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.6
    return material


def emissive_material(name: str, color: tuple, strength: float, image_path: Path | None) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = strength
    emission.inputs["Color"].default_value = (*color, 1.0)
    if image_path is not None:
        image = nodes.new("ShaderNodeTexImage")
        image.image = bpy.data.images.load(str(image_path))
        links.new(image.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def add_lights(spots: list) -> None:
    """The evening lighting in the photograph: warm ceiling wash, track spots, and everything else from emissive surfaces."""
    def area(name: str, location: tuple, size: float, power: float, color: tuple, rotation: tuple) -> None:
        light = bpy.data.lights.new(name, "AREA")
        light.size = size
        light.energy = power
        light.color = color
        obj = bpy.data.objects.new(name, light)
        obj.location = (location[0], -location[2], location[1])
        obj.rotation_euler = rotation
        bpy.context.scene.collection.objects.link(obj)

    warm = (1.0, 0.86, 0.7)
    area("ceiling_wash", (0.0, CEILING - 0.04, 2.7), 3.8, 38.0, warm, (0.0, 0.0, 0.0))
    area("uplight_left", (MIN_X - 0.25, 2.0, 0.5), 0.8, 8.0, warm, (math.pi, 0.0, 0.0))
    for index, (x, y, z) in enumerate(spots):
        light = bpy.data.lights.new(f"spot_{index}", "SPOT")
        light.energy = 10.0
        light.spot_size = 0.75
        light.spot_blend = 0.75
        light.color = (1.0, 0.9, 0.76)
        light.shadow_soft_size = 0.02
        obj = bpy.data.objects.new(f"spot_{index}", light)
        obj.location = (x, -z, y)
        obj.rotation_euler = (math.radians(-22), 0.0, 0.0)
        bpy.context.scene.collection.objects.link(obj)


def build_glow_sources(led_bar: MeshPart, led_strip: MeshPart) -> None:
    """Objects that emit light during the bake only: the tank's image, its LED bar, and the wall strip."""
    width, height = TANK_W, TANK_H
    front = MeshPart(
        np.array([(-width / 2, STAND_Y, TANK_D / 2), (width / 2, STAND_Y, TANK_D / 2), (width / 2, STAND_Y + height, TANK_D / 2), (-width / 2, STAND_Y + height, TANK_D / 2)]),
        np.array([[0, 1, 2, 3]]), np.array([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]), np.zeros((4, 4)),
    )
    sides = merge_parts([box((side * width / 2, STAND_Y + height / 2, 0.0), (0.004, height, TANK_D)) for side in (-1, 1)])
    body = box((0.0, STAND_Y + height / 2, 0.0), (width - 0.01, height, TANK_D - 0.01))
    glow = emissive_material("glow_tank", (1, 1, 1), 7.0, GLOW)
    side_glow = emissive_material("glow_tank_side", (0.42, 0.48, 0.44), 1.6, None)
    for name, part, material in (("glow_front", front, glow), ("glow_sides", sides, side_glow), ("glow_body", body, simple_material("glow_body", (0.02, 0.05, 0.05)))):
        obj = add_mesh_object(name, part)
        obj.data.materials.append(material)
    bar = add_mesh_object("front_ledbar", led_bar)
    bar.data.materials.append(emissive_material("glow_bar", (0.95, 1.0, 0.98), 45.0, None))
    strip = add_mesh_object("front_led", led_strip)
    strip.data.materials.append(emissive_material("led_strip", (1.0, 0.72, 0.42), 22.0, None))


def unwrap_lightmap(objects: list) -> None:
    """Gives every room object a second UV set, packed together into one lightmap."""
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        layer = obj.data.uv_layers.new(name="Lightmap")
        obj.data.uv_layers.active = layer
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(58), island_margin=0.0016, area_weight=0.6)
    bpy.ops.object.mode_set(mode="OBJECT")
    for obj in objects:
        obj.data.uv_layers.active = obj.data.uv_layers[0]


def export_room(objects: list, path: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True, export_materials="EXPORT", export_normals=True, export_yup=True, export_image_format="JPEG")


def use_gpu() -> None:
    preferences = bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type = "METAL"
    preferences.get_devices()
    for device in preferences.devices:
        device.use = True
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    print(f"Cycles devices: {[device.name for device in preferences.devices]}")


def bake_lightmap(objects: list, path: Path, size: int) -> None:
    """Ray-traces all direct and bounced light onto the room's surfaces. Albedo comes from textures in the app."""
    scene = bpy.context.scene
    scene.cycles.samples = BAKE_SAMPLES
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 8
    scene.cycles.sample_clamp_indirect = 8.0
    image = bpy.data.images.new(path.stem, size, size, alpha=True, float_buffer=True)
    image.colorspace_settings.name = "Non-Color"
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
        obj.data.uv_layers.active = obj.data.uv_layers["Lightmap"]
        for material in obj.data.materials:
            material.use_nodes = True
            node = material.node_tree.nodes.new("ShaderNodeTexImage")
            node.image = image
            material.node_tree.nodes.active = node
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=8, use_clear=True, target="IMAGE_TEXTURES")
    pixels = np.zeros(size * size * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    image.pixels.foreach_set(soften_noise(pixels.reshape(size, size, 4)).ravel())
    settings = scene.render.image_settings
    settings.file_format = "OPEN_EXR"
    settings.color_depth = "16"
    settings.color_mode = "RGB"
    settings.exr_codec = "ZIP"
    image.save_render(str(path), scene=scene)


def soften_noise(image: np.ndarray) -> np.ndarray:
    """Removes the last of the sampling grain with a small blur that does not leak into empty space."""
    covered = (image[..., 3] > 0.0).astype(np.float32)
    weights = np.array([0.27, 0.46, 0.27], dtype=np.float32)
    colors = image[..., :3] * covered[..., None]
    total = covered.copy()
    for axis in (0, 1):
        colors = sum(np.roll(colors, shift, axis=axis) * weight for shift, weight in zip((-1, 0, 1), weights))
        total = sum(np.roll(total, shift, axis=axis) * weight for shift, weight in zip((-1, 0, 1), weights))
    blurred = colors / np.maximum(total, 1e-5)[..., None]
    result = image.copy()
    keep = covered > 0.0
    result[..., :3][keep] = blurred[keep]
    result[..., 3] = 1.0
    return result


def keep_only_tank_light() -> None:
    """Switches off every source but the tank's glow, its LED bar, and the TV showing it."""
    for light in bpy.data.lights:
        light.energy = 0.0
    for name in ("led_strip", "front_switch_led"):
        bpy.data.materials[name].node_tree.nodes["Emission"].inputs["Strength"].default_value = 0.0


def render_reflection(path: Path) -> None:
    """A 360-degree picture of the room, for what glossy surfaces reflect."""
    scene = bpy.context.scene
    camera_data = bpy.data.cameras.new("reflection")
    camera_data.type = "PANO"
    camera_data.panorama_type = "EQUIRECTANGULAR"
    camera = bpy.data.objects.new("reflection", camera_data)
    camera.location = (0.0, -2.0, 1.15)
    camera.rotation_euler = (math.pi / 2, 0.0, 0.0)
    scene.collection.objects.link(camera)
    scene.camera = camera
    scene.render.resolution_x = 2048
    scene.render.resolution_y = 1024
    scene.cycles.samples = REFLECTION_SAMPLES
    scene.cycles.use_denoising = True
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "16"
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def main() -> None:
    out = output_dir()
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(23)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    use_gpu()
    groups, led_bar, led_strip, spots = build_parts(rng)

    objects = []
    for name, part in groups.items():
        obj = add_mesh_object(name, part)
        if name == "front_screen":
            obj.data.materials.append(emissive_material(name, (1, 1, 1), 1.0, GLOW))
        elif name == "front_switch_led":
            obj.data.materials.append(emissive_material(name, (0.95, 1.0, 0.98), 0.5, None))
        else:
            obj.data.materials.append(simple_material(name, BOUNCE_COLORS[name]))
            objects.append(obj)
    build_glow_sources(led_bar, led_strip)

    unwrap_lightmap(objects)
    emitters = [bpy.data.objects[name] for name in EMITTERS]
    export_room([*objects, *emitters, bpy.data.objects["front_led"], bpy.data.objects["front_ledbar"]], out / "room.glb")

    add_lights(spots)
    bake_lightmap(objects, out / "lightmap.exr", LIGHTMAP_SIZE)
    render_reflection(out / "reflection.exr")
    keep_only_tank_light()
    bake_lightmap(objects, out / "tank_light.exr", TANK_LIGHT_SIZE)
    print("Room built")


main()
