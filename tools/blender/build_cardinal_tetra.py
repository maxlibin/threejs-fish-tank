"""Builds the cardinal tetra. Run with: blender --background --factory-startup --python tools/blender/build_cardinal_tetra.py -- --out public/assets/fish/cardinal_tetra.glb"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fish_build import build_fish  # noqa: E402

build_fish("cardinal_tetra", 2048)
