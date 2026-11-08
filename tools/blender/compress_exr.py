"""Re-saves an EXR as 16-bit with ZIP compression. Run with: blender --background --python tools/blender/compress_exr.py -- --file path.exr"""
import sys

import bpy

arguments = sys.argv[sys.argv.index("--") + 1 :]
path = arguments[arguments.index("--file") + 1]
image = bpy.data.images.load(path)
image.colorspace_settings.name = "Non-Color"
settings = bpy.context.scene.render.image_settings
settings.file_format = "OPEN_EXR"
settings.color_depth = "16"
settings.color_mode = "RGB"
settings.exr_codec = "ZIP"
image.save_render(path, scene=bpy.context.scene)
