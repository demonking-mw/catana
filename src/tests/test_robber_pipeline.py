#!/usr/bin/env python3
"""End-to-end pipeline test: JSON → settle simulator → robber predictor → display.

Loads a sample JSON, runs the settle simulator, picks the most probable
placeout from the first option, feeds that board state into the robber
predictor, and displays the resulting board along with each player's
robber-placement preferences.

Usage:
    cd src/
    PYTHONPATH=. python3 tests/test_robber_pipeline.py sample1.json
"""

from __future__ import annotations

import json
import os
import sys

# Make sure src/ and project root are importable
_SRC_DIR = os.path.join(os.path.dirname(__file__), "..")
_ROOT_DIR = os.path.join(_SRC_DIR, "..")
for p in (_SRC_DIR, os.path.join(_ROOT_DIR, "manual_processing")):
    abs_p = os.path.abspath(p)
    if abs_p not in sys.path:
        sys.path.insert(0, abs_p)

from base_computes.game_state import GameState
from base_computes.settle_sim import simulate_settle
from base_computes.robber_predict import predict_robber, get_resource_weights
from visualize_board import render_board, Colors, PLAYER_NAMES, PLAYER_COLORS


# ── Resource labels ──────────────────────────────────────────────────────────
_RES_LABELS = ["Wood", "Brick", "Wool", "Grain", "Ore", "Desert", "Ocean"]


def _tile_label(gs: GameState, tile_id: int) -> str:
    """Human-readable tile description, e.g. 'tile 17 (Grain 10)'."""
    res_id, num = gs.map.tiles[tile_id]
    res_name = _RES_LABELS[res_id] if res_id < len(_RES_LABELS) else f"?{res_id}"
    return f"tile {tile_id} ({res_name} {num})"


def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else "sample1.json"

    # ── 1. Load JSON → GameState ─────────────────────────────────────
    with open(path) as f:
        data = json.load(f)
    gs = GameState.from_json(data)
    print(
        f"{Colors.BOLD}=== Pipeline: JSON → Settle Sim → Robber Predict ==={Colors.RESET}\n"
    )
    print(
        f"Loaded {path}  (turn {gs.meta.t}, phase={gs.meta.phase}, "
        f"player={gs.meta.p_curr}, settlements={len(gs.map.nodes)})\n"
    )

    # ── 2. Run settle simulator ──────────────────────────────────────
    print(f"{Colors.BOLD}--- Running settle simulator ---{Colors.RESET}")
    sim_results = simulate_settle(gs)
    if not sim_results:
        print("No simulation results (board may be fully settled).")
        sys.exit(0)

    # Show a brief summary of all options
    for idx, ((settle, road), cases) in enumerate(sim_results):
        total_prob = sum(p for _, p in cases)
        print(
            f"  Option {idx}: settle={settle}  road={road}  "
            f"cases={len(cases)}  prob_sum={total_prob:.4f}"
        )

    # ── 3. Pick the top-probable placeout from the first option ──────
    first_settle, first_road = sim_results[0][0]
    placeouts = sim_results[0][1]

    # Sort by probability descending, pick the best
    placeouts.sort(key=lambda x: x[1], reverse=True)
    best_gs, best_prob = placeouts[0]

    print(
        f"\n{Colors.BOLD}--- First option: settle={first_settle}  road={first_road} ---{Colors.RESET}"
    )
    print(f"Top placeout probability: {best_prob:.4f}")
    print(f"Settlements in placeout: {len(best_gs.map.nodes)}")
    for node_key, (pid, btype) in sorted(best_gs.map.nodes.items()):
        bname = "city" if btype == 2 else "settle"
        print(f"  {node_key} → player {pid} ({bname})")

    # ── 4. Feed placeout into robber predictor ───────────────────────
    print(f"\n{Colors.BOLD}--- Robber prediction on placeout board ---{Colors.RESET}")
    res_prod, res_weights, rel_str, balanced = get_resource_weights(best_gs)
    robber_prefs = predict_robber(best_gs)

    # ── 5. Display the board ─────────────────────────────────────────
    print(f"\n{Colors.BOLD}--- Board State (post-placeout) ---{Colors.RESET}")
    render_board(best_gs)

    # ── 6. Display resource relative strengths ───────────────────────
    print(f"{Colors.BOLD}--- Resource Relative Strengths ---{Colors.RESET}")
    print(
        f"  {'Resource':<8s}  {'Prod':>6s}  {'Weight':>6s}  {'RelStr':>6s}  {'Balanced':>8s}"
    )
    print("  " + "─" * 42)
    for r in range(5):
        rname = _RES_LABELS[r]
        print(
            f"  {rname:<8s}  {res_prod[r]:6.1f}  {res_weights[r]:6.3f}  {rel_str[r]:6.3f}  {balanced[r]:8.3f}"
        )
    print()

    # ── 7. Display each player's robber preferences ──────────────────
    print(f"{Colors.BOLD}--- Robber Placement Preferences ---{Colors.RESET}")
    for pid, prefs in enumerate(robber_prefs):
        color = PLAYER_COLORS[pid % 4]
        name = PLAYER_NAMES[pid % 4]
        prob_sum = sum(p for _, p in prefs)

        print(
            f"\n  {color}{name} (Player {pid}){Colors.RESET}  "
            f"[prob sum = {prob_sum:.4f}]"
        )

        for rank, (tile_id, prob) in enumerate(prefs, 1):
            label = _tile_label(best_gs, tile_id)
            bar_len = int(prob * 30)
            bar = "█" * bar_len + "░" * (30 - bar_len)
            print(f"    {rank}. {label:<28s}  {prob:.3f}  {bar}")

    # ── 8. Quick validation ──────────────────────────────────────────
    print(f"\n{Colors.BOLD}--- Validation ---{Colors.RESET}")
    ok = True
    for pid, prefs in enumerate(robber_prefs):
        if len(prefs) != 3:
            print(f"  FAIL: Player {pid} has {len(prefs)} prefs (expected 3)")
            ok = False
        total = sum(p for _, p in prefs)
        if abs(total - 1.0) > 1e-6:
            print(f"  FAIL: Player {pid} probs sum to {total:.6f} (expected 1.0)")
            ok = False
    if ok:
        print("  All checks passed ✓")


if __name__ == "__main__":
    main()
