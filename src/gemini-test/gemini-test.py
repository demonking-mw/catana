from google import genai
from google.genai import types

client = genai.Client(api_key="AIzaSyAfCzh_LsGjz0O7sDfhW8sdF1C2X8Pz5HM")

# 1. Define the Computer Use tool
generate_content_config = types.GenerateContentConfig(
    tools=[
        types.Tool(
            computer_use=types.ComputerUse(
                environment=types.Environment.ENVIRONMENT_BROWSER
            )
        )
    ],
)

# 2. Start the conversation with a goal
response = client.models.generate_content(
    model='gemini-2.5-computer-use-preview-10-2025',
    contents="Go to Amazon, search for 'mechanical keyboard', and find the cheapest one.",
    config=generate_content_config,
)

# 3. Handle the tool call
# You must parse response.candidates[0].content.parts for function_calls
# and execute them using Playwright (click, type, scroll).