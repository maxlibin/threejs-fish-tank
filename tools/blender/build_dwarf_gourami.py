"""Builds dwarf gourami. Run with: blender --background --factory-startup --python tools/blender/build_dwarf_gourami.py -- --out public/assets/fish/dwarf_gourami.glb"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fish_build import build_fish  # noqa: E402

build_fish("dwarf_gourami", 2048)
