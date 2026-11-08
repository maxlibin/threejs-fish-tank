"""Builds corydoras. Run with: blender --background --factory-startup --python tools/blender/build_corydoras.py -- --out public/assets/fish/corydoras.glb"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fish_build import build_fish  # noqa: E402

build_fish("corydoras", 2048)
