"""Builds the angelfish. Run with: blender --background --factory-startup --python tools/blender/build_angelfish.py -- --out public/assets/fish/angelfish.glb"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fish_build import build_fish  # noqa: E402

build_fish("angelfish", 4096)
