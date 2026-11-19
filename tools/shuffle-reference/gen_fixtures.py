"""Generate the allocator cross-check fixture consumed by packages/shuffle-core tests.

Usage: python -I tools/shuffle-reference/gen_fixtures.py <out.json>
Each row: [N, priority_bps, local_bps, A_L, A_R, B_L, B_R, n_L, n_R, q_L, q_R]
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flero_shuffle_ref import ALLOWED_BATCH_SIZES, seat_alloc, allocate_priority  # noqa: E402

CAPACITIES = (0, 1, 2, 3, 4, 5, 7, 10, 14, 20, 30, 50, 80)
PRIORITY_BPS = (500, 1000, 3000, 4000)
LOCAL_BPS = (5000, 7000, 9000)


def boost_counts(a: int) -> list[int]:
    return sorted({0, 1, 2, a // 2, max(a - 1, 0), a} & set(range(a + 1)))


def rows():
    for n in ALLOWED_BATCH_SIZES:
        for pb in PRIORITY_BPS:
            for lb in LOCAL_BPS:
                for al in CAPACITIES:
                    for ar in CAPACITIES:
                        if al + ar < n:
                            continue
                        nl, nr = seat_alloc(n, lb, al, ar)
                        for bl in boost_counts(al):
                            for br in boost_counts(ar):
                                ql, qr = allocate_priority(n, pb, lb, nl, nr, bl, br)
                                yield [n, pb, lb, al, ar, bl, br, nl, nr, ql, qr]


def main(out_path: str) -> None:
    data = list(rows())
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"generator": "tools/shuffle-reference/gen_fixtures.py",
                   "columns": ["N", "priority_bps", "local_bps", "A_L", "A_R", "B_L", "B_R",
                               "n_L", "n_R", "q_L", "q_R"],
                   "rows": data}, f, separators=(",", ":"))
    print(f"wrote {len(data)} rows to {out_path}")


if __name__ == "__main__":
    main(sys.argv[1])
