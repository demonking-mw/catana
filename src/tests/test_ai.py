#!/usr/bin/env python3
"""Example usage of the AI query module - sync and async."""

import sys
import os
import asyncio

# Add src to path (parent directory of tests)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ai import query_ai, query_ai_async, AIProvider


# Sync usage
print("=== Sync Call ===")
response = query_ai(
    "What is 17 + 25? Reply with just the number.",
    provider=AIProvider.OPENAI,
)
print(response)


# Async usage
async def test_async():
    print("\n=== Async Call ===")
    response = await query_ai_async(
        "What should I build first in Catan?",
        provider=AIProvider.OPENAI,
        system="You are a Catan strategy expert. Be concise.",
    )
    print(response)


asyncio.run(test_async())
