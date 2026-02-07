#!/usr/bin/env python3
"""Test script for parsing and validating HDCS JSON data.

Usage:
    python test_base_data.py <path_to_json>

Example:
    python src/tests/test_base_data.py src/sample.json
"""

import json
import sys
import os

# Add src to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from base_computes import GameState
from manual_processing.visualize_board import Canvas, draw_board, Colors


def main():
    if len(sys.argv) < 2:
        print("Usage: python test_base_data.py <path_to_json>")
        print("Example: python src/tests/test_base_data.py src/sample.json")
        sys.exit(1)

    json_path = sys.argv[1]

    # Check if file exists
    if not os.path.exists(json_path):
        print(f"❌ Error: File not found: {json_path}")
        sys.exit(1)

    # Load JSON
    print(f"\n📁 Loading JSON from: {json_path}")
    try:
        with open(json_path, "r") as f:
            data = json.load(f)
        print("✓ JSON loaded successfully")
    except json.JSONDecodeError as e:
        print(f"❌ JSON parsing error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error reading file: {e}")
        sys.exit(1)

    # Parse into GameState
    print("\n🔄 Parsing into GameState (with port validation)...")
    try:
        game_state = GameState.from_json(data)
        print("✓ Successfully parsed and validated!")
        print(f"  Turn: {game_state.meta.t}")
        print(f"  Phase: {game_state.meta.phase}")
        print(f"  Active Player: {game_state.meta.p_curr}")
        print(f"  Players: {len(game_state.players)}")
        print(f"  Tiles: {len(game_state.map.tiles)}")
        print(f"  Ports: {len(game_state.map.ports)} node entries")
        print(f"  Nodes (buildings): {len(game_state.map.nodes)}")
        print(f"  Edges (roads): {len(game_state.map.edges)}")
    except ValueError as e:
        print(f"❌ Validation failed:\n{e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Parsing error: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)

    # Visualize the board
    print(f"\n{Colors.BOLD}--- BOARD VISUALIZATION ---{Colors.RESET}\n")
    try:
        canvas = Canvas(130, 40)
        draw_board(canvas, game_state)
        canvas.render()
        print("\n✓ Board rendered successfully!\n")
    except Exception as e:
        print(f"\n❌ Visualization error: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
