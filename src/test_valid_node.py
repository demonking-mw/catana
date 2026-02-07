"""Quick smoke test for is_valid_node."""
from base_computes.game_state import VALID_NODES, is_valid_node, PORT_TILE_TO_NODES

print(f"Total valid nodes: {len(VALID_NODES)}")

# Image examples (all should be True)
assert is_valid_node((4, 5, 10)), "A failed"
assert is_valid_node((12, 18, 19)), "B failed"
assert is_valid_node((2, 3, 7)), "C failed"

# Invalid cases (all should be False)
assert not is_valid_node((0, 2, 5)), "non-adjacent passed"
assert not is_valid_node((0, 0, 1)), "duplicate passed"
assert not is_valid_node((10, 11, 12)), "same-row triple passed"
assert not is_valid_node((5, 6, 18)), "far-apart passed"

# Unsorted input order should still work
assert is_valid_node((10, 5, 4)), "unsorted A failed"
assert is_valid_node((19, 12, 18)), "unsorted B failed"

# All 18 port-access nodes must be valid
for tid, (a, b) in PORT_TILE_TO_NODES.items():
    assert a in VALID_NODES, f"port node {a} missing"
    assert b in VALID_NODES, f"port node {b} missing"

print("All checks passed!")
