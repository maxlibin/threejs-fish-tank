"""Builds angelfish_gold. Run with: blender --background --factory-startup --python tools/blender/build_angelfish_gold.py -- --out public/assets/fish/angelfish_gold.glb"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fish_build import build_fish  # noqa: E402

build_fish("angelfish_gold", 4096)
