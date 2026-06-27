from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

class BaseWrapper(ABC):
    """
    Abstract interface for all AI interactions.
    Ensures provider-agnostic execution by forcing wrappers (OpenAI, Anthropic, Local)
    to conform to these standard capabilities.
    """
    
    @abstractmethod
    async def plan(self, goal: str, context: Dict[str, Any]) -> Any:
        """Generate a structured execution plan."""
        raise NotImplementedError

    @abstractmethod
    async def generate(self, prompt: str, **kwargs) -> str:
        """Standard text generation."""
        raise NotImplementedError

    @abstractmethod
    async def reason(self, context: str, question: str) -> str:
        """Perform Chain-of-Thought or detailed reasoning."""
        raise NotImplementedError

    @abstractmethod
    async def vision(self, image_data: Any, prompt: str) -> Dict[str, Any]:
        """Analyze layout/design from visual evidence."""
        raise NotImplementedError

    @abstractmethod
    async def embed(self, text: str) -> List[float]:
        """Generate vector embeddings for RAG."""
        raise NotImplementedError

    @abstractmethod
    async def retrieve(self, query_embedding: List[float], top_k: int = 5) -> List[Any]:
        """Retrieve relevant context from the vector store."""
        raise NotImplementedError

    @abstractmethod
    async def summarize(self, text: str) -> str:
        """Condense large context buffers."""
        raise NotImplementedError

    @abstractmethod
    async def verify(self, code: str, rules: List[str]) -> Dict[str, Any]:
        """Self-reflection verification against deterministic rules."""
        raise NotImplementedError

    @abstractmethod
    async def patch(self, issue_description: str, dom_context: str) -> str:
        """Generate HTML/CSS code patches."""
        raise NotImplementedError

    @abstractmethod
    async def classify(self, text: str, categories: List[str]) -> str:
        """Classify severity or issue category."""
        raise NotImplementedError

    @abstractmethod
    async def rerank(self, query: str, documents: List[str]) -> List[str]:
        """Rerank retrieved evidence."""
        raise NotImplementedError


class LLMWrapper(BaseWrapper):
    """Placeholder for standard LLM inference."""
    pass

class VisionWrapper(BaseWrapper):
    """Placeholder for visual layout inference."""
    pass

class EmbeddingWrapper(BaseWrapper):
    """Placeholder for vector embeddings."""
    pass
