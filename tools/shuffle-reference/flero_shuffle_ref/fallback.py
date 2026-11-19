"""UNCERTAIN_PARTIAL fallback model (doc 11 §3.7, review finding H1).

Model (one stratum, e.g. CITY or a single district stratum):
  * the priority stage completes with q seats (q from the allocator),
  * the discovery stage is truncated by the sampling budget to m <= n - q seats, where the
    truncation point m does NOT depend on who is boosted (budget exhaustion is a property of the
    pool/rejection rate, not of the target's Boost toggle),
  * k = q + m cards are returned and at most cap = quota(k, bps) may stay BOOST_BLOCK.

Policies for the q - cap excess priority cards:
  * "demote": relabel as DISCOVERY (adopted design) — inclusion is unaffected.
  * "drop":   remove from the response (rejected design) — inclusion can fall.

All probabilities are computed by explicit subset enumeration with exact Fractions.
"""
from fractions import Fraction
from functools import lru_cache
from itertools import combinations

from .core import quota


@lru_cache(maxsize=None)
def inclusion_with_fallback(a: int, q: int, m: int, b: int, target_boosted: bool,
                            bps: int, policy: str) -> Fraction:
    if policy not in ("demote", "drop"):
        raise ValueError(policy)
    if not (0 <= q <= b <= a and 0 <= m <= a - q):
        raise ValueError((a, q, m, b))
    if target_boosted:
        if b < 1:
            raise ValueError("boosted target needs b >= 1")
        boost = tuple(range(0, b))
    else:
        if b > a - 1:
            raise ValueError("unboosted target needs b <= a-1")
        boost = tuple(range(1, b + 1))
    cap = quota(q + m, bps)
    excess = max(0, q - cap)
    total = Fraction(0)
    outcomes = 0
    for pset in combinations(boost, q):
        chosen = set(pset)
        rest = [x for x in range(a) if x not in chosen]
        for disc in combinations(rest, m):
            outcomes += 1
            if 0 in disc:
                total += 1
            elif 0 in chosen:
                if policy == "demote" or excess == 0:
                    total += 1
                else:
                    # uniformly drop `excess` of the q priority picks
                    drops = list(combinations(pset, excess))
                    kept = sum(1 for d in drops if 0 not in d)
                    total += Fraction(kept, len(drops))
    return total / outcomes
