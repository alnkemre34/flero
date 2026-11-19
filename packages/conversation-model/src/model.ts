/**
 * Executable conversation / anonymity state model (doc 08 §2–§3, doc 10 §3.1; DEC-01, DEC-02, DEC-17).
 *
 * This is a pure reference model used for model-based and differential (oracle) tests (M1.6).
 * The production backend must implement the same rules; its integration tests replay the same
 * action sequences against the real API and compare observations with this model.
 */

export type UserId = string;
export type ThreadState = 'REQUEST' | 'ACTIVE' | 'REJECTED' | 'CLOSED' | 'SEALED';
export type MessageAction = 'OPEN_EXISTING' | 'START_NEW' | 'UNAVAILABLE';

export interface Thread {
  readonly id: number;
  readonly initiator: UserId;
  readonly recipient: UserId;
  readonly state: ThreadState;
  /** Initiator identity visible to the recipient. Monotonic: never reverts (REQ-SOC-06). */
  readonly revealed: boolean;
  readonly createdAt: number;
  readonly rejectedAt?: number;
  readonly canonicalOf?: number;
  /**
   * DEC-02b delayed closure (doc 10 §3.2): when the recipient fully blocks a profile that is this thread's
   * still-hidden initiator, the thread closes immediately server-side, but the recipient keeps seeing the
   * pre-block presentation until `presentedCloseAt`.
   */
  readonly presentedCloseAt?: number;
  readonly presentedStateBefore?: ThreadState;
}

/** Stand-in for the production random 1–24 h delay, in model days (always < the smallest `advance`). */
export const HIDDEN_CLOSE_DELAY_DAYS = 0.5;

export interface Block {
  readonly kind: 'FULL' | 'ANON_SHIELD';
  /** A FULL block placed over an existing shield keeps it, so unblock restores the shield (re-review New-2). */
  readonly shieldRetained?: boolean;
}

export interface ModelState {
  readonly now: number; // days
  readonly nextId: number;
  readonly threads: readonly Thread[];
  readonly follows: ReadonlySet<string>; // `${a}>${b}` = a follows b
  readonly blocks: ReadonlyMap<string, Block>; // `${blocker}>${blocked}`
}

export const REJECT_COOLDOWN_DAYS = 30; // DEC-17

export type Action =
  | { type: 'start'; from: UserId; to: UserId }
  | { type: 'accept'; by: UserId; initiator: UserId }
  | { type: 'reject'; by: UserId; initiator: UserId }
  | { type: 'reveal'; by: UserId; recipient: UserId }
  | { type: 'follow'; from: UserId; to: UserId }
  | { type: 'unfollow'; from: UserId; to: UserId }
  | { type: 'blockFull'; by: UserId; target: UserId }
  | { type: 'unblock'; by: UserId; target: UserId }
  | { type: 'shieldBlock'; by: UserId; initiator: UserId } // from the anonymous thread initiator→by
  | { type: 'advance'; days: number };

export const initialState = (): ModelState => ({ now: 0, nextId: 1, threads: [], follows: new Set(), blocks: new Map() });

const key = (a: UserId, b: UserId) => `${a}>${b}`;
const isOpen = (t: Thread) => t.state === 'REQUEST' || t.state === 'ACTIVE';

export function openThread(s: ModelState, initiator: UserId, recipient: UserId): Thread | undefined {
  return s.threads.find((t) => t.initiator === initiator && t.recipient === recipient && isOpen(t));
}

const fullBlockEitherWay = (s: ModelState, a: UserId, b: UserId) =>
  s.blocks.get(key(a, b))?.kind === 'FULL' || s.blocks.get(key(b, a))?.kind === 'FULL';

/** Viewer V is shielded by P: P shield-blocked V's anonymous thread. Only V's side is affected. */
const shieldedBy = (s: ModelState, v: UserId, p: UserId) => s.blocks.get(key(p, v))?.kind === 'ANON_SHIELD';

/**
 * Profile CTA for viewer V on profile P (doc 08 §3.2). Never consults a thread in which
 * P is still anonymous to V — that is what makes it oracle-free.
 */
export function profileMessageAction(s: ModelState, v: UserId, p: UserId): MessageAction {
  if (v === p) return 'UNAVAILABLE';
  if (fullBlockEitherWay(s, v, p)) return 'UNAVAILABLE';
  if (openThread(s, v, p)) return 'OPEN_EXISTING';
  const reverse = openThread(s, p, v);
  if (reverse?.revealed) return 'OPEN_EXISTING';
  const inCooldown = s.threads.some(
    (t) => t.initiator === v && t.recipient === p && t.state === 'REJECTED' &&
      t.rejectedAt !== undefined && s.now - t.rejectedAt < REJECT_COOLDOWN_DAYS,
  );
  if (inCooldown) return 'UNAVAILABLE';
  if (shieldedBy(s, v, p)) return 'UNAVAILABLE'; // no new anonymous contact (DEC-02); V already knows P
  return 'START_NEW';
}

/** Can U send (text or a 1-Gold gift) in thread T? */
export function canSend(s: ModelState, u: UserId, t: Thread): boolean {
  if (!isOpen(t)) return false;
  if (u !== t.initiator && u !== t.recipient) return false;
  return !fullBlockEitherWay(s, t.initiator, t.recipient);
}

/** Does V know the identity of the other participant of T? */
export function knowsCounterpart(v: UserId, t: Thread): boolean {
  return v === t.initiator || (v === t.recipient && t.revealed);
}

function withThreads(s: ModelState, threads: Thread[]): ModelState {
  return { ...s, threads };
}

function mapThreads(s: ModelState, f: (t: Thread) => Thread): ModelState {
  return withThreads(s, s.threads.map(f));
}

/** Reveal every non-sealed anonymous thread between a and b (mutual follow, doc 08 §3.5). */
function revealPair(s: ModelState, a: UserId, b: UserId): ModelState {
  return mapThreads(s, (t) =>
    ((t.initiator === a && t.recipient === b) || (t.initiator === b && t.recipient === a)) && t.state !== 'SEALED'
      ? { ...t, revealed: true }
      : t,
  );
}

/** Consolidation (doc 08 §3.3): both directions open and identified → the newer one is SEALED. */
function consolidate(s: ModelState): ModelState {
  let next = s;
  for (const t of s.threads) {
    if (!isOpen(t) || !t.revealed) continue;
    const twin = openThread(next, t.recipient, t.initiator);
    if (twin?.revealed) {
      const [older, newer] = t.id < twin.id ? [t, twin] : [twin, t]; // ids are monotonic in creation order
      next = mapThreads(next, (x) => (x.id === newer.id ? { ...x, state: 'SEALED', canonicalOf: older.id } : x));
    }
  }
  return next;
}

/** Applies an action. Invalid actions are no-ops (the API would return an error). */
export function apply(s: ModelState, a: Action): ModelState {
  switch (a.type) {
    case 'advance':
      return { ...s, now: s.now + a.days };
    case 'start': {
      if (profileMessageAction(s, a.from, a.to) !== 'START_NEW') return s;
      const t: Thread = { id: s.nextId, initiator: a.from, recipient: a.to, state: 'REQUEST', revealed: false, createdAt: s.now };
      // An immediately mutual pair reveals at creation (they already follow each other).
      const revealed = s.follows.has(key(a.from, a.to)) && s.follows.has(key(a.to, a.from));
      return consolidate({ ...s, nextId: s.nextId + 1, threads: [...s.threads, { ...t, revealed }] });
    }
    case 'accept': {
      const t = openThread(s, a.initiator, a.by);
      if (!t || t.state !== 'REQUEST') return s;
      return mapThreads(s, (x) => (x.id === t.id ? { ...x, state: 'ACTIVE' } : x));
    }
    case 'reject': {
      const t = openThread(s, a.initiator, a.by);
      if (!t || t.state !== 'REQUEST') return s;
      return mapThreads(s, (x) => (x.id === t.id ? { ...x, state: 'REJECTED', rejectedAt: s.now } : x));
    }
    case 'reveal': {
      const t = openThread(s, a.by, a.recipient);
      if (!t || t.revealed) return s;
      return consolidate(mapThreads(s, (x) => (x.id === t.id ? { ...x, revealed: true } : x)));
    }
    case 'follow': {
      if (a.from === a.to || fullBlockEitherWay(s, a.from, a.to) || shieldedBy(s, a.from, a.to)) return s;
      const follows = new Set(s.follows).add(key(a.from, a.to));
      let next: ModelState = { ...s, follows };
      if (follows.has(key(a.to, a.from))) {
        next = consolidate(revealPair(next, a.from, a.to));
        // Identity now known: a shield between them upgrades to a FULL block (doc 10 §3.1).
        for (const [blocker, blocked] of [[a.from, a.to], [a.to, a.from]] as const) {
          if (next.blocks.get(key(blocker, blocked))?.kind === 'ANON_SHIELD') {
            next = apply(next, { type: 'blockFull', by: blocker, target: blocked });
          }
        }
      }
      return next;
    }
    case 'unfollow': {
      if (shieldedBy(s, a.from, a.to)) return s; // frozen edge (DEC-02): keeps "Seni takip ediyor" stable
      const follows = new Set(s.follows);
      follows.delete(key(a.from, a.to));
      return { ...s, follows }; // never un-reveals
    }
    case 'blockFull': {
      if (a.by === a.target) return s;
      const prior = s.blocks.get(key(a.by, a.target));
      const shieldRetained = prior?.kind === 'ANON_SHIELD' || prior?.shieldRetained === true;
      const blocks = new Map(s.blocks).set(key(a.by, a.target), { kind: 'FULL' as const, ...(shieldRetained ? { shieldRetained } : {}) });
      const follows = new Set(s.follows);
      follows.delete(key(a.by, a.target));
      follows.delete(key(a.target, a.by));
      // All threads between them close. A thread whose initiator is the blocked target and still hidden from
      // the blocker closes with a delayed presentation for the blocker (DEC-02b, residual O4).
      return mapThreads({ ...s, blocks, follows }, (t) => {
        const between = (t.initiator === a.by && t.recipient === a.target) || (t.initiator === a.target && t.recipient === a.by);
        if (!isOpen(t) || !between) return t;
        const hiddenFromBlocker = t.initiator === a.target && t.recipient === a.by && !t.revealed;
        return hiddenFromBlocker
          ? { ...t, state: 'CLOSED', presentedCloseAt: s.now + HIDDEN_CLOSE_DELAY_DAYS, presentedStateBefore: t.state }
          : { ...t, state: 'CLOSED' };
      });
    }
    case 'unblock': {
      const current = s.blocks.get(key(a.by, a.target));
      if (current?.kind !== 'FULL') return s; // shield is not user-removable in v1
      const blocks = new Map(s.blocks);
      if (current.shieldRetained) blocks.set(key(a.by, a.target), { kind: 'ANON_SHIELD' });
      else blocks.delete(key(a.by, a.target));
      return { ...s, blocks }; // no auto-restore of follows or threads (REQ-SOC-08)
    }
    case 'shieldBlock': {
      const t = openThread(s, a.initiator, a.by);
      if (!t || t.revealed) return s; // only from an anonymous thread
      const blocks = new Map(s.blocks).set(key(a.by, a.initiator), { kind: 'ANON_SHIELD' as const });
      return mapThreads({ ...s, blocks }, (x) => (x.id === t.id ? { ...x, state: 'CLOSED' } : x));
    }
  }
}

export const run = (actions: readonly Action[], from: ModelState = initialState()): ModelState =>
  actions.reduce(apply, from);

/**
 * Everything recipient B can observe about profile X (doc 10 §5 differential suite).
 * Only threads in which B already knows X contribute, by construction of the UI projection.
 */
/**
 * What recipient-or-initiator V sees for thread T in the inbox (state + composer). During a DEC-02b delay
 * the recipient still sees the pre-block state and an enabled composer (sends are stored, never delivered).
 */
export function observeInbox(s: ModelState, v: UserId, threadId: number) {
  const t = s.threads.find((x) => x.id === threadId);
  if (!t || (v !== t.initiator && v !== t.recipient)) return undefined;
  const delayed = v === t.recipient && t.presentedCloseAt !== undefined && s.now < t.presentedCloseAt;
  if (delayed) return { state: t.presentedStateBefore!, canSend: true, revealed: t.revealed };
  return { state: t.state, canSend: canSend(s, v, t), revealed: t.revealed };
}

export function observeProfile(s: ModelState, b: UserId, x: UserId) {
  const knownThreads = s.threads
    .filter((t) => ((t.initiator === b && t.recipient === x) || (t.initiator === x && t.recipient === b)) && knowsCounterpart(b, t))
    .map((t) => ({ id: t.id, state: t.state, xCanSend: canSend(s, x, t), bCanSend: canSend(s, b, t) }));
  return {
    cta: profileMessageAction(s, b, x),
    followsMe: s.follows.has(key(x, b)), // "Seni takip ediyor"
    iFollow: s.follows.has(key(b, x)),
    knownThreads,
  };
}
