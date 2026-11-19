"""Core reference functions. Stdlib only; exact arithmetic via fractions.Fraction."""
from fractions import Fraction
from functools import lru_cache
from itertools import combinations

ALLOWED_BATCH_SIZES = (10, 15, 20, 25, 35, 50)  # Appendix A §2


def quota(n: int, bps: int) -> int:
    """Half-up integer quota (Appendix A §2). Never use round()."""
    if n < 0 or not 0 <= bps <= 10000:
        raise ValueError(f"quota domain: n={n} bps={bps}")
    return (n * bps + 5000) // 10000


def seat_alloc(n: int, local_bps: int, a_local: int, a_remote: int) -> tuple[int, int]:
    """Fix LOCAL/REMOTE seat totals from eligible capacities only (Appendix A §3.2).

    Shortfall in one stratum flows to the other. Requires a_local + a_remote >= n
    (NORMAL mode); both strata short is impossible under that precondition.
    Boost status is never an input.
    """
    if a_local + a_remote < n:
        raise ValueError("seat_alloc is NORMAL-only: A_total must be >= N")
    n_l0 = quota(n, local_bps)
    n_r0 = n - n_l0
    if a_local < n_l0:
        n_l, n_r = a_local, n - a_local
    elif a_remote < n_r0:
        n_l, n_r = n - a_remote, a_remote
    else:
        n_l, n_r = n_l0, n_r0
    assert n_l + n_r == n and 0 <= n_l <= a_local and 0 <= n_r <= a_remote
    return n_l, n_r


def allocate_priority(n: int, priority_bps: int, local_bps: int,
                      n_l: int, n_r: int, b_l: int, b_r: int) -> tuple[int, int]:
    """Appendix A §3.3 two-stratum reference allocation, verbatim.

    Returns (q_L, q_R): reserved BOOST_BLOCK seats per stratum.
    Raises AssertionError if any spec assertion fails.
    """
    q = quota(n, priority_bps)
    base_l = min(n_l, quota(q, local_bps))
    base_r = min(n_r, q - base_l)
    unassigned = q - base_l - base_r
    add_l = min(unassigned, n_l - base_l)
    base_l += add_l
    unassigned -= add_l
    add_r = min(unassigned, n_r - base_r)
    base_r += add_r
    unassigned -= add_r
    assert unassigned == 0, "Q <= n_L + n_R violated"

    q_l = min(base_l, b_l)
    q_r = min(base_r, b_r)
    missing = q - q_l - q_r
    add_l = min(missing, min(n_l, b_l) - q_l)
    q_l += add_l
    missing -= add_l
    add_r = min(missing, min(n_r, b_r) - q_r)
    q_r += add_r
    missing -= add_r
    assert 0 <= q_l <= min(n_l, b_l)
    assert 0 <= q_r <= min(n_r, b_r)
    assert q_l + q_r <= q
    return q_l, q_r


def mode_for(a_total: int, n: int) -> str:
    """SPARSE_COMPLETE iff the (proven) eligible population is smaller than N (§3.1.1)."""
    return "SPARSE_COMPLETE" if a_total < n else "NORMAL"


@lru_cache(maxsize=None)
def inclusion_probability_enum(a: int, n: int, q: int, b: int, target_boosted: bool) -> Fraction:
    """Exact inclusion probability of a target in one stratum by subset enumeration.

    Stage 1: uniformly choose q of the b qualifying Boost holders (BOOST_BLOCK).
    Stage 2: uniformly choose n-q of ALL remaining stratum members (DISCOVERY).
    Target is account 0. Independent of the closed form on purpose.
    """
    if not (0 <= q <= min(n, b) and n <= a and b <= a):
        raise ValueError((a, n, q, b))
    if target_boosted:
        if b < 1:
            raise ValueError("boosted target needs b >= 1")
        boost = tuple(range(0, b))
    else:
        if b > a - 1:
            raise ValueError("unboosted target needs b <= a-1")
        boost = tuple(range(1, b + 1))
    total = hit = 0
    for pset in combinations(boost, q):
        chosen = set(pset)
        rest = [x for x in range(a) if x not in chosen]
        for disc in combinations(rest, n - q):
            total += 1
            if 0 in chosen or 0 in disc:
                hit += 1
    return Fraction(hit, total)


def inclusion_probability_closed(a: int, n: int, q: int, b: int, target_boosted: bool) -> Fraction:
    """Appendix A §3.5 closed form (sanity cross-check only). At b <= q every Boost holder is chosen."""
    if target_boosted:
        if b <= q or a <= q:
            return Fraction(1)
        return Fraction(q, b) + (1 - Fraction(q, b)) * Fraction(n - q, a - q)
    if a == q:
        return Fraction(0)
    return Fraction(n - q, a - q)
