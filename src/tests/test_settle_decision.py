#!/usr/bin/env python3
"""Test script for settlement decision on a JSON board state.

Workflow: load JSON → parse into GameState → visualize board → run decision.

Usage:
    python test_settle_decision.py <path_to_json> [--K 0.5]

Example:
    python src/tests/test_settle_decision.py src/sample.json
    python src/tests/test_settle_decision.py src/sample.json --K 1.0
"""

import argparse
import json
import sys
import os

# Add src to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
# Add repo root for manual_processing imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from base_computes import GameState
from base_computes.settle_eval_simple import settle_decision
from manual_processing.visualize_board import render_board, Colors


def main():
    parser = argparse.ArgumentParser(
        description="Test settlement decision on an HDCS JSON board state."
    )
    parser.add_argument("json_path", help="Path to the HDCS JSON file.")
    args = parser.parse_args()

    # ── Load JSON ────────────────────────────────────────────────────────
    if not os.path.exists(args.json_path):
        print(f"Error: file not found: {args.json_path}")
        sys.exit(1)

    with open(args.json_path, "r") as f:
        data = json.load(f)

    # ── Parse into GameState ─────────────────────────────────────────────
    try:
        gs = GameState.from_json(data)
    except ValueError as e:
        print(f"Validation failed:\n{e}")
        sys.exit(1)

    # ── Evaluate scores (needed for board overlay) ────────────────────
    gs.evaluate_all_settlements()

    # ── Visualize board ──────────────────────────────────────────────────
    try:
        render_board(gs, show_scores=True)
    except Exception as e:
        print(f"Visualization error: {e}")

    # ── Run settlement decision ──────────────────────────────────────────
    print(f"\n{Colors.BOLD}--- SETTLEMENT DECISION ---{Colors.RESET}\n")

    results = settle_decision(gs)

    if not results:
        print("No valid settlement options available.")
        sys.exit(0)

    print(f"  {'#':>2}  {'Settle':>14}  {'Road':>8}  {'Score':>8}  {'Prob':>8}")
    print(f"  {'--':>2}  {'-'*14:>14}  {'-'*8:>8}  {'-'*5:>8}  {'-----':>8}")
    for i, ((settle, road), prob) in enumerate(results, 1):
        score = gs.settle_scores.get(settle, 0.0)
        print(f"  {i:>2}  {settle:>14}  {road:>8}  {score:>8.3f}  {prob:>8.4f}")

    total_p = sum(p for _, p in results)
    print(f"\n  sum(prob) = {total_p:.6f}")


if __name__ == "__main__":
    main()
