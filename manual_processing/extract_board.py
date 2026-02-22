import os
import sys
import json
import PIL.Image
from google import genai
from google.genai import types


def scale_image(img_path, max_dim=1024):
    img = PIL.Image.open(img_path)
    w, h = img.size
    if max(w, h) > max_dim:
        s = max_dim / max(w, h)
        img = img.resize((int(w * s), int(h * s)), PIL.Image.Resampling.LANCZOS)
    return img


def main():
    if len(sys.argv) < 3:
        print("Usage: python extract_board.py <image_path> <output_json_path>")
        sys.exit(1)

    image_path = sys.argv[1]
    output_path = sys.argv[2]

    # Load prompt from the markdown file
    prompt_file = os.path.join(os.path.dirname(__file__), "..", "..", "info", "board_analysis_prompt.md")
    with open(prompt_file, "r") as f:
        prompt = f.read()

    # Load images
    ref_map = scale_image(os.path.join(os.path.dirname(__file__), "..", "..", "info", "board_defn.jpg"))
    live_board = scale_image(image_path)

    # Call Gemini
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=[prompt, ref_map, live_board],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.1,
        ),
    )

    # Validate it's real JSON, then write
    data = json.loads(response.text)
    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)

    print(f"Saved to {output_path}")
    print(json.dumps(data, indent=2))


if __name__ == "__main__":
    main()