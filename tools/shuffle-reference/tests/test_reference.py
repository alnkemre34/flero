"""Fast CI subset of the reference gates (the exhaustive run is verify.py)."""
import unittest
from fractions import Fraction

from flero_shuffle_ref import (
    ALLOWED_BATCH_SIZES, quota, seat_alloc, allocate_priority,
    inclusion_probability_enum, inclusion_probability_closed, mode_for,
)

TABLE = {10: (3, 7, 3), 15: (5, 11, 4), 20: (6, 14, 6), 25: (8, 18, 7), 35: (11, 25, 10), 50: (15, 35, 15)}


class QuotaTests(unittest.TestCase):
    def test_spec_tables(self):  # SHF-T10, T11
        for n in ALLOWED_BATCH_SIZES:
            self.assertEqual((quota(n, 3000), quota(n, 7000), n - quota(n, 7000)), TABLE[n])

    def test_small_batch_rounding(self):  # SHF-T40
        self.assertEqual(quota(2, 7000), 1)

    def test_domain(self):
        with self.assertRaises(ValueError):
            quota(-1, 3000)
        with self.assertRaises(ValueError):
            quota(10, 10001)


class AllocatorTests(unittest.TestCase):
    def test_worked_example_a(self):  # A§3.6 Example A
        self.assertEqual(seat_alloc(20, 7000, 100, 100), (14, 6))
        self.assertEqual(allocate_priority(20, 3000, 7000, 14, 6, 50, 50), (4, 2))

    def test_worked_example_b(self):  # Example B: 1 local Boost, many remote
        self.assertEqual(allocate_priority(20, 3000, 7000, 14, 6, 1, 50), (1, 5))

    def test_local_scarcity_example_g(self):  # Example G
        self.assertEqual(seat_alloc(20, 7000, 4, 100), (4, 16))

    def test_q_zero_and_q_n(self):  # SHF-T61
        self.assertEqual(allocate_priority(10, 0, 7000, 7, 3, 7, 3), (0, 0))
        self.assertEqual(sum(allocate_priority(10, 10000, 7000, 7, 3, 7, 3)), 10)

    def test_priority_never_exceeds_q_and_fills_when_supply(self):  # SHF-T47, T92
        for n in ALLOWED_BATCH_SIZES:
            for pb in (500, 3000, 4000):
                for lb in (5000, 7000, 9000):
                    for al in range(0, 13):
                        for ar in range(0, 13):
                            if al + ar < n:
                                continue
                            nl, nr = seat_alloc(n, lb, al, ar)
                            for bl in range(al + 1):
                                for br in range(ar + 1):
                                    ql, qr = allocate_priority(n, pb, lb, nl, nr, bl, br)
                                    q = quota(n, pb)
                                    self.assertLessEqual(ql + qr, q)
                                    self.assertEqual(ql + qr, min(q, min(nl, bl) + min(nr, br)))


class NonHarmTests(unittest.TestCase):
    def test_closed_form_matches_enum(self):
        for a in range(1, 7):
            for n in range(0, a + 1):
                for q in range(0, n + 1):
                    for b in range(q, a + 1):
                        if b >= 1:
                            self.assertEqual(inclusion_probability_enum(a, n, q, b, True),
                                             inclusion_probability_closed(a, n, q, b, True))
                        if b <= a - 1:
                            self.assertEqual(inclusion_probability_enum(a, n, q, b, False),
                                             inclusion_probability_closed(a, n, q, b, False))

    def test_own_toggle_non_harm_district(self):  # SHF-T25, T41 (CI subset: A <= 6)
        for n in (2, 3, 5, 10):
            for pb in (500, 3000, 4000):
                for lb in (5000, 7000, 9000):
                    for al in range(0, 7):
                        for ar in range(0, 7):
                            if al + ar < n:
                                continue
                            nl, nr = seat_alloc(n, lb, al, ar)
                            for bl in range(al + 1):
                                for br in range(ar + 1):
                                    q_before = allocate_priority(n, pb, lb, nl, nr, bl, br)
                                    for s, (a_s, n_s, b_s) in enumerate(((al, nl, bl), (ar, nr, br))):
                                        if b_s > a_s - 1:
                                            continue
                                        after_b = (bl + 1, br) if s == 0 else (bl, br + 1)
                                        q_after = allocate_priority(n, pb, lb, nl, nr, *after_b)
                                        p0 = inclusion_probability_enum(a_s, n_s, q_before[s], b_s, False)
                                        p1 = inclusion_probability_enum(a_s, n_s, q_after[s], b_s + 1, True)
                                        self.assertGreaterEqual(p1, p0, (n, pb, lb, al, ar, bl, br, s))


class ModeTests(unittest.TestCase):
    def test_boundary(self):  # SHF-T47, T70, T85
        for n in ALLOWED_BATCH_SIZES:
            for a in range(0, 51):
                self.assertEqual(mode_for(a, n), "SPARSE_COMPLETE" if a < n else "NORMAL")

    def test_a_equals_n_everyone_included(self):  # SHF-T70
        nl, nr = seat_alloc(10, 7000, 7, 3)
        ql, qr = allocate_priority(10, 3000, 7000, nl, nr, 2, 3)
        self.assertEqual(inclusion_probability_enum(7, nl, ql, 2, False), Fraction(1))


if __name__ == "__main__":
    unittest.main()
