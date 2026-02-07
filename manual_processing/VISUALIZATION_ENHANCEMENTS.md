# Enhanced Catan Board Visualization

## Summary of Improvements

The board visualization has been significantly enhanced to display player stats, roads, settlements, and cities in addition to the hex tiles.

## What's New

### 1. **Player Color System**
- **Red** (Player 0) - `\033[38;5;196m`
- **Blue** (Player 1) - `\033[38;5;33m`
- **White** (Player 2) - `\033[38;5;255m`
- **Orange** (Player 3) - `\033[38;5;208m`

### 2. **Settlement & City Display**
- **Settlements**: Displayed as colored triangles `▲` at vertex positions
- **Cities**: Displayed as colored squares `■` at vertex positions
- Each building is colored according to its owner (using player colors)
- Buildings are parsed from the `nodes` dictionary in the map data:
  - Format: `"T1_T2_T3": [player_id, building_type]`
  - `building_type`: 1 = settlement, 2 = city

### 3. **Road Display**
- **Roads**: Displayed as colored double lines `═` along hex edges
- Each road is colored according to its owner
- Roads are parsed from the `edges` dictionary in the map data:
  - Format: `"T1_T2": player_id`

### 4. **Player Statistics Panel**
Below the board, a comprehensive statistics table displays:
- **Player Name/Color**: Each player's color and identifier
- **VP**: Victory Points
- **Army**: Largest army size
- **Road**: Longest road length
- **Resources**: Known resources / Total resource count (format: `known/total`)
- **Dev Cards**: Number of development cards in hand
- **Current Player**: Indicated with an arrow `→` marker

### 5. **Game State Information**
- Current turn number
- Current game phase (init, main, settle, etc.)
- Active player

### 6. **Legend Display**
At the top of the visualization, a legend shows:
- Building symbols (settlement, city, road)
- Player color mappings

## Data Structure Reference

### Nodes (Settlements/Cities)
```json
"nodes": {
  "5_6_11": [0, 1],  // Settlement (type=1) at vertex of tiles 5,6,11, owned by player 0
  "6_7_12": [0, 2]   // City (type=2) at vertex of tiles 6,7,12, owned by player 0
}
```

### Edges (Roads)
```json
"edges": {
  "5_6": 0,   // Road along edge between tiles 5 and 6, owned by player 0
  "6_11": 0   // Road along edge between tiles 6 and 11, owned by player 0
}
```

### Player Data
```json
"players": [
  {
    "id": 0,
    "public": [3, 2, 4, 7],              // [VP, Army, RoadLength, ResCount]
    "res_k": [2, 1, 1, 2, 1],            // Known resources [Wood, Brick, Wool, Grain, Ore]
    "res_u": [],                          // Unknown resource probabilities
    "devs": [[1, 1.0, 0.0, 0.0, 0.0, 0.0]] // Dev cards [Age, P_Knight, P_VP, P_RB, P_YOP, P_Mono]
  }
]
```

## Usage

```bash
# Run from the manual_processing directory
python visualize_board.py ../sample.json

# Or with a full path
python visualize_board.py /path/to/game_state.json
```

## Example Output Structure

```
--- WATAN++ BOARD VISUALIZATION ---

Legend:
  ▲ = Settlement  ■ = City  ═ = Road
  ■ = Red (Player 0)  ■ = Blue (Player 1)  ■ = White (Player 2)  ■ = Orange (Player 3)

[ASCII Board with colored hexes, settlements, cities, and roads]

=== PLAYER STATISTICS ===

Turn: 5 | Phase: main | Current: Player 1

Player     VP    Army   Road   Resources    Dev Cards
────────────────────────────────────────────────────────
  Red      3     2      4      7/7          2
→ Blue     4     3      6      5/5          1
  White    2     0      3      4/4          0
  Orange   2     1      5      6/6          1
```

## Technical Implementation

### Key Functions

1. **`build_tile_position_map()`**
   - Builds a complete map of tile_id -> (x, y) center position
   - Accounts for hex spacing and row staggering
   - Returns dictionary for fast position lookups

2. **`get_vertex_position(tile_ids, tile_positions)`**
   - Calculates exact screen position for a vertex (settlement/city)
   - Takes 3 tile IDs that meet at the vertex
   - Averages their positions to find the vertex location

3. **`get_edge_position(tile_ids, tile_positions)`**
   - Calculates exact screen position for an edge (road)
   - Takes 2 tile IDs that share the edge
   - Finds midpoint between the two tiles

4. **`draw_settlements_and_roads(canvas, game_state, tile_positions)`**
   - Parses node and edge data from game state
   - Uses topology functions to calculate accurate positions
   - Draws colored markers with proper orientation:
     - Horizontal roads: `═`
     - Vertical roads: `║`
     - Diagonal roads: `/` or `\`

5. **`draw_player_stats(game_state)`**
   - Extracts player information
   - Formats statistics table
   - Highlights current player with arrow marker

### Compatibility
- Works with both pydantic GameState objects and raw JSON dictionaries
- Handles missing data gracefully (empty players, nodes, edges)
- Supports the auto-initialization of 4 default players when player list is empty

## Testing

Run the test visualization:
```bash
cd /path/to/wpp/src/manual_processing
python test_visualization.py
```

Or test with your own JSON file:
```bash
python visualize_board.py ../test_game.json
```

## Implementation Details

### Position Calculation
The implementation uses a topology-based approach:
1. First, build a complete position map for all 37 tiles
2. For vertices (settlements/cities): Average the positions of the 3 adjacent tiles
3. For edges (roads): Calculate midpoint between 2 adjacent tiles
4. Determine road orientation based on tile positions (horizontal/vertical/diagonal)

### Road Orientation Logic
- If `|Δx| > |Δy|`: Horizontal road `═`
- If `|Δy| > 3`: Vertical road `║`
- Otherwise: Diagonal road `/` or `\` based on slope

### Color System
Four distinct player colors ensure clear ownership:
- Player 0: Bright Red (#196)
- Player 1: Bright Blue (#33)
- Player 2: White (#255)
- Player 3: Orange (#208)

## Future Enhancements

Potential improvements for future versions:
- Port access indicators on settlements
- Highlight tiles adjacent to settlements for resource production
- Show resource production probabilities per player
- Display development card types (Knights, VP, etc.) in player stats
- Interactive mode for inspecting tiles/buildings
- Highlight longest road path
- Show largest army indicator
