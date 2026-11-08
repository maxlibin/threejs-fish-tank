"""Builds cardinal_tetra_2. Run with: blender --background --factory-startup --python tools/blender/build_cardinal_tetra_2.py -- --out public/assets/fish/cardinal_tetra_2.glb"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fish_build import build_fish  # noqa: E402

build_fish("cardinal_tetra_2", 2048)
