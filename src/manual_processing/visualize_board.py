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


RES_MAP = {
    0: ("WOOD", Colors.WOOD),
    1: ("BRICK", Colors.BRICK),
    2: ("WOOL", Colors.WOOL),
    3: ("GRAIN", Colors.GRAIN),
    4: ("ORE", Colors.ORE),
    5: ("DSRT", Colors.DESERT),
    6: ("SEA", Colors.OCEAN),
}

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

                # Draw Template
                for i, line in enumerate(HEX_TEMPLATE):
                    for j, char in enumerate(line):
                        if char != " ":
                            canvas.draw_char(x + j, y + i, char, border_color)

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


def load_board(path):
    with open(path, "r") as f:
        return json.load(f)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python visualize_board.py <path_to_json>")
        sys.exit(1)

    path = sys.argv[1]
    if not os.path.exists(path):
        print(f"Error: File not found at {path}")
        sys.exit(1)

    try:
        game_state = load_board(path)
        print(f"\n{Colors.BOLD}--- WATAN++ BOARD VISUALIZATION ---{Colors.RESET}\n")
        # 7 tiles * 16 stride + width ~ 130
        canvas = Canvas(130, 40)
        draw_board(canvas, game_state)
        canvas.render()
        print("\n")
    except Exception as e:
        print(f"Error: {e}")
        import traceback

        traceback.print_exc()
