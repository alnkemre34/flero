"""FLERO Shuffle V5.2 invariant verifier (planning spike). stdlib only, exact Fractions."""
from fractions import Fraction
from itertools import combinations
from functools import lru_cache
import sys

ALLOW = (10, 15, 20, 25, 35, 50)
RESULTS = {}


def rec(name, ok, detail=""):
    RESULTS[name] = (ok, detail)
    print(("PASS " if ok else "FAIL ") + name + (" :: " + detail if detail else ""))


def quota(n, bps):
    assert n >= 0 and 0 <= bps <= 10000
    return (n * bps + 5000) // 10000


# ---------- 1. quota tables ----------
TAB = {10: (3, 7, 3), 15: (5, 11, 4), 20: (6, 14, 6), 25: (8, 18, 7), 35: (11, 25, 10), 50: (15, 35, 15)}
ok = all((quota(N, 3000), quota(N, 7000), N - quota(N, 7000)) == TAB[N] for N in ALLOW)
rec("1 quota tables (spec s2)", ok)
assert quota(2, 7000) == 1  # case 40: Q=2 -> 1 local


# ---------- 2. seat allocation + allocator ----------
def seat_alloc(N, local_bps, A_L, A_R):
    assert A_L + A_R >= N
    n_L0 = quota(N, local_bps)
    n_R0 = N - n_L0
    if A_L < n_L0 and A_R < n_R0:
        raise AssertionError("both short with A_total>=N")  # impossible
    n_L, n_R = n_L0, n_R0
    if A_L < n_L0:
        n_L = A_L
        n_R = N - A_L  # shortfall flows to REMOTE
    elif A_R < n_R0:
        n_R = A_R
        n_L = N - A_R  # shortfall flows to LOCAL
    assert n_L + n_R == N and 0 <= n_L <= A_L and 0 <= n_R <= A_R, (N, A_L, A_R, n_L, n_R)
    return n_L, n_R


def allocator(N, prio_bps, local_bps, n_L, n_R, B_L, B_R, flags=None):
    """s3.3 verbatim."""
    Q = quota(N, prio_bps)
    base_L = min(n_L, quota(Q, local_bps))
    base_R = min(n_R, Q - base_L)
    unassigned = Q - base_L - base_R
    add_L = min(unassigned, n_L - base_L)
    base_L += add_L
    unassigned -= add_L
    add_R = min(unassigned, n_R - base_R)
    base_R += add_R
    unassigned -= add_R
    assert unassigned == 0
    q_L = min(base_L, B_L)
    q_R = min(base_R, B_R)
    missing = Q - q_L - q_R
    if flags is not None:
        sL = min(n_L, B_L) - q_L
        sR = min(n_R, B_R) - q_R
        if missing > 0 and sL > 0 and sR > 0:
            flags["dual"] = flags.get("dual", 0) + 1
    add_L = min(missing, min(n_L, B_L) - q_L)
    q_L += add_L
    missing -= add_L
    add_R = min(missing, min(n_R, B_R) - q_R)
    q_R += add_R
    missing -= add_R
    assert 0 <= q_L <= min(n_L, B_L)
    assert 0 <= q_R <= min(n_R, B_R)
    assert q_L + q_R <= Q
    return q_L, q_R


PRIO = (500, 1000, 3000, 4000)
LOC = (5000, 7000, 9000)
cnt = 0
dual = {}
nondet = 0
notfull = 0
extra = []
for N in ALLOW:
    for pb in PRIO:
        for lb in LOC:
            for AL in range(13):
                for AR in range(13):
                    if AL + AR < N:
                        continue
                    nL, nR = seat_alloc(N, lb, AL, AR)
                    for BL in range(AL + 1):
                        for BR in range(AR + 1):
                            r1 = allocator(N, pb, lb, nL, nR, BL, BR, dual)
                            r2 = allocator(N, pb, lb, nL, nR, BL, BR)
                            cnt += 1
                            if r1 != r2:
                                nondet += 1
                            Q = quota(N, pb)
                            if sum(r1) != min(Q, min(nL, BL) + min(nR, BR)):
                                notfull += 1
                                if len(extra) < 3:
                                    extra.append((N, pb, lb, AL, AR, BL, BR, r1))
rec("2a allocator: determinism+asserts, allowlist N, A 0..12", nondet == 0, f"{cnt} cases")
rec("2b dual-surplus branch unreachable", not dual, f"dual={dual.get('dual', 0)}")
rec("2c q_L+q_R == min(Q, min(nL,BL)+min(nR,BR)) (no avoidable unfilled priority seat)", notfull == 0,
    f"violations={notfull} ex={extra}")

# math boundaries Q=0, Q=N for small N (outside admin bounds)
cb = 0
dual2 = {}
for N in range(1, 11):
    for pb in (0, 10000):
        for lb in (0, 5000, 7000, 9000, 10000):
            for AL in range(9):
                for AR in range(9):
                    if AL + AR < N:
                        continue
                    nL, nR = seat_alloc(N, lb, AL, AR)
                    for BL in range(AL + 1):
                        for BR in range(AR + 1):
                            q = allocator(N, pb, lb, nL, nR, BL, BR, dual2)
                            cb += 1
                            if pb == 0:
                                assert q == (0, 0)
                            else:
                                assert sum(q) == min(N, min(nL, BL) + min(nR, BR))
rec("2d Q=0 / Q=N math boundaries incl. local 0/10000, N=1..10", not dual2, f"{cb} cases, dual={dual2.get('dual', 0)}")


# ---------- 3. brute-force enumeration ----------
@lru_cache(maxsize=None)
def P_enum(A, n, q, B, target_boosted):
    """Exact inclusion prob of target (index 0) by enumerating subsets of the two-stage process."""
    assert 0 <= q <= min(n, B) and n <= A and B <= A
    if target_boosted:
        assert B >= 1
        boost = tuple(range(0, B))
    else:
        assert B <= A - 1
        boost = tuple(range(1, B + 1))
    tot = hit = 0
    for Pset in combinations(boost, q):
        ps = set(Pset)
        rest = [x for x in range(A) if x not in ps]
        for D in combinations(rest, n - q):
            tot += 1
            if 0 in ps or 0 in D:
                hit += 1
    return Fraction(hit, tot)


def closed(A, n, q, B, tb):
    if tb:
        if B <= q or A <= q:
            return Fraction(1)
        return Fraction(q, B) + (1 - Fraction(q, B)) * Fraction(n - q, A - q)
    return Fraction(n - q, A - q)


# identity-symmetry check: any boost-set identity gives the same probability as the label-fixed one
def check_all_sets(A, n, q, B, tb):
    for S in combinations(range(A), B):
        if (0 in S) != tb:
            continue
        t = h = 0
        for Pset in combinations(S, q):
            ps = set(Pset)
            rest = [x for x in range(A) if x not in ps]
            for D in combinations(rest, n - q):
                t += 1
                h += (0 in ps or 0 in D)
        assert Fraction(h, t) == P_enum(A, n, q, B, tb)


for A in range(1, 6):
    for n in range(0, A + 1):
        for q in range(0, n + 1):
            for B in range(q, A + 1):
                for tb in (True, False):
                    if (tb and B >= 1) or (not tb and B <= A - 1):
                        check_all_sets(A, n, q, B, tb)
rec("3a identity-symmetry of enumeration (A<=5, all boost-set identities)", True)

NRANGE = range(2, 11)
PR = (0, 500, 1000, 3000, 4000, 10000)
viol = []
ntog = 0
cf_mism = 0
nch = 0
other = {'n': 0, 'dec': 0, 'ex': None, 'mind': Fraction(0)}
same = {'n': 0, 'dec': 0, 'ex': None, 'mind': Fraction(0)}
ncfg = 0
for N in NRANGE:
    for pb in PR:
        for lb in LOC:
            for AL in range(9):
                for AR in range(9):
                    if AL + AR < N:
                        continue
                    ncfg += 1
                    nL, nR = seat_alloc(N, lb, AL, AR)
                    for BL in range(AL + 1):
                        for BR in range(AR + 1):
                            qL, qR = allocator(N, pb, lb, nL, nR, BL, BR)
                            for st in ('L', 'R'):
                                A_s, n_s, q_b, B_s = (AL, nL, qL, BL) if st == 'L' else (AR, nR, qR, BR)
                                A_o, B_o = (AR, BR) if st == 'L' else (AL, BL)
                                # closed-form sanity
                                for tb in (True, False):
                                    if (tb and B_s >= 1) or (not tb and B_s <= A_s - 1):
                                        if P_enum(A_s, n_s, q_b, B_s, tb) != closed(A_s, n_s, q_b, B_s, tb):
                                            cf_mism += 1
                                # (4) own toggle: target unboosted -> boosted
                                if B_s <= A_s - 1:
                                    bL2, bR2 = (BL + 1, BR) if st == 'L' else (BL, BR + 1)
                                    qL2, qR2 = allocator(N, pb, lb, nL, nR, bL2, bR2)
                                    q_a = qL2 if st == 'L' else qR2
                                    assert q_a >= q_b  # own q nondecreasing
                                    p0 = P_enum(A_s, n_s, q_b, B_s, False)
                                    p1 = P_enum(A_s, n_s, q_a, B_s + 1, True)
                                    ntog += 1
                                    if q_a != q_b:
                                        nch += 1
                                    if p1 < p0:
                                        viol.append((N, pb, lb, AL, AR, BL, BR, st, (nL, nR), (qL, qR), (qL2, qR2), p0, p1))
                                # (4b) non-target toggles, target boosted or not
                                for tb in (True, False):
                                    if tb and B_s < 1:
                                        continue
                                    if (not tb) and B_s > A_s - 1:
                                        continue
                                    p_b = P_enum(A_s, n_s, q_b, B_s, tb)
                                    if B_o < A_o:  # a non-target in the OTHER stratum gets boosted
                                        bL2, bR2 = (BL, BR + 1) if st == 'L' else (BL + 1, BR)
                                        q2 = allocator(N, pb, lb, nL, nR, bL2, bR2)
                                        q_a = q2[0] if st == 'L' else q2[1]
                                        p_a = P_enum(A_s, n_s, q_a, B_s, tb)
                                        other['n'] += 1
                                        if p_a < p_b:
                                            other['dec'] += 1
                                            if other['ex'] is None or p_a - p_b < other['mind']:
                                                other['mind'] = p_a - p_b
                                                other['ex'] = (N, pb, lb, AL, AR, BL, BR, st, tb, str(p_b), str(p_a))
                                    nb_others = B_s - (1 if tb else 0)
                                    if nb_others < A_s - 1:  # a non-target in the SAME stratum gets boosted
                                        bL2, bR2 = (BL + 1, BR) if st == 'L' else (BL, BR + 1)
                                        q2 = allocator(N, pb, lb, nL, nR, bL2, bR2)
                                        q_a = q2[0] if st == 'L' else q2[1]
                                        p_a = P_enum(A_s, n_s, q_a, B_s + 1, tb)
                                        same['n'] += 1
                                        if p_a < p_b:
                                            same['dec'] += 1
                                            if same['ex'] is None or p_a - p_b < same['mind']:
                                                same['mind'] = p_a - p_b
                                                same['ex'] = (N, pb, lb, AL, AR, BL, BR, st, tb, str(p_b), str(p_a))
viol.sort(key=lambda v: (v[3] + v[4], v[0]))
rec("3/4 BOOST_NON_HARM (own toggle, LOCAL & REMOTE, exact enumeration)", not viol,
    f"{ncfg} (N,ratio,A_L,A_R) configs, {ntog} toggles ({nch} with q change), violations={len(viol)}")
for v in viol[:5]:
    print("   COUNTEREXAMPLE (N,pbps,lbps,A_L,A_R,B_L,B_R,stratum,(nL,nR),q_before,q_after,p0,p1):", v)
rec("3c closed-form s3.5 agrees with enumeration (sanity only)", cf_mism == 0, f"mismatches={cf_mism}")
print(f"INFO other-stratum non-target boost: {other['n']} cases, target prob DECREASED in {other['dec']}; worst={other['ex']} delta={other['mind']}")
print(f"INFO same-stratum non-target boost: {same['n']} cases, target prob DECREASED in {same['dec']}; worst={same['ex']} delta={same['mind']}")

# A_total == N => everyone included (p=1) in NORMAL
bad = 0
c = 0
for N in NRANGE:
    for AL in range(9):
        AR = N - AL
        if not (0 <= AR <= 8):
            continue
        for pb in PR:
            for lb in LOC:
                nL, nR = seat_alloc(N, lb, AL, AR)
                for BL in range(AL + 1):
                    for BR in range(AR + 1):
                        qL, qR = allocator(N, pb, lb, nL, nR, BL, BR)
                        for A, n, q, B in ((AL, nL, qL, BL), (AR, nR, qR, BR)):
                            for tb in (True, False):
                                if A and ((tb and B >= 1) or (not tb and B <= A - 1)):
                                    c += 1
                                    if P_enum(A, n, q, B, tb) != 1:
                                        bad += 1
rec("6b A_total==N in NORMAL: every target p=1 (enumeration)", bad == 0, f"{c} targets")

# ---------- 5. City mode ----------
cv = []
cc = 0
for N in NRANGE:
    for pb in PR:
        for A in range(N, 13):
            Q = quota(N, pb)
            for B in range(A):  # target unboosted, B other boosts
                q0 = min(Q, B, N)
                q1 = min(Q, B + 1, N)
                p0 = P_enum(A, N, q0, B, False)
                p1 = P_enum(A, N, q1, B + 1, True)
                cc += 1
                if p1 < p0:
                    cv.append((N, pb, A, B, p0, p1))
rec("5 CITY mode non-harm (q=min(Q,B,n))", not cv, f"{cc} toggles; first violation={cv[:1]}")


# ---------- 6. SPARSE_COMPLETE ----------
def mode(A_total, N):
    return "SPARSE_COMPLETE" if A_total < N else "NORMAL"


def sparse_cards(cards):
    pr = [c for c in cards if c[1]]
    pl = [c for c in cards if not c[1] and c[2]]
    st = [c for c in cards if not c[1] and not c[2]]
    return pr + pl + st


okS = True
cs = 0
for N in ALLOW:
    for A in range(0, 51):
        assert mode(A, N) == ("SPARSE_COMPLETE" if A < N else "NORMAL")
        if A < N:
            cards = [(i, i % 3 == 0, i % 3 == 1) for i in range(A)]
            out = sparse_cards(cards)
            cs += 1
            if sorted(c[0] for c in out) != list(range(A)):
                okS = False
            g = [0 if c[1] else (1 if c[2] else 2) for c in out]
            if g != sorted(g):
                okS = False
rec("6a SPARSE_COMPLETE: all included once, Boost->Plus->Standard, A_total<N for all N", okS, f"{cs} cases")

# case 47: NORMAL priority seats <= Q across 500..4000 bps step 100
v47 = 0
c47 = 0
for N in ALLOW:
    for pb in range(500, 4001, 100):
        Q = quota(N, pb)
        for lb in LOC:
            for At in range(N, 51):
                for AL in range(0, At + 1):
                    AR = At - AL
                    nL, nR = seat_alloc(N, lb, AL, AR)
                    for BL in (0, 1, AL // 2, AL):
                        for BR in (0, 1, AR // 2, AR):
                            q = allocator(N, pb, lb, nL, nR, min(BL, AL), min(BR, AR))
                            c47 += 1
                            if sum(q) > Q:
                                v47 += 1
rec("case47 NORMAL paid seats <= Q across 500..4000 bps (step 100)", v47 == 0, f"{c47} cases")

print("\nSUMMARY:", {k: v[0] for k, v in RESULTS.items()})
sys.exit(0 if all(v[0] for v in RESULTS.values()) else 1)
