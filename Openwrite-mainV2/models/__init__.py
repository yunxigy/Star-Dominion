"""OpenWrite 数据模型包

为 opencode_skill/tools/ 提供统一的 Pydantic 数据模型。
"""

from .chapter_run import ChapterRunManifest, ChapterRunStage
from .character import CharacterCard, CharacterProfile, CharacterTier
from .context_package import ForeshadowingState, GenerationContext, WorldRules
from .foreshadowing import ForeshadowingEdge, ForeshadowingGraph, ForeshadowingNode
from .outline import OutlineHierarchy, OutlineNode, OutlineNodeType
from .runtime_state import RuntimeDeltaOperation, RuntimeState, RuntimeStateDelta
from .style import LanguageStyle, RhythmStyle, StyleProfile, VoicePattern

__all__ = [
    "OutlineNode", "OutlineNodeType", "OutlineHierarchy",
    "CharacterCard", "CharacterProfile", "CharacterTier",
    "StyleProfile", "VoicePattern", "LanguageStyle", "RhythmStyle",
    "GenerationContext", "ForeshadowingState", "WorldRules",
    "ForeshadowingNode", "ForeshadowingEdge", "ForeshadowingGraph",
    "RuntimeState", "RuntimeStateDelta", "RuntimeDeltaOperation",
    "ChapterRunManifest", "ChapterRunStage",
]
