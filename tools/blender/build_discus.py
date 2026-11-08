"""Builds discus. Run with: blender --background --factory-startup --python tools/blender/build_discus.py -- --out public/assets/fish/discus.glb"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fish_build import build_fish  # noqa: E402

build_fish("discus", 2048)
