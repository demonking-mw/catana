import json
import sys
import os

# --- Constants & Configuration ---


# Check if input is a pydantic model
def is_pydantic(obj):
    return hasattr(obj, "model_dump")


class Colors:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"

    # Resource Colors
    WOOD = "\033[38;5;28m"  # Dark Green
    BRICK = "\033[38;5;160m"  # Red
    WOOL = "\033[38;5;253m"  # White/Light Grey
    GRAIN = "\033[38;5;220m"  # Gold/Yellow
    ORE = "\033[38;5;30m"  # Teal/Cyan
    DESERT = "\033[38;5;221m"  # Sand/Bright Yellow
    OCEAN = "\033[38;5;27m"  # Blue

    # UI Element Colors
    ROBBER = "\033[48;5;124m\033[38;5;255m"  # Red bg, white text
    NUMBER = "\033[38;5;255m"  # White
    NUMBER_RED = "\033[38;5;196m"  # Bright Red
    ID = "\033[38;5;240m"  # Dark Grey
    BORDER = "\033[38;5;240m"  # Grey border

    # Port Colors
    PORT = "\033[38;5;214m"  # Orange for ports
    
    # Player Colors
    PLAYER_0 = "\033[38;5;196m"  # Red
    PLAYER_1 = "\033[38;5;33m"   # Blue
    PLAYER_2 = "\033[38;5;255m"  # White
    PLAYER_3 = "\033[38;5;208m"  # Orange

    # Score Colors (heat-map style)
    SCORE_HIGH = "\033[38;5;46m"   # Bright green
    SCORE_MID = "\033[38;5;226m"   # Yellow
    SCORE_LOW = "\033[38;5;245m"   # Grey


RES_MAP = {
    0: ("WOOD", Colors.WOOD),
    1: ("BRICK", Colors.BRICK),
    2: ("WOOL", Colors.WOOL),
    3: ("GRAIN", Colors.GRAIN),
    4: ("ORE", Colors.ORE),
    5: ("DSRT", Colors.DESERT),
    6: ("SEA", Colors.OCEAN),
}

PLAYER_COLORS = [Colors.PLAYER_0, Colors.PLAYER_1, Colors.PLAYER_2, Colors.PLAYER_3]
PLAYER_NAMES = ["Red", "Blue", "White", "Orange"]

# Port type labels (ResourceID -> port display)
# If NumberToken == -1, ResourceID indicates port type:
#   0-4 = 2:1 specific resource port
#   5   = 3:1 general port
PORT_MAP = {
    0: ("Wood", "2:1"),
    1: ("Brick", "2:1"),
    2: ("Wool", "2:1"),
    3: ("Grain", "2:1"),
    4: ("Ore", "2:1"),
    5: ("Any", "3:1"),
}

# 37 Tiles Layout
BOARD_LAYOUT = [
    [0, 1, 2, 3],
    [4, 5, 6, 7, 8],
    [9, 10, 11, 12, 13, 14],
    [15, 16, 17, 18, 19, 20, 21],
    [22, 23, 24, 25, 26, 27],
    [28, 29, 30, 31, 32],
    [33, 34, 35, 36],
]

# --- Canvas Implementation ---


class Canvas:
    def __init__(self, width, height):
        self.width = width
        self.height = height
        # grid[y][x] = (char, color_code)
        self.grid = [[(" ", "")] * width for _ in range(height)]

    def draw_char(self, x, y, char, color=""):
        if 0 <= x < self.width and 0 <= y < self.height:
            if char != " ":
                self.grid[y][x] = (char, color)

    def draw_text(self, x, y, text, color="", center=False):
        if center:
            x = x - len(text) // 2

        for i, char in enumerate(text):
            self.draw_char(x + i, y, char, color)

    def render(self):
        for row in self.grid:
            line_str = ""
            current_color = ""
            for char, color in row:
                if color != current_color:
                    line_str += Colors.RESET + (color or "")
                    current_color = color
                line_str += char
            print(line_str + Colors.RESET)


# --- Hex Drawing Logic ---

# Visual Style: Clean, Spaced Flat-Topped Hexes
#       _______
#      /       \
#     /         \
#    |  CONTENT  |
#     \         /
#      \_______/
#
# This layout ensures readability by spacing tiles slightly.
# Separation prevents the "messy overlap" look.

HEX_TEMPLATE = [
    "      _______      ",
    "     /       \\     ",
    "    /         \\    ",
    "   |           |   ",
    "    \\         /    ",
    "     \\_______/     ",
]

HEX_WIDTH = 19
HEX_HEIGHT = 6

# Spacing Logic
# To create a honeycomb, we stagger rows by Half Width.
# We also overlap rows slightly vertically to allow "nesting" without collision.
COL_X_STRIDE = 16  # spacing between hex centers in a row
ROW_Y_STRIDE = (
    5  # spacing between row centers (Height 6, Stride 5 = 1 line overlap/touch)
)


def build_tile_position_map():
    """Build a map of tile_id -> (x, y) center position."""
    tile_positions = {}
    row_shifts = [3, 2, 1, 0, 1, 2, 3]
    shift_step = 8
    global_x_offset = 2
    global_y_offset = 1
    
    for r_idx, row_ids in enumerate(BOARD_LAYOUT):
        y = global_y_offset + r_idx * ROW_Y_STRIDE + 3  # +3 to center
        x_start = global_x_offset + (row_shifts[r_idx] * shift_step)
        
        for c_idx, tile_id in enumerate(row_ids):
            x = x_start + c_idx * COL_X_STRIDE + 9  # +9 to center
            tile_positions[tile_id] = (x, y)
    
    return tile_positions


def get_vertex_position(tile_ids, tile_positions):
    """Calculate the screen position for a vertex defined by 3 tiles.
    
    Args:
        tile_ids: List of 3 tile IDs that meet at this vertex
        tile_positions: Dict mapping tile_id -> (x, y)
    
    Returns:
        (x, y) position for the vertex, or None if tiles not found
    """
    # Get positions of all three tiles
    positions = []
    for tid in tile_ids:
        if tid in tile_positions:
            positions.append(tile_positions[tid])
    
    if len(positions) < 2:
        return None
    
    # Average the positions to get vertex location
    avg_x = sum(p[0] for p in positions) // len(positions)
    avg_y = sum(p[1] for p in positions) // len(positions)
    
    return (avg_x, avg_y)


def get_edge_position(tile_ids, tile_positions):
    """Calculate the screen position for an edge defined by 2 tiles.
    
    Args:
        tile_ids: List of 2 tile IDs that share this edge
        tile_positions: Dict mapping tile_id -> (x, y)
    
    Returns:
        (x, y) position for the edge midpoint, or None if tiles not found
    """
    if len(tile_ids) < 2:
        return None
    
    positions = []
    for tid in tile_ids:
        if tid in tile_positions:
            positions.append(tile_positions[tid])
    
    if len(positions) < 2:
        return None
    
    # Calculate midpoint between the two tiles
    mid_x = (positions[0][0] + positions[1][0]) // 2
    mid_y = (positions[0][1] + positions[1][1]) // 2
    
    return (mid_x, mid_y)


def get_tile_info(map_state, tile_id):
    """Parses the tile data from the map state.

    Args:
        map_state: Either a dict or a pydantic Board object
        tile_id: ID of the tile to get info for
    """
    try:
        # Handle both pydantic and dict
        if is_pydantic(map_state):
            tiles = map_state.tiles
            robber_pos = map_state.robber
        else:
            tiles = map_state["tiles"]
            robber_pos = map_state.get("robber", -1)

        tile_data = tiles[tile_id]
        res_id = tile_data[0]
        number = tile_data[1]

        res_name, color = RES_MAP.get(res_id, ("UNKNOWN", Colors.RESET))

        is_robber = tile_id == robber_pos
        is_port = number == -1
        port_res = None
        port_ratio = None
        if is_port:
            port_res, port_ratio = PORT_MAP.get(res_id, ("???", "?:?"))

        return {
            "id": tile_id,
            "res_name": res_name,
            "res_id": res_id,
            "number": number,
            "color": color,
            "is_robber": is_robber,
            "is_port": is_port,
            "port_res": port_res,
            "port_ratio": port_ratio,
        }
    except IndexError:
        return None


def _score_color(score, min_s, max_s):
    """Pick a heat-map color for a settlement score."""
    if max_s <= min_s:
        return Colors.SCORE_MID
    ratio = (score - min_s) / (max_s - min_s)
    if ratio >= 0.66:
        return Colors.SCORE_HIGH
    elif ratio >= 0.33:
        return Colors.SCORE_MID
    return Colors.SCORE_LOW


def draw_settle_scores(canvas, settle_scores, tile_positions):
    """Overlay settlement evaluation scores on every valid node.

    Args:
        canvas: Canvas to draw on.
        settle_scores: Dict[str, float] mapping node_key -> score.
        tile_positions: Dict mapping tile_id -> (x, y) center position.
    """
    if not settle_scores:
        return

    scores = list(settle_scores.values())
    min_s = min(scores)
    max_s = max(scores)

    for node_key, score in settle_scores.items():
        tile_ids = [int(t) for t in node_key.split("_")]
        pos = get_vertex_position(tile_ids, tile_positions)
        if pos is None:
            continue
        x, y = pos
        color = _score_color(score, min_s, max_s)
        label = f"{score:.1f}"
        canvas.draw_text(x, y, label, color, center=True)


def draw_settlements_and_roads(canvas, game_state, tile_positions):
    """Draw settlements, cities, and roads on the board.

    Args:
        canvas: Canvas object to draw on
        game_state: Either a dict or a pydantic GameState object
        tile_positions: Dict mapping tile_id -> (x, y) center position
    """
    # Handle both pydantic and dict
    if is_pydantic(game_state):
        map_state = game_state.map
    else:
        map_state = game_state.get("map", {})

    if not map_state:
        return

    # Handle both pydantic and dict for nodes and edges
    if is_pydantic(map_state):
        nodes = map_state.nodes
        edges = map_state.edges
    else:
        nodes = map_state.get("nodes", {})
        edges = map_state.get("edges", {})

    # Draw settlements and cities
    for node_key, building_info in nodes.items():
        # building_info = [player_id, building_type] where 1=settlement, 2=city
        if isinstance(building_info, list) and len(building_info) >= 2:
            player_id = building_info[0]
            building_type = building_info[1]
            
            # Parse node key "T1_T2_T3" to get tile IDs
            tile_ids = [int(t) for t in node_key.split("_")]
            
            # Get vertex position
            pos = get_vertex_position(tile_ids, tile_positions)
            if pos:
                x, y = pos
                color = PLAYER_COLORS[player_id % 4]
                if building_type == 1:  # Settlement
                    canvas.draw_char(x, y, "▲", color)
                else:  # City
                    canvas.draw_char(x, y, "■", color)

    # Draw roads
    for edge_key, player_id in edges.items():
        # Parse edge key "T1_T2" to get tile IDs
        tile_ids = [int(t) for t in edge_key.split("_")]
        
        # Get edge position
        pos = get_edge_position(tile_ids, tile_positions)
        if pos:
            x, y = pos
            color = PLAYER_COLORS[player_id % 4]
            
            # Determine road orientation based on tile positions
            if len(tile_ids) >= 2 and tile_ids[0] in tile_positions and tile_ids[1] in tile_positions:
                x1, y1 = tile_positions[tile_ids[0]]
                x2, y2 = tile_positions[tile_ids[1]]
                
                # Draw road with appropriate orientation
                if abs(x1 - x2) > abs(y1 - y2):  # More horizontal
                    canvas.draw_char(x, y, "═", color)
                elif abs(y1 - y2) > 3:  # More vertical
                    canvas.draw_char(x, y, "║", color)
                else:  # Diagonal
                    if (x2 - x1) * (y2 - y1) > 0:
                        canvas.draw_char(x, y, "\\", color)
                    else:
                        canvas.draw_char(x, y, "/", color)


def draw_board(canvas, game_state):
    """Draw the board on the canvas.

    Args:
        canvas: Canvas object to draw on
        game_state: Either a dict or a pydantic GameState object
    """
    # Handle both pydantic and dict
    if is_pydantic(game_state):
        map_state = game_state.map
    else:
        map_state = game_state.get("map", {})

    if not map_state:
        return

    # Offsets to align the staggered rows
    # Row 3 (7 tiles) is the widest.
    # Pattern: 4, 5, 6, 7, 6, 5, 4
    # Row 0 needs to be shifted right by 3 * HalfStride?
    # R3: 0
    # R2: +8 (Half stride of 16)
    # R1: +16
    # R0: +24

    # Let's verify:
    # Row 3 starts at 0.
    # Row 2 (6 tiles) starts where? It should be nestled between R3's first and second?
    # Standard Hex Grid:
    # R2 T0 is above R3 T0 and R3 T1.
    # So R2 T0 X > R3 T0 X.
    # Yes, shift right.

    shift_step = 8  # Half of COL_X_STRIDE (16)

    # 0 -> 4 tiles -> Need +3 shifts relative to row 3?
    # 1 -> 5 tiles -> Need +2 shifts
    # 2 -> 6 tiles -> Need +1 shift
    # 3 -> 7 tiles -> 0 shift
    # 4 -> 6 tiles -> +1 shift
    # ...

    row_shifts = [3, 2, 1, 0, 1, 2, 3]

    global_x_offset = 2
    global_y_offset = 1

    for r_idx, row_ids in enumerate(BOARD_LAYOUT):
        y = global_y_offset + r_idx * ROW_Y_STRIDE
        x_start = global_x_offset + (row_shifts[r_idx] * shift_step)

        for c_idx, tile_id in enumerate(row_ids):
            x = x_start + c_idx * COL_X_STRIDE

            info = get_tile_info(map_state, tile_id)
            if info:
                color = info["color"]
                if info["is_port"]:
                    border_color = Colors.DIM + Colors.OCEAN  # Blue border for ports
                else:
                    border_color = Colors.DIM + color  # Dim border

                # Draw Template - BORDERS REMOVED FOR CLEANER LOOK
                # for i, line in enumerate(HEX_TEMPLATE):
                #     for j, char in enumerate(line):
                #         if char != " ":
                #             canvas.draw_char(x + j, y + i, char, border_color)

                # Content
                cx = x + 9  # Center of 19-char width

                # ID (Top)
                canvas.draw_text(cx, y + 1, f"#{tile_id}", Colors.ID, center=True)

                if info["is_port"]:
                    # --- Port Tile ---
                    # Show "PORT" label, resource type, and ratio
                    pc = Colors.PORT
                    # Use the resource-specific color for the port resource name
                    res_color = (
                        RES_MAP.get(info["res_id"], ("", Colors.PORT))[1]
                        if info["res_id"] <= 4
                        else pc
                    )
                    canvas.draw_text(cx, y + 2, "PORT", pc, center=True)
                    canvas.draw_text(
                        cx,
                        y + 3,
                        f"{info['port_res']} {info['port_ratio']}",
                        res_color,
                        center=True,
                    )
                elif info["is_robber"]:
                    # --- Robber Tile ---
                    canvas.draw_text(cx, y + 2, info["res_name"], color, center=True)
                    canvas.draw_text(cx, y + 3, "ROBBER", Colors.ROBBER, center=True)
                else:
                    # --- Normal Tile ---
                    # Resource Name (Middle)
                    canvas.draw_text(cx, y + 2, info["res_name"], color, center=True)

                    if info["number"] > 0:
                        num_col = (
                            Colors.NUMBER_RED
                            if info["number"] in [6, 8]
                            else Colors.NUMBER
                        )

                        pips = {
                            2: 1,
                            12: 1,
                            3: 2,
                            11: 2,
                            4: 3,
                            10: 3,
                            5: 4,
                            9: 4,
                            6: 5,
                            8: 5,
                        }.get(info["number"], 0)
                        dots = "." * pips

                        canvas.draw_text(
                            cx, y + 3, f"{info['number']} {dots}", num_col, center=True
                        )

                    elif info["res_id"] == 6:  # Ocean
                        canvas.draw_text(cx, y + 3, "~ ~", Colors.DIM, center=True)


def draw_player_stats(game_state):
    """Print player statistics below the board.

    Args:
        game_state: Either a dict or a pydantic GameState object
    """
    # Handle both pydantic and dict
    if is_pydantic(game_state):
        players = game_state.players
        meta = game_state.meta
    else:
        players = game_state.get("players", [])
        meta = game_state.get("meta", {})

    if not players:
        print(f"{Colors.DIM}No player data available{Colors.RESET}")
        return

    print(f"\n{Colors.BOLD}=== PLAYER STATISTICS ==={Colors.RESET}\n")
    
    # Get current player and turn info
    if is_pydantic(meta):
        current_player = meta.p_curr
        turn = meta.t
        phase = meta.phase
    else:
        current_player = meta.get("p_curr", 0)
        turn = meta.get("t", 0)
        phase = meta.get("phase", "unknown")
    
    print(f"Turn: {Colors.BOLD}{turn}{Colors.RESET} | Phase: {Colors.BOLD}{phase}{Colors.RESET} | Current: {Colors.BOLD}Player {current_player}{Colors.RESET}\n")

    # Print header
    header = f"{'Player':<10} {'VP':<5} {'Army':<6} {'Road':<6} {'Resources':<12} {'Dev Cards':<10}"
    print(f"{Colors.BOLD}{header}{Colors.RESET}")
    print("─" * 60)

    for player in players:
        # Handle both pydantic and dict
        if is_pydantic(player):
            player_id = player.id
            public = player.public
            res_k = player.res_k
            devs = player.devs
        else:
            player_id = player.get("id", 0)
            public = player.get("public", [0, 0, 0, 0])
            res_k = player.get("res_k", [0, 0, 0, 0, 0])
            devs = player.get("devs", [])

        # Extract public info: [VP, Army, RoadLength, ResCount]
        vp = public[0] if len(public) > 0 else 0
        army = public[1] if len(public) > 1 else 0
        road_length = public[2] if len(public) > 2 else 0
        res_count = public[3] if len(public) > 3 else 0

        # Calculate resource count from known resources
        known_res = sum(res_k) if res_k else 0
        
        # Count dev cards
        dev_count = len(devs)

        # Color for current player
        color = PLAYER_COLORS[player_id % 4]
        name = PLAYER_NAMES[player_id % 4]
        
        current_marker = "→ " if player_id == current_player else "  "
        
        player_line = f"{current_marker}{name:<8} {vp:<5} {army:<6} {road_length:<6} {known_res}/{res_count:<8} {dev_count:<10}"
        print(f"{color}{player_line}{Colors.RESET}")
    
    print()


def load_board(path):
    with open(path, "r") as f:
        return json.load(f)


def render_board(game_state, show_scores=False):
    """Render the full board visualisation.

    Args:
        game_state: A raw dict **or** a pydantic ``GameState`` object.
        show_scores: If True and ``game_state.settle_scores`` is populated,
                     overlay the settlement evaluation score on every valid
                     node.  When the data is a raw dict, this flag is ignored.
    """
    print(f"\n{Colors.BOLD}--- WATAN++ BOARD VISUALIZATION ---{Colors.RESET}\n")

    # Legend
    print(f"{Colors.BOLD}Legend:{Colors.RESET}")
    print(f"  {PLAYER_COLORS[0]}▲{Colors.RESET} = Settlement  {PLAYER_COLORS[0]}■{Colors.RESET} = City  {PLAYER_COLORS[0]}═/║/\\//{Colors.RESET} = Road")
    for i, (name, color) in enumerate(zip(PLAYER_NAMES, PLAYER_COLORS)):
        print(f"  {color}■{Colors.RESET} = {name} (Player {i})", end="  ")
    if show_scores:
        print(f"\n  {Colors.SCORE_HIGH}##.#{Colors.RESET} = Score (high)  "
              f"{Colors.SCORE_MID}##.#{Colors.RESET} = Score (mid)  "
              f"{Colors.SCORE_LOW}##.#{Colors.RESET} = Score (low)", end="")
    print("\n")

    # Build tile position map
    tile_positions = build_tile_position_map()

    # 7 tiles * 16 stride + width ~ 130
    canvas = Canvas(130, 45)
    draw_board(canvas, game_state)

    # Optionally draw settlement scores *before* buildings so that
    # actual settlements/cities overwrite the score at occupied spots.
    if show_scores:
        settle_scores = None
        if is_pydantic(game_state) and hasattr(game_state, "settle_scores"):
            settle_scores = game_state.settle_scores
        elif isinstance(game_state, dict):
            settle_scores = game_state.get("settle_scores")
        if settle_scores:
            draw_settle_scores(canvas, settle_scores, tile_positions)

    # Draw settlements, cities, and roads (overwrites scores at occupied spots)
    draw_settlements_and_roads(canvas, game_state, tile_positions)

    canvas.render()

    # Print player statistics
    draw_player_stats(game_state)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Watan++ Board Visualizer")
    parser.add_argument("path", help="Path to the HDCS JSON file")
    parser.add_argument(
        "--scores",
        action="store_true",
        help="Overlay settlement evaluation scores on every valid node "
             "(requires the data to be augmented with settle_scores, "
             "e.g. via GameState.evaluate_all_settlements())",
    )
    args = parser.parse_args()

    if not os.path.exists(args.path):
        print(f"Error: File not found at {args.path}")
        sys.exit(1)

    try:
        game_state = load_board(args.path)

        # If --scores is requested, try to parse via GameState to run eval
        if args.scores:
            # Add src/ to path so we can import base_computes
            src_dir = os.path.join(os.path.dirname(__file__), "..", "src")
            if src_dir not in sys.path:
                sys.path.insert(0, os.path.abspath(src_dir))
            try:
                from base_computes.game_state import GameState
                gs = GameState.from_json(game_state)
                if gs.settle_scores is None:
                    gs.evaluate_all_settlements()
                game_state = gs
            except Exception as eval_err:
                print(f"{Colors.DIM}Warning: could not compute scores: {eval_err}{Colors.RESET}")

        render_board(game_state, show_scores=args.scores)

    except Exception as e:
        print(f"Error: {e}")
        import traceback

        traceback.print_exc()
