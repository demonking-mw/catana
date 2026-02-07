import os
import time
import PIL.Image
from google import genai
from google.genai import types

# 1. SETUP - Use the Production Flash model for highest limits
client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
MODEL_ID = "gemini-2.0-flash"  # Matches your 2,000 RPM quota

def scale_image(img_path, max_dimension=1024):
    """Resizes image to save tokens and avoid 429s."""
    img = PIL.Image.open(img_path)
    w, h = img.size
    if max(w, h) > max_dimension:
        scale = max_dimension / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), PIL.Image.Resampling.LANCZOS)
    return img

def run_test():
    print("🚀 Optimizing images...")
    # Scaling down helps significantly with "Resource Exhausted" errors
    ref_map = scale_image('reference_map.png')
    live_board = scale_image('live_board.png')

    extraction_prompt = """
    You are an expert Catan Board Analyzer. Your task is to analyze the provided image of a Catan board and generate a valid JSON representation of the board state, specifically focusing on the board layout (tiles and ports).

1. Grid & Indexing System
The board consists of 37 hexagonal tiles: a central island of 19 logical resource tiles surrounded by a ring of 18 ocean tiles.
You must map these tiles to a linear list (Indices 0-36) using Row-Major Order (Top to Bottom, Left to Right).

Grid Layout:
Row 0 (Top): 4 Ocean tiles [Indices 0, 1, 2, 3]
Row 1: 1 Ocean, 3 Resource, 1 Ocean [Indices 4, 5, 6, 7, 8]
Row 2: 1 Ocean, 4 Resource, 1 Ocean [Indices 9, 10, 11, 12, 13, 14]
Row 3 (Middle): 1 Ocean, 5 Resource, 1 Ocean [Indices 15, 16, 17, 18, 19, 20, 21]
Row 4: 1 Ocean, 4 Resource, 1 Ocean [Indices 22, 23, 24, 25, 26, 27]
Row 5: 1 Ocean, 3 Resource, 1 Ocean [Indices 28, 29, 30, 31, 32]
Row 6 (Bottom): 4 Ocean tiles [Indices 33, 34, 35, 36]

2. Tile Data Format
For each of the 37 tiles, output a tuple: [ResourceID, NumberToken].

Resource Identification:
Identify the resource based on the terrain color/art:
Wood (0): Dark Green / Forest / Tree
Brick (1): Red / Orange / Clay / Hills / A pile of bricks / 7 rectangles stacked
Wool (2): Light Green / Sheep / Pasture
Grain (3): Yellow / Wheat / Fields / The icon of a sheaf of wheat
Ore (4): Grey / Rock / Mountains / a few circly "stones"
Desert (5): Tan / Sand (No number token)
Ocean (6): Blue / Water

Token Identification:
2-12: The number visible on the pip/token on the tile.
0: Use 0 for Tiles with NO number (Desert, Ocean).
-1: Use -1 for Ocean Tiles containing a Port.

3. Port Logic (Updates Ocean Tiles)
Ocean tiles often contain Ports (ships/docks).
NOTE: By this definitio, ports are located ONLY at indices: [0, 2, 8, 9, 21, 22, 32, 33, 35]. 
CRITICAL: Do NOT hallmark any other tile as a port!
To help identify ports, look for the icons on the sail of the ship. 3:1 general ports have a ? on them.
Verify these locations on the image. If a port exists at these indices:
Use NumberToken = -1 and set ResourceID to the Port Converted Type:
Wood Port (2:1): ResourceID 0, Token -1
Brick Port (2:1): ResourceID 1, Token -1
Wool Port (2:1): ResourceID 2, Token -1
Grain Port (2:1): ResourceID 3, Token -1
Ore Port (2:1): ResourceID 4, Token -1
General Port (3:1): ResourceID 5, Token -1 (Note: ID 5 is normally Desert, but when Token is -1, it signifies a 3:1 Port)
Plain Ocean: ResourceID 6, Token 0

4. Output Format (JSON)
Return ONLY the raw JSON object. Do not include markdown formatting or explanations.

Template:
{
  "meta": {
    "t": 0,
    "p_curr": 0,
    "phase": "init",
    "dice": [],
    "dev_rem": [14, 5, 2, 2, 2] 
  },
  "map": {
    "robber": -1, 
    "tiles": [
       // Fill this array with exactly 37 tuples [ResultID, Token]
       // Row 0
       [6, 0], [6, 0], ...
       // ... 
    ],
    "nodes": {},
    "edges": {},
    "ports": {} 
  },
  "players": []
}

Task:
Analyze the image. generate the map.tiles array accurately. Populate robber with the ID of the tile containing the grey robber piece (if visible, otherwise -1). Leave nodes, edges, ports (the dict), and players empty as requested.



{
"meta": {
"t": 0,
"p_curr": 0,
"phase": "init",
"dice": [],
"dev_rem": [14, 5, 2, 2, 2]
},
"map": {
"robber": 20,
"tiles": [
[5, -1], [6, 0], [2, -1], [6, 0],
[6, 0], [3, 6], [2, 2], [0, 5], [3, -1],
[5, -1], [4, 3], [4, 9], [1, 10], [1, 8], [6, 0],
[6, 0], [0, 8], [0, 4], [4, 11], [2, 3], [5, 0], [1, -1],
[5, -1], [2, 10], [3, 5], [1, 6], [3, 4], [6, 0],
[6, 0], [0, 9], [2, 12], [3, 11], [4, -1],
[5, -1], [6, 0], [0, -1], [6, 0]
],
"nodes": {},
"edges": {},
"ports": {}
},
"players": []
}
    """

    print(f"📡 Sending to {MODEL_ID}...")
    try:
        response = client.models.generate_content(
            model=MODEL_ID,
            contents=[extraction_prompt, ref_map, live_board],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1 # Low temperature for strict JSON accuracy
            )
        )
        
        print("--- EXTRACTED JSON ---")
        print(response.text)
        
        with open("extracted_state.json", "w") as f:
            f.write(response.text)
        print("\n✅ Success! Check extracted_state.json")

    except Exception as e:
        print(f"❌ Error: {e}")
        if "429" in str(e):
            print("TIP: Wait 60 seconds. Tier 1 has 'burst' protections.")

if __name__ == "__main__":
    run_test()