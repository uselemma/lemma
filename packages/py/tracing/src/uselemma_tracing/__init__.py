from .client import Lemma, SpanHandle, TraceContext
from .experiment_mode import (
    disable_experiment_mode,
    enable_experiment_mode,
    is_experiment_mode_enabled,
)
from .debug_mode import (
    disable_debug_mode,
    enable_debug_mode,
    is_debug_mode_enabled,
    is_debug_verify_enabled,
)
from .openai_agents import (
    LemmaOpenAIAgentsProcessor,
    instrument_openai_agents,
    openai_agents,
)
from .langchain import LemmaLangChainCallbackHandler, langchain, langgraph

__all__ = [
    "Lemma",
    "SpanHandle",
    "TraceContext",
    # Mode flags
    "enable_experiment_mode",
    "disable_experiment_mode",
    "is_experiment_mode_enabled",
    "enable_debug_mode",
    "disable_debug_mode",
    "is_debug_mode_enabled",
    "is_debug_verify_enabled",
    "LemmaOpenAIAgentsProcessor",
    "openai_agents",
    "instrument_openai_agents",
    "LemmaLangChainCallbackHandler",
    "langchain",
    "langgraph",
]
