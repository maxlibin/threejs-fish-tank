"""Builds this angelfish variety. Run with: blender --background --factory-startup --python tools/blender/build_angelfish_koi.py -- --out public/assets/fish/angelfish_koi.glb"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fish_build import build_fish  # noqa: E402

build_fish("angelfish_koi", 2048)
