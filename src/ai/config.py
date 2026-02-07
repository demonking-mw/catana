"""
AI provider configuration and credential management.

Credentials are loaded from environment variables. Set them before use:
  - OpenAI:    OPENAI_API_KEY
  - Anthropic: ANTHROPIC_API_KEY
  - Google:    GOOGLE_API_KEY

To add a new provider:
  1. Add an entry to AIProvider enum.
  2. Add its env-var key to _ENV_KEYS.
  3. Add default model to _DEFAULT_MODELS.
  4. Implement the sync/async call in query.py (_PROVIDER_DISPATCH / _PROVIDER_DISPATCH_ASYNC).
"""

from enum import Enum
from os import environ
from typing import Optional


class AIProvider(str, Enum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GOOGLE = "google"


# Map provider → environment variable that stores the API key
_ENV_KEYS: dict[AIProvider, str] = {
    AIProvider.OPENAI: "OPENAI_API_KEY",
    AIProvider.ANTHROPIC: "ANTHROPIC_API_KEY",
    AIProvider.GOOGLE: "GOOGLE_API_KEY",
}

# Default model per provider (override at call-time if needed)
DEFAULT_MODELS: dict[AIProvider, str] = {
    AIProvider.OPENAI: "gpt-4o",
    AIProvider.ANTHROPIC: "claude-sonnet-4-20250514",
    AIProvider.GOOGLE: "gemini-2.0-flash",
}

# Sensible global default provider
DEFAULT_PROVIDER: AIProvider = AIProvider.OPENAI


def get_api_key(provider: AIProvider) -> str:
    """Retrieve the API key for *provider* from the environment."""
    env_var = _ENV_KEYS[provider]
    key = environ.get(env_var)
    if not key:
        raise EnvironmentError(
            f"Missing API key: set the {env_var} environment variable."
        )
    return key


def get_default_model(provider: AIProvider) -> str:
    """Return the default model string for *provider*."""
    return DEFAULT_MODELS[provider]


def get_available_providers() -> list[AIProvider]:
    """Return providers whose API key is currently set in the environment."""
    return [p for p in AIProvider if environ.get(_ENV_KEYS[p])]
