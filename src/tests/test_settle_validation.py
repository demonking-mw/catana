"""Quick smoke test for settlement validation in GameState."""

import json, sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from base_computes.game_state import GameState


def load():
    with open(os.path.join(os.path.dirname(__file__), "..", "sample.json")) as f:
        return json.load(f)


# Test 1: empty board
gs = GameState.from_json(load())
print("Test 1 (empty board): PASS")

# Test 2: valid non-adjacent settlements
d = load()
d["map"]["nodes"] = {"5_10_11": [0, 1], "17_23_24": [1, 1]}
gs = GameState.from_json(d)
print("Test 2 (valid placements): PASS")

# Test 3: adjacent settlements should FAIL
d = load()
d["map"]["nodes"] = {"5_10_11": [0, 1], "5_6_11": [1, 1]}
try:
    GameState.from_json(d)
    print("Test 3 (adjacent): FAIL - no error raised")
except ValueError as e:
    print(f"Test 3 (adjacent): PASS - caught error")

# Test 4: bad player ID should FAIL
d = load()
d["map"]["nodes"] = {"5_10_11": [9, 1]}
try:
    GameState.from_json(d)
    print("Test 4 (bad player): FAIL - no error raised")
except ValueError as e:
    print(f"Test 4 (bad player): PASS - caught error")

print("\nAll tests done.")
