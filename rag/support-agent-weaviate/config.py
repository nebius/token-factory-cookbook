import os
from typing import Dict
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Nebius Token Factory Configuration
    NEBIUS_API_KEY = os.getenv("NEBIUS_API_KEY")
    NEBIUS_BASE_URL = os.getenv("NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1")
    NOTION_API_KEY = os.getenv("NOTION_API_KEY")
    NOTION_DATABASE_ID = os.getenv("NOTION_DATABASE_ID")
    # Calendly: prefer CALENDLY_* but support legacy CAL_* envs
    CALENDLY_API_KEY = os.getenv("CALENDLY_API_KEY") or os.getenv("CAL_API_KEY")
    CALENDLY_EVENT_TYPE_ID = os.getenv("CALENDLY_EVENT_TYPE_ID") or os.getenv("CAL_EVENT_TYPE_ID")
    CALENDLY_USERNAME = os.getenv("CALENDLY_USERNAME")
    
    # Models
    LLM_MODEL = "zai-org/GLM-4.5"
    EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-8B"
    
    # External APIs
    EXA_API_KEY = os.getenv("EXA_API_KEY")
    TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
    SEARCH_PROVIDER = os.getenv("SEARCH_PROVIDER", "exa")
    KEYWORDS_AI_API_KEY = os.getenv("KEYWORDS_AI_API_KEY", "")
    
    # Weaviate Configuration
    WEAVIATE_URL = os.getenv("WEAVIATE_URL")
    WEAVIATE_API_KEY = os.getenv("WEAVIATE_API_KEY")
    WEAVIATE_CLASS_NAME = "Documents"
    
    # Processing Configuration
    DEFAULT_CHUNK_SIZE = 1000
    DEFAULT_CHUNK_OVERLAP = 200
    DEFAULT_SEARCH_RESULTS = 5
    # New granular defaults (fallback to DEFAULT_SEARCH_RESULTS if not overridden)
    DEFAULT_WEB_RESULTS = int(os.getenv("DEFAULT_WEB_RESULTS", DEFAULT_SEARCH_RESULTS))
    DEFAULT_DOCS_RETRIEVAL = int(os.getenv("DEFAULT_DOCS_RETRIEVAL", DEFAULT_SEARCH_RESULTS))
    EMBEDDING_BATCH_SIZE = 10
    # Retrieval gating
    DEFAULT_MIN_VECTOR_RELEVANCE = float(os.getenv("DEFAULT_MIN_VECTOR_RELEVANCE", 0.7))
    
    @classmethod
    def validate_config(cls) -> Dict[str, bool]:
        """Validate required environment variables"""
        return {
            "nebius_api_key": bool(cls.NEBIUS_API_KEY),
            "exa_api_key": bool(cls.EXA_API_KEY),
            "weaviate_url": bool(cls.WEAVIATE_URL),
            "weaviate_api_key": bool(cls.WEAVIATE_API_KEY)
        }
