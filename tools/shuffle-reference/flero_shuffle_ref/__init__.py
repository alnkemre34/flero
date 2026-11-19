"""Independent exact reference for the FLERO Shuffle V5.2 allocator (Appendix A §2–§3, §9).

Deliberately written in Python with exact rational arithmetic, separately from the
TypeScript implementation (`packages/shuffle-core`), so that the two can be cross-checked.
It is a release-gate tool (doc 18 §2), never used in production serving.
"""
from .core import (
    ALLOWED_BATCH_SIZES,
    quota,
    seat_alloc,
    allocate_priority,
    inclusion_probability_enum,
    inclusion_probability_closed,
    mode_for,
)

__all__ = [
    "ALLOWED_BATCH_SIZES",
    "quota",
    "seat_alloc",
    "allocate_priority",
    "inclusion_probability_enum",
    "inclusion_probability_closed",
    "mode_for",
]
