# shuffle-reference

This is an independent exact reference for the Shuffle V5.2 allocator (Appendix A). It's written in Python with stdlib only and exact `Fraction` arithmetic. It's deliberately separate from `packages/shuffle-core` (TypeScript) so the two implementations can be cross-checked. This is a release-gate tool (docs/architecture/18 §2) and is never used in production.

| Command (repo root) | What |
|---|---|
| `pnpm test:reference` | fast CI subset: quota tables, worked examples, allocator bounds, own-toggle BOOST_NON_HARM by subset enumeration (A ≤ 6), mode boundary |
| `pnpm fixtures:shuffle` | writes the allocator cross-check fixture that the `shuffle-core` tests consume (generated, gitignored) |
| `python -I docs/architecture/evidence/shuffle_verify_spike.py` | the full exhaustive pre-architecture spike (A ≤ 8 enumeration, ~22 s). It's a third, independent implementation |
