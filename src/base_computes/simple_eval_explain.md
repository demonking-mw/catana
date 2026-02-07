# Settlement Evaluation Function — Parameter Guide

This document explains how `settle_eval_simple.py` scores a settlement spot and what each tunable parameter controls.

---

## Overview

The evaluator answers one question: **"How good is this intersection for placing a settlement?"**

It computes five independent metrics for a given spot, multiplies each by a weight, and sums them into a single score.  Higher is better.

```
score = Σ (metric_i × weight_i)    for i = 1..5
```

The five metrics capture different strategic considerations:

| # | Metric | What it measures |
|---|--------|-----------------|
| 1 | Raw production | Total pip output of the spot |
| 2 | Scarcity-weighted production | Production adjusted for how rare each resource is on this board |
| 3 | Port bonus | Value of having a port at this intersection |
| 4 | Prime variate bonus | Reward for high-output + diverse resource access |
| 5 | Parity bonus | Reward for producing both halves of a complement pair |

---

## Pip System (background)

Every number token on a Catan tile maps to a **pip count** representing how likely it is to be rolled:

| Number | 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10 | 11 | 12 |
|--------|---|---|---|---|---|---|---|----|----|-----|
| Pips   | 1 | 2 | 3 | 4 | 5 | 5 | 4 | 3  | 2  | 1  |

A spot touching three tiles with numbers 5, 9, and 6 has `4 + 4 + 5 = 13` total pips.

---

## Complement Pairs

Two pairs of resources are **complements** — you need both to build key structures:

- **Wood ↔ Brick** (roads + settlements)
- **Grain ↔ Ore** (cities + dev cards)
- **Wool** has no complement

Several metrics reference these pairs.

---

## Parameters

### `base_resource_strength` — `List[float]`, length 5

**Default:** `[1.0, 1.0, 0.9, 1.1, 1.1]`  (Wood, Brick, Wool, Grain, Ore)

An intrinsic value multiplier per resource, reflecting your strategic preference.  The defaults slightly favor Grain and Ore (city-building resources) and slightly discount Wool.

**How to tune:**
- Increase a value if you want the AI to chase that resource harder.
- Set all to `1.0` for a neutral baseline.

---

### `dampening_factor` — `float`

**Default:** `0.5`

Controls how aggressively the model reacts to scarcity.  The relative strength of each resource is raised to this power:

```
dampened_strength = raw_strength ^ dampening_factor
```

| Value | Effect |
|-------|--------|
| `1.0` | No dampening — raw scarcity drives the score directly |
| `0.5` | Square-root dampening (default) — moderate compression |
| `0.3` | Heavy dampening — very rare resources won't dominate |
| `>1.0` | Amplification — scarcity differences are exaggerated |

**How to tune:**
- Lower it if the AI is over-valuing a single scarce resource.
- Raise it if the AI ignores scarcity too much.

---

### `port_bonus` — `float`

**Default:** `1.5`

When a settlement spot sits on a port, the port's strength is multiplied by this value to produce Metric 3.

Port strength is computed as follows:
- **2:1 ports (specific resource):** Each resource's total dampened production is normalized so the *second-highest* equals 1.  A 2:1 port for a resource you produce a lot of is stronger.
- **3:1 port (general):** Always has strength `1.0`.

So the port metric is: `port_strength × port_bonus` (or `0` if the spot has no port).

**How to tune:**
- Increase if the AI undervalues ports.
- Set to `0` to ignore ports entirely.

---

### `prime_variate_bonus` — `float`

**Default:** `2.0`

A flat bonus applied when a spot meets **both** of these conditions:

1. Total pip production ≥ 10
2. At least 3 distinct resource types

This rewards spots that are both *high-output* and *diverse* — the "prime" settlement locations on any board.

**How to tune:**
- Increase to make the AI strongly prefer diverse, high-production spots.
- Set to `0` to disable the bonus.

---

### `parity_preference` — `float`

**Default:** `0.8`

Rewards a spot for producing **both** resources in a complement pair.

For each pair (Wood/Brick and Grain/Ore), if the spot produces both, it adds:

```
parity_preference × min(production_a, production_b)
```

Using `min` means the bonus scales with the *weaker* side of the pair — a spot with 5 pips of Wood and 2 pips of Brick gets `0.8 × 2 = 1.6`, not `0.8 × 5`.  The bonuses from both pairs are summed.

**How to tune:**
- Increase if the AI should prioritize self-sufficient spots that can build without trading.
- Set to `0` to ignore pairing entirely.

---

### `eval_weights` — `List[float]`, length 5

**Default:** `[1.0, 1.5, 1.0, 1.0, 1.0]`

The final multiplier for each metric before summing.  Index mapping:

| Index | Metric | Default weight |
|-------|--------|---------------|
| 0 | Raw production | 1.0 |
| 1 | Scarcity-weighted production | 1.5 |
| 2 | Port bonus | 1.0 |
| 3 | Prime variate bonus | 1.0 |
| 4 | Parity bonus | 1.0 |

The default gives 50% more importance to scarcity-adjusted production over raw pips, reflecting that in practice a spot's value depends heavily on what the board is lacking.

**How to tune:**
- Increase a weight to make that dimension dominate the score.
- Set a weight to `0` to completely ignore that metric.
- The absolute values don't matter, only *relative* ratios between the five weights.

---

## Walkthrough Example

Suppose a spot touches tiles producing: Wood 4 pips, Brick 3 pips, Grain 5 pips.

| Metric | Calculation | Value |
|--------|------------|-------|
| 1. Raw production | 4 + 3 + 5 | **12** |
| 2. Scarcity-weighted | 4×s_w + 3×s_b + 5×s_g (where s_x are dampened strengths) | *(depends on board)* |
| 3. Port bonus | No port → | **0** |
| 4. Prime variate | 12 ≥ 10 and 3 distinct resources → | **2.0** |
| 5. Parity | Wood/Brick pair: 0.8 × min(4,3) = 2.4; Grain has Ore=0, skip → | **2.4** |

Final score = `12×1.0 + scarcity×1.5 + 0×1.0 + 2.0×1.0 + 2.4×1.0`

---

## Relative Strength Calculation (detail)

For each resource *r*, the raw relative strength before dampening is:

```
raw_strength_r = base_resource_strength[r]
               × (1 / total_board_production[r])     # scarcity: rarer → higher
               × (production[r] / production[complement_r])  # pairwise balance
```

- **Overall scarcity** (`1 / total`): If the board has very little Ore across all tiles, Ore's strength goes up.
- **Pairwise ratio** (`prod / complement_prod`): If there's lots of Grain but little Ore, Ore's pairwise ratio is high (it's the bottleneck in the Grain/Ore pair).
- Wool has no complement, so its pairwise ratio is always `1.0`.
- If a resource has zero total production, scarcity is capped at `20.0` (avoids division by zero).

After computing the raw strength, dampening is applied: `dampened = raw ^ dampening_factor`.
