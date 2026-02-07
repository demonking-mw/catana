#!/usr/bin/env python3
"""Quick test of the AI query module with OpenAI."""

import sys
import os

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from ai import query_ai, AIProvider, get_available_providers


def main():
    print("=" * 60)
    print("Testing AI Query Module with OpenAI")
    print("=" * 60)
    
    # Check available providers
    available = get_available_providers()
    print(f"\nAvailable providers: {[p.value for p in available]}")
    
    if AIProvider.OPENAI not in available:
        print("\n❌ OPENAI_API_KEY not set in environment")
        print("   Set it with: export OPENAI_API_KEY=your-key-here")
        sys.exit(1)
    
    print("\n✓ OpenAI API key found")
    
    # Test 1: Simple query
    print("\n" + "-" * 60)
    print("Test 1: Simple arithmetic question")
    print("-" * 60)
    
    try:
        response = query_ai(
            "What is 17 + 25? Reply with just the number.",
            provider=AIProvider.OPENAI,
            temperature=0.0,
            max_tokens=10,
        )
        print(f"Prompt: What is 17 + 25?")
        print(f"Response: {response}")
        print("✓ Test 1 passed")
    except Exception as e:
        print(f"❌ Test 1 failed: {e}")
        sys.exit(1)
    
    # Test 2: Query with system prompt
    print("\n" + "-" * 60)
    print("Test 2: Query with system instruction")
    print("-" * 60)
    
    try:
        response = query_ai(
            "What should I build first in Catan?",
            provider=AIProvider.OPENAI,
            system="You are a Catan strategy expert. Be concise.",
            temperature=0.3,
            max_tokens=100,
        )
        print(f"Prompt: What should I build first in Catan?")
        print(f"Response: {response[:150]}..." if len(response) > 150 else f"Response: {response}")
        print("✓ Test 2 passed")
    except Exception as e:
        print(f"❌ Test 2 failed: {e}")
        sys.exit(1)
    
    print("\n" + "=" * 60)
    print("✓ All tests passed! OpenAI integration works.")
    print("=" * 60)


if __name__ == "__main__":
    main()
