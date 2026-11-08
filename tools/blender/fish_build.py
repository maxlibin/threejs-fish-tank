"""Shared driver: turns a species profile into a geometry GLB and a folder of texture maps."""
import json
import sys
from pathlib import Path

import bpy
import numpy as np

from fish_body import add_mesh_object, build_fish_body, build_fish_eyes
from fish_textures import bake_fish_textures


def output_path() -> Path:
    """Reads --out from the arguments after Blender's `--` separator."""
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if "--out" not in arguments:
        raise SystemExit("Missing argument: pass -- --out path/to/fish.glb after the Blender arguments.")
    return Path(arguments[arguments.index("--out") + 1])


def fraction_along(point: list, nose: np.ndarray, axis: np.ndarray) -> list:
    """A pixel in the photo as a position along the fish: x from nose to tail, y toward its back."""
    relative = np.array(point, dtype=float) - nose
    up = np.array([axis[1], -axis[0]])
    if up[1] > 0:
        up = -up
    size = float(axis @ axis)
    return [float(relative @ axis) / size, float(relative @ up) / size]


def outline_from_photo(profile: dict) -> dict:
    """Replaces the profile's outlines with those traced from its photo, so the skin fits the model exactly."""
    photo = profile.get("photo")
    if photo is None:
        return profile
    nose, tail = np.array(photo["nose"], dtype=float), np.array(photo["tail"], dtype=float)
    axis = tail - nose

    def to_fish(points: list) -> list:
        return [fraction_along(point, nose, axis) for point in points]

    traced = dict(profile)
    top, bottom = to_fish(photo["top"]), to_fish(photo["bottom"])
    top[0], bottom[0] = [0.0, 0.0], [0.0, 0.0]
    traced["top"], traced["bottom"] = top, bottom
    traced["body_end"] = min(top[-1][0], bottom[-1][0])
    eye_x, eye_y = fraction_along(photo["eye"][:2], nose, axis)
    traced["eye"] = {"x": eye_x, "y": eye_y, "radius": photo["eye"][2] / float(np.linalg.norm(axis))}
    traced["fins"] = {name: {**fin, "base": to_fish(photo["fins"][name]["base"]), "tip": to_fish(photo["fins"][name]["tip"])} for name, fin in profile["fins"].items()}
    # A tail traced as bulging past the end of the body would leave a see-through gap between them.
    traced["fins"]["caudal"]["base"] = [[min(x, traced["body_end"]), y] for x, y in traced["fins"]["caudal"]["base"]]
    return traced


def build_fish(species: str, map_size: int) -> None:
    """Builds one species from tools/blender/profiles/<species>.json."""
    out = output_path()
    profile = outline_from_photo(json.loads((Path(__file__).parent / "profiles" / f"{species}.json").read_text()))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    add_mesh_object("body", build_fish_body(profile))
    add_mesh_object("eye", build_fish_eyes(profile))
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out),
        export_format="GLB",
        export_materials="NONE",
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_normals=True,
        export_yup=True,
    )
    bake_fish_textures(profile, out.with_suffix(""), map_size)
    print(f"Built {out}")
