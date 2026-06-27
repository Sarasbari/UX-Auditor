import os
from pydantic_settings import BaseSettings

class AIRuntimeSettings(BaseSettings):
    """
    Configuration for the UX-Auditor Agentic Runtime.
    No secrets should be stored directly here. They are loaded via environment variables.
    """
    
    # Execution Policies
    execution_policy: str = "balanced"  # Options: fast, balanced, exhaustive
    retry_count: int = 3
    timeout_seconds: int = 300
    
    # Modes
    debug_mode: bool = False
    offline_mode: bool = False  # Set to True when using local quantized models
    
    # Model/Provider Preferences
    provider_preference: str = "openai"  # Options: openai, anthropic, gemini, local
    caching_enabled: bool = True

    class Config:
        env_prefix = "AI_RUNTIME_"
        env_file = ".env"

# Global settings instance
settings = AIRuntimeSettings()
