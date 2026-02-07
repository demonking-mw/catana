#!/usr/bin/env python3
"""Quick smoke test for robber_predict."""

import json
import sys

from base_computes.game_state import GameState
from base_computes.robber_predict import predict_robber

path = sys.argv[1] if len(sys.argv) > 1 else "sample1.json"
with open(path) as f:
    data = json.load(f)

gs = GameState.from_json(data)
result = predict_robber(gs)

for i, prefs in enumerate(result):
    total_prob = sum(p for _, p in prefs)
    parts = []
    for tid, prob in prefs:
        res_id, num = gs.map.tiles[tid]
        parts.append(f"tile={tid}(res={res_id},num={num}) p={prob:.3f}")
    print(f"Player {i}: {' '.join(parts)}  sum={total_prob:.4f}")

# Validate
for i, prefs in enumerate(result):
    assert len(prefs) == 3, f"Player {i}: expected 3 prefs, got {len(prefs)}"
    total = sum(p for _, p in prefs)
    assert abs(total - 1.0) < 1e-6, f"Player {i}: probs sum to {total}, not 1.0"

print("\nAll checks passed.")
