"""BOOST_NON_HARM under the UNCERTAIN_PARTIAL fallback (doc 11 §3.7, review H1)."""
import unittest

from flero_shuffle_ref import quota
from flero_shuffle_ref.fallback import inclusion_with_fallback

BPS = (500, 3000, 4000)


def own_toggle_cases(max_a: int):
    """(a, n, m, b, q_before, q_after, bps) for a single stratum with q = min(Q, B, n)."""
    for n in range(1, 11):
        for bps in BPS:
            big_q = quota(n, bps)
            for a in range(n, max_a + 1):
                for b in range(0, a):                 # target unboosted with b other Boost holders
                    q0 = min(big_q, b, n)
                    q1 = min(big_q, b + 1, n)
                    for m in range(0, n - q1 + 1):    # same budget truncation in both worlds
                        yield a, n, m, b, q0, q1, bps


class FallbackNonHarmTests(unittest.TestCase):
    def test_demote_policy_is_non_harming(self):
        checked = 0
        for a, n, m, b, q0, q1, bps in own_toggle_cases(max_a=7):
            p0 = inclusion_with_fallback(a, q0, m, b, False, bps, "demote")
            p1 = inclusion_with_fallback(a, q1, m, b + 1, True, bps, "demote")
            self.assertGreaterEqual(p1, p0, (a, n, m, b, q0, q1, bps))
            checked += 1
        self.assertGreater(checked, 1000)

    def test_demote_policy_non_harm_with_priority_stage_truncation(self):
        """Budget can also run out inside the priority stage: only kp <= q priority draws complete.
        kp is a property of the request budget, independent of the target's own toggle; the realised
        priority count is min(q, kp) in both worlds (re-review H1 caveat)."""
        checked = 0
        for a, n, m, b, q0, q1, bps in own_toggle_cases(max_a=6):
            for kp in range(0, q1 + 1):
                r0, r1 = min(q0, kp), min(q1, kp)
                p0 = inclusion_with_fallback(a, r0, m, b, False, bps, "demote")
                p1 = inclusion_with_fallback(a, r1, m, b + 1, True, bps, "demote")
                self.assertGreaterEqual(p1, p0, (a, n, m, b, q0, q1, kp, bps))
                checked += 1
        self.assertGreater(checked, 1000)

    def test_drop_policy_has_a_counterexample(self):
        """Documents why H1 was real: dropping excess priority cards can harm the Boost buyer."""
        found = None
        for a, n, m, b, q0, q1, bps in own_toggle_cases(max_a=7):
            p0 = inclusion_with_fallback(a, q0, m, b, False, bps, "drop")
            p1 = inclusion_with_fallback(a, q1, m, b + 1, True, bps, "drop")
            if p1 < p0:
                found = (a, n, m, b, q0, q1, bps, p0, p1)
                break
        self.assertIsNotNone(found, "expected the rejected 'drop' policy to violate non-harm somewhere")


if __name__ == "__main__":
    unittest.main()
