#!/usr/bin/env python3
"""Simple test script to verify the visualization works."""

import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from visualize_board import *

# Create a test game state
test_state = {
    "meta": {
        "t": 10,
        "p_curr": 2,
        "phase": "main",
        "dice": [7, 8, 6, 9, 5, 11, 4, 8],
        "dev_rem": [10, 3, 2, 1, 1],
    },
    "map": {
        "robber": 20,
        "tiles": [
            [5, -1],
            [6, 0],
            [2, -1],
            [6, 0],
            [6, 0],
            [3, 6],
            [2, 2],
            [0, 5],
            [3, -1],
            [5, -1],
            [4, 3],
            [4, 9],
            [1, 10],
            [1, 8],
            [6, 0],
            [6, 0],
            [0, 8],
            [0, 4],
            [4, 11],
            [2, 3],
            [5, 0],
            [1, -1],
            [5, -1],
            [2, 10],
            [3, 5],
            [1, 6],
            [3, 4],
            [6, 0],
            [6, 0],
            [0, 9],
            [2, 12],
            [3, 11],
            [4, -1],
            [5, -1],
            [6, 0],
            [0, -1],
            [6, 0],
        ],
        "nodes": {
            "5_6_11": [0, 1],  # Red settlement
            "6_7_12": [0, 2],  # Red city
            "11_12_17": [1, 1],  # Blue settlement
            "16_17_23": [2, 1],  # White settlement
            "23_24_29": [3, 1],  # Orange settlement
            "10_11_16": [1, 2],  # Blue city
        },
        "edges": {
            "5_6": 0,  # Red roads
            "6_11": 0,
            "6_7": 0,
            "11_12": 1,  # Blue roads
            "11_16": 1,
            "16_17": 2,  # White roads
            "17_23": 2,
            "23_24": 3,  # Orange roads
            "24_29": 3,
        },
        "ports": {},
    },
    "players": [
        {
            "id": 0,
            "public": [5, 3, 7, 8],
            "res_k": [3, 2, 1, 1, 1],
            "res_u": [],
            "devs": [[1, 1.0, 0, 0, 0, 0], [2, 1.0, 0, 0, 0, 0]],
        },
        {
            "id": 1,
            "public": [6, 4, 9, 6],
            "res_k": [2, 2, 1, 0, 1],
            "res_u": [],
            "devs": [[0, 1.0, 0, 0, 0, 0]],
        },
        {
            "id": 2,
            "public": [3, 1, 5, 5],
            "res_k": [1, 2, 1, 1, 0],
            "res_u": [],
            "devs": [],
        },
        {
            "id": 3,
            "public": [4, 2, 6, 7],
            "res_k": [2, 1, 2, 1, 1],
            "res_u": [],
            "devs": [[1, 1.0, 0, 0, 0, 0]],
        },
    ],
}

if __name__ == "__main__":
    print(f"\n{Colors.BOLD}--- WATAN++ BOARD VISUALIZATION TEST ---{Colors.RESET}\n")

    # Legend
    print(f"{Colors.BOLD}Legend:{Colors.RESET}")
    print(
        f"  {PLAYER_COLORS[0]}▲{Colors.RESET} = Settlement  {PLAYER_COLORS[0]}■{Colors.RESET} = City  {PLAYER_COLORS[0]}═/║/\\//{Colors.RESET} = Road"
    )
    for i, (name, color) in enumerate(zip(PLAYER_NAMES, PLAYER_COLORS)):
        print(f"  {color}■{Colors.RESET} = {name} (Player {i})", end="  ")
    print("\n")

    # Build tile position map
    tile_positions = build_tile_position_map()

    # Create canvas and draw
    canvas = Canvas(130, 45)
    draw_board(canvas, test_state)
    draw_settlements_and_roads(canvas, test_state, tile_positions)
    canvas.render()

    # Print player statistics
    draw_player_stats(test_state)

    print(f"\n{Colors.BOLD}Test completed successfully!{Colors.RESET}\n")
