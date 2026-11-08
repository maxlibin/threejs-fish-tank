"""Builds tiger barb. Run with: blender --background --factory-startup --python tools/blender/build_tiger_barb.py -- --out public/assets/fish/tiger_barb.glb"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fish_build import build_fish  # noqa: E402

build_fish("tiger_barb", 2048)
