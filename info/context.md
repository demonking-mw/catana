# Watan++ Project Context

## Project Goal
Catan AI that plays on Colonist.io. Hybrid AI/ML approach: mainly logic/search-based reasoning, with ML for pattern recognition and probability maps. Multi-agent architecture.

## Architecture Overview
- **Browser (JS):** WebSocket sniffer on Colonist.io captures packets, translates to HDCS, sends to local server.
- **Server (Python/Flask):** Receives HDCS JSON at `localhost:5000/update_state`. Maintains probabilistic state via Bayesian updates.
- **AI Engine:** Consumes HDCS game state for decision-making.

## Data Format: High-Density Catan State (HDCS)

### Top-Level Structure
```
GameState
├── meta   — turn info, dice history, dev card pool
├── map    — board layout + dynamic buildings
└── players[] — per-player resources, dev cards, public stats
```

### Positional Array Indices (NO KEYS — order matters)
| Index | Resource | Dev Card  |
|-------|----------|-----------|
| 0     | Wood     | Knight    |
| 1     | Brick    | VP        |
| 2     | Wool     | RoadBuild |
| 3     | Grain    | YearPlenty|
| 4     | Ore      | Monopoly  |

Tile resource IDs extend this: 5=Desert, 6=Ocean.

### Board Topology: Vertex-Face Dual Graph
- **37 Tiles** (IDs 0–36): 19 resource/desert + 18 ocean, row-major indexed.
  - Row 0: 0–3 (Ocean)
  - Row 1: 4 (Ocean), 5–7 (Resource), 8 (Ocean)
  - Row 2: 9 (Ocean), 10–13 (Resource), 14 (Ocean)
  - Row 3: 15 (Ocean), 16–19 (Resource), 20 (Ocean)
  - Row 4: 21 (Ocean), 22–25 (Resource), 26 (Ocean)
  - Row 5: 27 (Ocean), 28–30 (Resource), 31 (Ocean)
  - Row 6: 32–35 (Ocean)
- **Nodes (intersections):** identified by sorted tuple of 3 adjacent tile IDs → `"T1_T2_T3"`. Valid when tiles are mutually adjacent and not all-ocean.
- **Edges (roads):** identified by sorted pair of 2 adjacent tile IDs → `"T1_T2"`. Invalid if both tiles are ocean.

### Tile Encoding
Each tile is `[ResourceID, NumberToken]`:
- NumberToken `2–12` = dice number
- NumberToken `0` = desert or ocean (no production)
- NumberToken `-1` = port tile. ResourceID then indicates port type (0–4 = 2:1 specific, 5 = 3:1 any)

### Port Access
- Ports are keyed by node ID (`"T1_T2_T3"`) where the port can be accessed.
- Each port has 2 access nodes (a pair of settlement spots).
- Port types: 0=Wood, 1=Brick, 2=Wool, 3=Grain, 4=Ore (all 2:1), 5=Any (3:1).

### Player State
- `public`: `[VP, ArmySize, RoadLength, ResourceCount]`
- `res_k`: known resource counts `[Wood, Brick, Wool, Grain, Ore]` (integers)
- `res_u`: unknown cards, each a probability tuple `[P_Wood, P_Brick, P_Wool, P_Grain, P_Ore]`. One tuple per unknown card. Empty for self (player 0).
- `devs`: dev cards in hand, each `[Age, P_Knight, P_VP, P_Road, P_Year, P_Mono]`. Age = turns held. Probabilities sum to 1.0.
- Player 0 = "me" (perfect info). Other players = opponents (probabilistic).

### Meta
- `t`: current turn number
- `p_curr`: active player ID
- `phase`: `"main"` (in-game) or `"settle"` (pre-game placement)
- `dice`: last 8 rolls, newest first
- `dev_rem`: unplayed dev cards remaining globally `[Knight, VP, RB, YOP, MONO]` (deck + all hands)

### Dynamic Map State
- `nodes`: `"T1_T2_T3" → [PlayerID, BuildingType]` where 1=Settlement, 2=City
- `edges`: `"T1_T2" → PlayerID`
- `robber`: tile ID where robber currently sits

## Key Rules
1. All arrays are positional. Never use named keys where tuple indices are defined.
2. Tile IDs, node keys, and edge keys must always be sorted ascending.
3. `res_u` tuples represent individual cards — the list length equals the number of unknown cards.
4. The structure only stores probabilities. Logic (Bayesian updates) is responsible for updating them.
5. `res_k` + `len(res_u)` should equal `public[3]` (total resource count).
6. Floats truncated to 2 decimals for token efficiency.

## Data Acquisition
- JS sniffer monkey-patches `WebSocket` on Colonist.io to intercept packets.
- Colonist resource IDs `[1..5]` map to HDCS `[0..4]` (subtract 1).
- Colonist uses cube coords `(q, r, s)` — must convert to tile IDs (0–36) then derive node/edge keys.
- Hidden info (steals, etc.) captured as events. Python backend does Bayesian updates on `res_u`.

## Player Modelling Dimensions
- **Noise**: frequency of suboptimal plays
- **Lag**: perception accuracy vs actual board state
- **Risk Tolerance**: willingness to hold >7 cards, take gambles
- **Play Style**: road-focused vs city-focused (OWS)
- **Trade Behavior**: intensity, urgency, balance of trades
- **Tracking**: how well they track opponent hands / anticipate plays
- **Psychology**: table talk, aura, robber dissuasion

## Board Definition Example

```json
{
  // Note: VP=Victory Point, RB=Road Building, YOP=Year of Plenty, MONO=Monopoly
  // Assume: I am player 0
  "meta": {
    "t": 45,                  // Current Turn
    "p_curr": 1,              // Active Player ID
    "phase": "main",          // main=in-game, settle=pre-game settlement
    
    // HISTORY: Last 8 rolls (Newest -> Oldest)
    "dice": [7, 4, 6, 8, 11, 3, 5, 9],
    
    // GLOBAL TRACKER: Cards NOT YET PLAYED (Deck + All Hands)
    // [Knight, VP, RB, YOP, MONO]
    "dev_rem": [5, 2, 1, 0, 0] 
  },

  "map": {
    "robber": 18, // Tile ID of the robber
    
    // STATIC BOARD DATA (Layout)
    // Tiles: List of [ResourceID, NumberToken] indexed by TileID (0-36).
    // Each entry is a pair because a tile has both a Resource Type AND a Dice Number.
    // Examples: [5, 0] = Desert, [6, 0] = Ocean, [4, 6] = Ore with a 6.
    // ResourceIDs: 0=Wood, 1=Brick, 2=Wool, 3=Grain, 4=Ore, 5=Desert, 6=Ocean
    // NumberToken: 0=Desert/Ocean, -1=Port, 2-12=Dice Number.
    // If NumberToken is -1 (Port), ResourceID indicates port type:
    // [0, -1]=Wood Port, [1, -1]=Brick Port, [5, -1]=General (3:1) Port.
    // IDs 0-36 follow the specific layout (Ocean outer ring -> Center)
    "tiles": [
        [6, 0], [6, 0], [5, -1], ... [4, 6], ... // 0=Ocean, 2=General Port, ...
    ],
    // Ports: Map of NodeTuple -> PortType 
    // Key: "T1_T2_T3" (Sorted Tile IDs of the settlement spot)
    // PortType: 0-4 (2:1 Specific Resource), 5 (3:1 Any)
    // Port Locations (Pairs of Access Spots): 
    // [{0_1_5, 0_4_5}, {1_2_6, 2_6_7}, {7_8_13, 8_13_14}, {14_20_21, 20_21_27}, 
    //  {26_27_32, 26_31_32}, {30_31_35, 30_34_35}, {28_29_33, 29_33_34}, 
    //  {16_22_23, 22_23_28}, {4_9_10, 9_10_16}]
    "ports": {
        // 3:1 Ports (Type 5)
        "0_1_5": 5, "0_4_5": 5,
        "14_20_21": 5, "20_21_27": 5,
        "28_29_33": 5, "29_33_34": 5, 
        "4_9_10": 5, "9_10_16": 5,

        // 2:1 Ports (Types 0=Wood, 1=Brick, 2=Wool, 3=Grain, 4=Ore)
        "1_2_6": 2, "2_6_7": 2,       // Wool
        "7_8_13": 4, "8_13_14": 4,    // Ore
        "26_27_32": 3, "26_31_32": 3, // Grain
        "30_31_35": 1, "30_34_35": 1, // Brick
        "16_22_23": 0, "22_23_28": 0  // Wood
    },

    // DYNAMIC STATE
    // Nodes: "T1_T2_T3" (Sorted) -> [PlayerID, BuildingType]
    // BuildingType: 1=Settlement, 2=City
    "nodes": { "4_5_10": [0, 1], "10_11_17": [1, 2] }, 
    
    // Edges: "T1_T2" (Sorted) -> PlayerID
    "edges": { "4_5": 0, "5_10": 0 }
  },

  "players": [
    // PLAYER 0 (ME - Perfect Information)
    {
      "id": 0,
      "public": [5, 0, 6, 4],  // [VP, Army, Road_Len, Res_Count]
      
      // KNOWN RESOURCES (Integer Counts)
      // [Wood, Brick, Wool, Grain, Ore]
      "res_k": [2, 0, 1, 3, 0],
      
      // UNKNOWN RESOURCES (Empty for me)
      "res_u": [],
      
      // DEV CARDS (My Hand)
      // [Age, Knight, VP, Road, Year, Mono]
      "devs": [
        [3, 1.0, 0, 0, 0, 0], // A Knight bought 3 turns ago
        [0, 0, 1.0, 0, 0, 0]  // A VP just bought (Age 0)
      ]
    },

    // PLAYER 1 (OPPONENT - Probabilistic)
    {
      "id": 1,
      "public": [4, 1, 4, 3], 
      
      // KNOWN RESOURCES (Facts)
      "res_k": [0, 0, 1, 0, 0], 
      
      // UNKNOWN RESOURCES (Card-Level Probability)
      // They have 2 unknown cards. Each is a 5-tuple probability.
      // [P_Wood, P_Brick, P_Wool, P_Grain, P_Ore]
      "res_u": [
        // Card A: Likely Ore
        [0.1, 0.0, 0.1, 0.1, 0.7], 
        // Card B: Random distribution
        [0.2, 0.2, 0.2, 0.2, 0.2]
      ],
      
      // DEV CARDS (Hidden Hand)
      // [Age, P_Knight, P_VP, P_Road, P_Year, P_Mono]
      "devs": [
        // Held for 12 turns. Likely VP or Monopoly
        [12, 0.1, 0.6, 0.0, 0.0, 0.3]
      ]
    }
  ]
}