# Watan++ (WPP) — Repository Custom Instructions for GitHub Copilot

Use this file as always-on repository context when answering questions or making changes in this repo.

## Project Summary
- Goal: build a Catan AI that plays on Colonist.io.
- Approach: hybrid AI/ML (mostly logic/search reasoning; ML for pattern recognition and probability maps).
- Architecture:
  - Browser (JS): WebSocket sniffer on Colonist.io captures packets, translates them to HDCS, sends to a local server.
  - Server (Python/Flask): receives HDCS JSON at `http://localhost:5000/update_state` and maintains probabilistic state via Bayesian updates.
  - AI Engine: consumes HDCS state for decision making.

## Key Files / Where Things Live
- Sniffer / packet interception: `src/colonist_sniffer.js`
- Design notes + schema: `info/WPP+Planning.md`
- Board image-to-tiles prompt/spec: `info/board_analysis_prompt.md`

## HDCS (High-Density Catan State) — Data Model Rules
### Top-level structure
- `GameState` has:
  - `meta`: turn info, dice history, remaining dev pool
  - `map`: board layout + dynamic buildings
  - `players[]`: per-player state

### Positional arrays (order matters; do not add keys)
Resource index (also used by `res_k` and `res_u` tuples):
- 0 Wood
- 1 Brick
- 2 Wool
- 3 Grain
- 4 Ore

Dev pool / dev tuple index order:
- Knight, VP, Road Building, Year of Plenty, Monopoly

Tile resource IDs extend resource IDs:
- 5 Desert
- 6 Ocean

### Board topology (Vertex–Face Dual Graph)
Tiles:
- Total: 37 hex tiles (IDs 0–36): 19 land (resources/desert) + 18 ocean.
- Tile IDs are **row-major** (top-to-bottom, left-to-right) with rows sized:
  - Row 0: 4 tiles → indices 0–3 (ocean)
  - Row 1: 5 tiles → indices 4–8 (ocean, 3 land, ocean)
  - Row 2: 6 tiles → indices 9–14 (ocean, 4 land, ocean)
  - Row 3: 7 tiles → indices 15–21 (ocean, 5 land, ocean)
  - Row 4: 6 tiles → indices 22–27 (ocean, 4 land, ocean)
  - Row 5: 5 tiles → indices 28–32 (ocean, 3 land, ocean)
  - Row 6: 4 tiles → indices 33–36 (ocean)

Nodes (settlement intersections):
- Keyed by sorted triple of adjacent tile IDs: `"T1_T2_T3"` (ascending).
- A node is valid when the three tiles are mutually adjacent and not all-ocean.

Edges (roads):
- Keyed by sorted pair of adjacent tile IDs: `"T1_T2"` (ascending).
- Treat pairs of two ocean tiles as invalid (no "bridge" roads).

### Tile encoding
Each tile is `[ResourceID, NumberToken]`:
- `NumberToken` 2–12: dice number
- `NumberToken` 0: desert or plain ocean
- `NumberToken` -1: port tile (ocean). When `-1`, `ResourceID` encodes port type:
  - 0–4: 2:1 specific (wood/brick/wool/grain/ore)
  - 5: 3:1 any (note: `ResourceID=5` is desert *only* when `NumberToken=0`)

### Ports
- `map.ports` maps **node IDs** (`"T1_T2_T3"`) to a port type int:
  - 0 wood, 1 brick, 2 wool, 3 grain, 4 ore (all 2:1)
  - 5 any (3:1)
- Each physical port has two adjacent access nodes.

### Player state
- `public`: `[VP, ArmySize, RoadLength, ResourceCount]`
- `res_k`: known resource counts `[Wood, Brick, Wool, Grain, Ore]` (integers)
- `res_u`: unknown resource cards; each entry is one card’s probability tuple
  - tuple: `[P_Wood, P_Brick, P_Wool, P_Grain, P_Ore]`
  - invariant: `sum(tuple) == 1.0` (within rounding)
- `devs`: dev cards in hand; each is `[Age, P_Knight, P_VP, P_Road, P_Year, P_Mono]`
  - Age is turns held; probabilities sum to 1.0

### Global invariants
- Always sort tile IDs in node/edge keys ascending.
- `res_k` + `len(res_u)` should equal `public[3]` (total resource count).
- Truncate floats to ~2 decimals when optimizing for token efficiency.

## Development Notes
- Prefer minimal, focused changes that match existing style.
- If you need schema details beyond this file, consult `info/WPP+Planning.md`.
