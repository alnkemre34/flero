import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  apply,
  initialState,
  observeInbox,
  observeProfile,
  openThread,
  profileMessageAction,
  REJECT_COOLDOWN_DAYS,
  run,
  type Action,
  type ModelState,
  type UserId,
} from '../src/model.ts';

const USERS = ['B', 'X', 'Y', 'Z'] as const;
const user = fc.constantFrom(...USERS);
const pair = fc.tuple(user, user).filter(([a, b]) => a !== b);

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  pair.map(([from, to]) => ({ type: 'start', from, to }) as const),
  pair.map(([by, initiator]) => ({ type: 'accept', by, initiator }) as const),
  pair.map(([by, initiator]) => ({ type: 'reject', by, initiator }) as const),
  pair.map(([by, recipient]) => ({ type: 'reveal', by, recipient }) as const),
  pair.map(([from, to]) => ({ type: 'follow', from, to }) as const),
  pair.map(([from, to]) => ({ type: 'unfollow', from, to }) as const),
  pair.map(([by, target]) => ({ type: 'blockFull', by, target }) as const),
  pair.map(([by, target]) => ({ type: 'unblock', by, target }) as const),
  pair.map(([by, initiator]) => ({ type: 'shieldBlock', by, initiator }) as const),
  fc.integer({ min: 1, max: 40 }).map((days) => ({ type: 'advance', days }) as const),
);

describe('model invariants under random interleavings (doc 08 §10)', () => {
  it('≤1 open thread per ordered pair; reveal monotonic; terminal states never reopen; sealing only when both identified', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 60 }), (actions) => {
        let s = initialState();
        for (const a of actions) {
          const prev = s;
          s = apply(s, a);
          for (const [i, r] of USERS.flatMap((i) => USERS.map((r) => [i, r] as const))) {
            const open = s.threads.filter((t) => t.initiator === i && t.recipient === r && (t.state === 'REQUEST' || t.state === 'ACTIVE'));
            expect(open.length).toBeLessThanOrEqual(1);
          }
          for (const before of prev.threads) {
            const after = s.threads.find((t) => t.id === before.id)!;
            if (before.revealed) expect(after.revealed).toBe(true);
            if (['REJECTED', 'CLOSED', 'SEALED'].includes(before.state)) expect(after.state).toBe(before.state);
          }
          for (const t of s.threads.filter((t) => t.state === 'SEALED')) {
            const canonical = s.threads.find((c) => c.id === t.canonicalOf)!;
            expect(t.revealed && canonical.revealed).toBe(true);
            expect(canonical.initiator).toBe(t.recipient);
          }
        }
      }),
      { numRuns: 3_000 },
    );
  });
});

/**
 * Differential oracle suite (doc 10 §5, REQ-ANON-01): B's observable view of X must be identical
 * whether or not X holds a hidden anonymous thread to B — until an authorized reveal.
 */
describe('differential: hidden anonymous thread X→B is unobservable on X’s profile (O1, O2, O10)', () => {
  const noShield = actionArb.filter((a) => a.type !== 'shieldBlock');
  const xToBRevealed = (s: ModelState) => s.threads.some((t) => t.initiator === 'X' && t.recipient === 'B' && t.revealed);

  it('observeProfile(B, X) is equal in W0 (no thread) and W1 (hidden thread) until X is revealed to B', () => {
    fc.assert(
      fc.property(fc.array(noShield, { maxLength: 50 }), fc.array(noShield, { maxLength: 50 }), (prefix, suffix) => {
        let w0 = run(prefix);
        if (openThread(w0, 'X', 'B') || profileMessageAction(w0, 'X', 'B') !== 'START_NEW') return; // precondition
        let w1 = apply(w0, { type: 'start', from: 'X', to: 'B' });
        if (xToBRevealed(w1)) return; // already-mutual pairs reveal at creation (authorized)
        const strip = (o: ReturnType<typeof observeProfile>) => ({ ...o, knownThreads: o.knownThreads.map(({ id: _id, ...r }) => r) });
        expect(strip(observeProfile(w1, 'B', 'X'))).toEqual(strip(observeProfile(w0, 'B', 'X')));
        for (const a of suffix) {
          w0 = apply(w0, a);
          w1 = apply(w1, a);
          if (xToBRevealed(w0) || xToBRevealed(w1)) return; // authorized disclosure ends the comparison
          expect(strip(observeProfile(w1, 'B', 'X'))).toEqual(strip(observeProfile(w0, 'B', 'X')));
        }
      }),
      { numRuns: 3_000 },
    );
  });
});

/**
 * Review C2a: shielding an anonymous thread must not change B's view of X, whoever the hidden
 * initiator was (X or Y). Excludes later contact attempts by X/Y toward B, whose *failure* under
 * a shield is inherent to blocking (documented residual, doc 10 §3.1).
 */
describe('differential: shield block scope (DEC-02, review C2a, O21)', () => {
  const later = actionArb.filter(
    (a) => !(a.type === 'shieldBlock') &&
      !((a.type === 'follow' || a.type === 'start') && (a.from === 'X' || a.from === 'Y') && a.to === 'B'),
  );

  it('B’s view of X (incl. an identified B→X thread) is the same whether X or Y was shielded', () => {
    fc.assert(
      fc.property(fc.array(later, { maxLength: 40 }), (suffix) => {
        // Common setup: B has an identified thread with X (B initiated, so B knows X) that X can reply in.
        const setup: Action[] = [
          { type: 'start', from: 'B', to: 'X' },
          { type: 'accept', by: 'X', initiator: 'B' },
        ];
        let wX = run([...setup, { type: 'start', from: 'X', to: 'B' }, { type: 'shieldBlock', by: 'B', initiator: 'X' }]);
        let wY = run([...setup, { type: 'start', from: 'Y', to: 'B' }, { type: 'shieldBlock', by: 'B', initiator: 'Y' }]);
        const view = (s: ModelState) => observeProfile(s, 'B', 'X');
        expect(view(wX)).toEqual(view(wY));
        expect(view(wX).knownThreads[0]?.xCanSend).toBe(true); // X can still reply/gift in the identified thread
        for (const a of suffix) {
          wX = apply(wX, a);
          wY = apply(wY, a);
          const revealedToB = (s: ModelState, who: UserId) => s.threads.some((t) => t.initiator === who && t.recipient === 'B' && t.revealed);
          if (revealedToB(wX, 'X') || revealedToB(wY, 'Y') || revealedToB(wX, 'Y') || revealedToB(wY, 'X')) return;
          expect(view(wX)).toEqual(view(wY));
        }
      }),
      { numRuns: 3_000 },
    );
  });
});

/**
 * Re-review New-1 / DEC-02b (doc 10 §3.2): when B fully blocks profile X, B's INBOX view of a thread whose hidden
 * initiator is X must look exactly as if B had blocked someone unrelated (Y) — until the delay passes.
 */
describe('differential: delayed closure hides which profile owned the anonymous thread (O4, DEC-02b)', () => {
  const touchesHiddenThread = (a: Action) =>
    a.type === 'advance' ||
    (a.type === 'shieldBlock' && a.by === 'B') ||
    ((a.type === 'accept' || a.type === 'reject') && a.by === 'B' && a.initiator === 'X') ||
    ('from' in a && ((a.from === 'X' && a.to === 'B') || (a.from === 'B' && a.to === 'X'))) ||
    (a.type === 'reveal' && a.by === 'X') ||
    ((a.type === 'blockFull' || a.type === 'unblock') && (a.by === 'B' || a.target === 'B'));
  const later = actionArb.filter((a) => !touchesHiddenThread(a));

  it('observeInbox(B, T) is identical whether B blocked X (the hidden initiator) or Y, until the delay ends', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.array(later, { maxLength: 30 }), (accepted, suffix) => {
        const setup: Action[] = [
          { type: 'start', from: 'X', to: 'B' },
          ...(accepted ? [{ type: 'accept', by: 'B', initiator: 'X' } as const] : []),
        ];
        const base = run(setup);
        const t = openThread(base, 'X', 'B');
        if (!t || t.revealed) return;
        let w1 = apply(base, { type: 'blockFull', by: 'B', target: 'X' });
        let w2 = apply(base, { type: 'blockFull', by: 'B', target: 'Y' });
        expect(observeInbox(w1, 'B', t.id)).toEqual(observeInbox(w2, 'B', t.id));
        expect(observeInbox(w1, 'B', t.id)?.canSend).toBe(true);
        for (const a of suffix) {
          w1 = apply(w1, a);
          w2 = apply(w2, a);
          expect(observeInbox(w1, 'B', t.id)).toEqual(observeInbox(w2, 'B', t.id));
        }
        // X itself is cut off immediately (it already knows B blocked it).
        expect(observeInbox(w1, 'X', t.id)?.canSend).toBe(false);
        // After the delay the generic ending shows (accepted residual, doc 10 §3.2).
        expect(observeInbox(apply(w1, { type: 'advance', days: 1 }), 'B', t.id)?.state).toBe('CLOSED');
      }),
      { numRuns: 2_000 },
    );
  });
});

describe('scenarios (doc 08 §3)', () => {
  it('DEC-01: opposite-direction anonymous starts create two directional threads; neither CTA reveals the other', () => {
    const s = run([
      { type: 'start', from: 'X', to: 'B' },
      { type: 'start', from: 'B', to: 'X' },
    ]);
    expect(s.threads.filter((t) => t.state === 'REQUEST')).toHaveLength(2);
    expect(profileMessageAction(s, 'B', 'X')).toBe('OPEN_EXISTING'); // B's own thread to X, where B knows X
    expect(observeProfile(s, 'B', 'X').knownThreads).toHaveLength(1); // only B's own thread is known
  });

  it('mutual follow reveals both directions and consolidates into the older thread', () => {
    const s = run([
      { type: 'start', from: 'X', to: 'B' },
      { type: 'start', from: 'B', to: 'X' },
      { type: 'follow', from: 'X', to: 'B' },
      { type: 'follow', from: 'B', to: 'X' },
    ]);
    const [older, newer] = s.threads;
    expect(older!.revealed && newer!.revealed).toBe(true);
    expect(newer!.state).toBe('SEALED');
    expect(newer!.canonicalOf).toBe(older!.id);
  });

  it('reveal is irreversible: unfollow after mutual keeps identity', () => {
    const s = run([
      { type: 'start', from: 'X', to: 'B' },
      { type: 'follow', from: 'X', to: 'B' },
      { type: 'follow', from: 'B', to: 'X' },
      { type: 'unfollow', from: 'X', to: 'B' },
    ]);
    expect(s.threads[0]!.revealed).toBe(true);
  });

  it('DEC-17: rejection blocks a new thread for 30 days, then allows it', () => {
    let s = run([
      { type: 'start', from: 'X', to: 'B' },
      { type: 'reject', by: 'B', initiator: 'X' },
    ]);
    expect(profileMessageAction(s, 'X', 'B')).toBe('UNAVAILABLE');
    s = apply(s, { type: 'advance', days: REJECT_COOLDOWN_DAYS - 1 });
    expect(profileMessageAction(s, 'X', 'B')).toBe('UNAVAILABLE');
    s = apply(s, { type: 'advance', days: 1 });
    expect(profileMessageAction(s, 'X', 'B')).toBe('START_NEW');
  });

  it('full block closes threads and removes follows; unblock restores nothing (REQ-SOC-08)', () => {
    let s = run([
      { type: 'start', from: 'B', to: 'X' },
      { type: 'follow', from: 'B', to: 'X' },
      { type: 'blockFull', by: 'B', target: 'X' },
    ]);
    expect(s.threads[0]!.state).toBe('CLOSED');
    s = apply(s, { type: 'unblock', by: 'B', target: 'X' });
    expect(s.follows.size).toBe(0);
    expect(s.threads[0]!.state).toBe('CLOSED');
    expect(profileMessageAction(s, 'B', 'X')).toBe('START_NEW');
  });

  it('shield keeps the initiator’s follow edge frozen so "Seni takip ediyor" does not flip (O3)', () => {
    const s = run([
      { type: 'follow', from: 'X', to: 'B' },
      { type: 'start', from: 'X', to: 'B' },
      { type: 'shieldBlock', by: 'B', initiator: 'X' },
      { type: 'unfollow', from: 'X', to: 'B' },
    ]);
    expect(observeProfile(s, 'B', 'X').followsMe).toBe(true);
    expect(profileMessageAction(s, 'X', 'B')).toBe('UNAVAILABLE');
  });

  it('a FULL block over a shield, then unblock, restores the shield — A cannot contact B anonymously again (re-review New-2)', () => {
    const s = run([
      { type: 'start', from: 'X', to: 'B' },
      { type: 'shieldBlock', by: 'B', initiator: 'X' },
      { type: 'blockFull', by: 'B', target: 'X' },
      { type: 'unblock', by: 'B', target: 'X' },
    ]);
    expect(s.blocks.get('B>X')?.kind).toBe('ANON_SHIELD');
    expect(profileMessageAction(s, 'X', 'B')).toBe('UNAVAILABLE');
  });

  it('shield upgrades to FULL once identity becomes known through mutual follow', () => {
    const s = run([
      { type: 'follow', from: 'X', to: 'B' },
      { type: 'start', from: 'X', to: 'B' },
      { type: 'shieldBlock', by: 'B', initiator: 'X' },
      { type: 'follow', from: 'B', to: 'X' },
    ]);
    expect(s.blocks.get('B>X')?.kind).toBe('FULL');
    expect(s.threads[0]!.revealed).toBe(true);
  });
});
