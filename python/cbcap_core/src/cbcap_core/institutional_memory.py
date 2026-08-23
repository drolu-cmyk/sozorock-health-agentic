"""Compatibility exports for the canonical CB-CAP decision-memory contract.

`decision_memory.py` is the single source of truth. This module remains only so
older internal imports do not create a second model definition or break while
service code migrates to the canonical name.
"""

from .decision_memory import (
    DecisionMemoryProposal,
    DecisionMemoryQuery,
    DecisionMemoryRecord,
    DecisionMemoryWriteRequest,
    MemoryActorRole,
    MemoryApplicability,
    MemoryDecisionType,
    MemoryOutcome,
    MemoryStatus,
    ProposalOutcome,
    build_decision_memory,
    query_decision_memory,
    supersede_decision_memory,
)

__all__ = [
    "DecisionMemoryProposal",
    "DecisionMemoryQuery",
    "DecisionMemoryRecord",
    "DecisionMemoryWriteRequest",
    "MemoryActorRole",
    "MemoryApplicability",
    "MemoryDecisionType",
    "MemoryOutcome",
    "MemoryStatus",
    "ProposalOutcome",
    "build_decision_memory",
    "query_decision_memory",
    "supersede_decision_memory",
]
