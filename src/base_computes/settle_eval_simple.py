"""Simple settlement spot scoring for initial placement.

Evaluates a settlement spot based on production value, resource scarcity,
port access, and diversity.  All tunable parameters are grouped at the top
of the file for easy adjustment.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from base_computes.game_state import GameState, VALID_NODES


# ── Tunable Parameters ──────────────────────────────────────────────────────


@dataclass
class SettleEvalParams:
    """All knobs for the settlement scoring algorithm.

    Attributes:
        base_resource_strength:
            Intrinsic value multiplier per resource type.
            Index order: [Wood, Brick, Wool, Grain, Ore].
        dampening_factor:
            Controls how aggressively relative-strength is clamped.
            Applied as ``strength ** dampening_factor`` (values < 1 compress,
            values > 1 amplify).  0.5 is a good starting square-root dampener.
        port_bonus:
            Multiplier applied to port strength when the spot has port access.
        prime_variate_bonus:
            Flat bonus added when a spot has total production >= 10 *and*
            at least 3 distinct resource types.
        parity_preference:
            Multiplier for the complement-parity bonus.  For each
            complement pair (Wood/Brick, Grain/Ore), if the spot produces
            both, the bonus is ``parity_preference × min(prod_a, prod_b)``.
            The two pair bonuses are summed.
        eval_weights:
            Five floats that scale the five evaluation metrics before summing:
            [raw_production, scarcity_weighted, port, prime_variate, parity].
    """

    base_resource_strength: List[float] = field(
        default_factory=lambda: [1.0, 1.0, 0.9, 1.1, 1.1]
    )
    dampening_factor: float = 0.5
    port_bonus: float = 1.5
    prime_variate_bonus: float = 2.0
    parity_preference: float = 0.8
    eval_weights: List[float] = field(
        default_factory=lambda: [1.0, 1.5, 1.0, 1.0, 1.0]
    )


# ── Dice-number → pip mapping ───────────────────────────────────────────────

# Number of dots on a standard Catan probability card.
# 2→1, 3→2, 4→3, 5→4, 6→5, 8→5, 9→4, 10→3, 11→2, 12→1
# 7 and 0 produce nothing.
_PIPS: Dict[int, int] = {
    2: 1,
    3: 2,
    4: 3,
    5: 4,
    6: 5,
    8: 5,
    9: 4,
    10: 3,
    11: 2,
    12: 1,
}


def _number_to_pips(number_token: int) -> int:
    """Return pip count for a dice number token (0 for desert/ocean/port)."""
    return _PIPS.get(number_token, 0)


# ── Helper: board-wide production totals ────────────────────────────────────


def _total_production_by_resource(gs: GameState) -> List[float]:
    """Sum pip production for each resource across all land tiles.

    Returns a 5-element list indexed by resource ID (0-4).
    """
    totals = [0.0] * 5
    for res_id, number_token in gs.map.tiles:
        if 0 <= res_id <= 4 and number_token >= 2:
            totals[res_id] += _number_to_pips(number_token)
    return totals


# ── Helper: complement pairs ────────────────────────────────────────────────

# Wood(0)↔Brick(1), Grain(3)↔Ore(4).  Wool(2) has no complement.
_COMPLEMENT = {0: 1, 1: 0, 3: 4, 4: 3}


def _compute_relative_strengths(
    total_prod: List[float],
    params: SettleEvalParams,
) -> List[float]:
    """Compute dampened relative strength for each resource.

    For each resource *r*:
        raw_strength = base_strength[r]
                     × (1 / total_prod[r])           # overall scarcity
                     × (prod[r] / prod[complement])   # pairwise ratio
    Then apply dampening:  dampened = raw ** dampening_factor

    Wool (no complement) uses pairwise ratio = 1.
    If a resource has zero total production, treat its scarcity as a large
    constant (20) to avoid division by zero.
    """
    strengths: List[float] = []
    for r in range(5):
        base = params.base_resource_strength[r]

        # overall scarcity
        if total_prod[r] > 0:
            overall = 1.0 / total_prod[r]
        else:
            overall = 20.0  # very scarce → high value

        # pairwise strength
        comp = _COMPLEMENT.get(r)
        if comp is not None and total_prod[comp] > 0:
            pairwise = total_prod[r] / total_prod[comp]
        else:
            pairwise = 1.0

        raw = base * overall * pairwise
        # dampen so the model doesn't overvalue rare resources
        dampened = math.pow(raw, params.dampening_factor) if raw > 0 else 0.0
        strengths.append(dampened)

    return strengths


# ── Helper: port strengths ──────────────────────────────────────────────────


def _compute_port_strengths(
    total_prod: List[float],
    params: SettleEvalParams,
) -> Dict[int, float]:
    """Compute per-port-type strength.

    For 2:1 ports (types 0-4):
        Apply dampening to the resource's total production, then normalize
        so the *second-highest* dampened value equals 1.
    3:1 port (type 5) always has strength 1.

    Returns dict mapping port type (0-5) → strength.
    """
    # dampened total yields for each resource
    dampened_yields = [
        math.pow(p, params.dampening_factor) if p > 0 else 0.0 for p in total_prod
    ]

    # normalise: second-highest dampened yield → 1
    sorted_yields = sorted(dampened_yields, reverse=True)
    second_highest = sorted_yields[1] if len(sorted_yields) > 1 else 1.0
    norm = second_highest if second_highest > 0 else 1.0

    port_str: Dict[int, float] = {}
    for r in range(5):
        port_str[r] = dampened_yields[r] / norm
    port_str[5] = 1.0  # 3:1 always 1

    return port_str


# ── Helper: spot production ─────────────────────────────────────────────────


def _spot_production(gs: GameState, node_key: str) -> List[float]:
    """Per-resource pip production for a settlement spot.

    *node_key* is ``"T1_T2_T3"``; each T is a tile ID.
    Returns a 5-element list of pip counts by resource (0-4).
    """
    tile_ids = [int(t) for t in node_key.split("_")]
    prod = [0.0] * 5
    for tid in tile_ids:
        res_id, number_token = gs.map.tiles[tid]
        if 0 <= res_id <= 4 and number_token >= 2:
            # Don't count production if the robber is on this tile
            if tid != gs.map.robber:
                prod[res_id] += _number_to_pips(number_token)
    return prod


# ── Public API ──────────────────────────────────────────────────────────────


def score_settlement(
    gs: GameState,
    node_key: str,
    params: Optional[SettleEvalParams] = None,
) -> float:
    """Score a single settlement spot.

    Args:
        gs:        Current game state.
        node_key:  Settlement node key (``"T1_T2_T3"``).
        params:    Tunable parameters (uses defaults if *None*).

    Returns:
        A float score — higher is better.

    Metrics (each multiplied by its eval_weight):
        1. **Raw production** – sum of pips across the spot's tiles.
        2. **Scarcity-weighted production** – dot-product of spot production
           with dampened resource relative-strengths.
        3. **Port bonus** – if the spot is a port access node,
           ``port_strength × port_bonus``.
        4. **Prime variate** – bonus when total pips ≥ 10 and the spot
           touches ≥ 3 distinct resource types.
        5. **Parity** – for each complement pair (Wood/Brick, Grain/Ore),
           if the spot produces both, adds
           ``parity_preference × min(pair_production)``.
    """
    if params is None:
        params = SettleEvalParams()

    # Pre-compute board-wide data
    total_prod = _total_production_by_resource(gs)
    rel_strengths = _compute_relative_strengths(total_prod, params)
    port_strengths = _compute_port_strengths(total_prod, params)

    # Spot-level production
    prod = _spot_production(gs, node_key)

    # Metric 1: raw production
    raw_prod = sum(prod)

    # Metric 2: scarcity-weighted production
    scarcity_weighted = sum(p * s for p, s in zip(prod, rel_strengths))

    # Metric 3: port bonus
    port_bonus_val = 0.0
    if node_key in gs.map.ports:
        port_type = gs.map.ports[node_key]
        port_bonus_val = port_strengths.get(port_type, 0.0) * params.port_bonus

    # Metric 4: prime variate bonus
    prime_variate_val = 0.0
    distinct_resources = sum(1 for p in prod if p > 0)
    if raw_prod >= 10 and distinct_resources >= 3:
        prime_variate_val = params.prime_variate_bonus

    # Metric 5: complement parity bonus
    # Wood(0)↔Brick(1), Grain(3)↔Ore(4)
    parity_val = 0.0
    for a, b in ((0, 1), (3, 4)):
        if prod[a] > 0 and prod[b] > 0:
            parity_val += params.parity_preference * min(prod[a], prod[b])

    # Weighted sum
    metrics = [raw_prod, scarcity_weighted, port_bonus_val, prime_variate_val, parity_val]
    score = sum(m * w for m, w in zip(metrics, params.eval_weights))
    return score


def rank_all_spots(
    gs: GameState,
    params: Optional[SettleEvalParams] = None,
    top_n: Optional[int] = None,
) -> List[tuple[str, float]]:
    """Score every valid, unoccupied settlement spot and return ranked list.

    Uses the canonical ``VALID_NODES`` set (54 spots) from game_state.

    Args:
        gs:     Current game state.
        params: Tunable parameters.
        top_n:  If set, return only the top *n* results.

    Returns:
        List of ``(node_key, score)`` sorted descending by score.
    """
    if params is None:
        params = SettleEvalParams()

    all_nodes = sorted(VALID_NODES)

    # Remove occupied spots and spots adjacent to existing settlements
    # "Distance rule": no settlement can be adjacent to another.
    # Two nodes are adjacent if they share exactly 2 of their 3 tile IDs.
    blocked: set[str] = set()
    for occ_key in gs.map.nodes:
        blocked.add(occ_key)
        occ_tiles = set(occ_key.split("_"))
        for node in all_nodes:
            node_tiles = set(node.split("_"))
            if len(occ_tiles & node_tiles) == 2:
                blocked.add(node)

    open_spots = [n for n in all_nodes if n not in blocked]

    results = [(n, score_settlement(gs, n, params)) for n in open_spots]
    results.sort(key=lambda x: x[1], reverse=True)
    if top_n is not None:
        results = results[:top_n]
    return results
