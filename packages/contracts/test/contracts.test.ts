import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AnonymousCounterparty,
  BOUNDED_LISTS,
  BoostQuote,
  COVERAGE_TODO,
  SELF_ONLY_FIELD_ALLOWANCES,
  buildAsyncApi,
  buildOpenApi,
  FORBIDDEN_SHUFFLE_OVERRIDE_KEYS,
  GoldGiftRequest,
  OPERATIONS,
  parseShuffleRequest,
  ShuffleSampleResponse,
} from '../src/index.ts';

const generated = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../generated/${name}`, import.meta.url)), 'utf8')) as Record<string, unknown>;

/** Recursively collects every property name declared anywhere in a JSON Schema. */
function propertyNames(schema: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) schema.forEach((s) => propertyNames(s, out));
  else if (schema && typeof schema === 'object') {
    const o = schema as Record<string, unknown>;
    if (o.properties && typeof o.properties === 'object') Object.keys(o.properties).forEach((k) => out.add(k));
    Object.values(o).forEach((v) => propertyNames(v, out));
  }
  return out;
}

describe('generated documents are current (no drift; doc 16 §4)', () => {
  it('openapi.v1.json equals the generator output', () => {
    expect(generated('openapi.v1.json')).toEqual(JSON.parse(JSON.stringify(buildOpenApi())));
  });
  it('asyncapi.v1.json equals the generator output', () => {
    expect(generated('asyncapi.v1.json')).toEqual(JSON.parse(JSON.stringify(buildAsyncApi())));
  });
});

describe('forbidden fields in responses (REQ-ANON-01, REQ-ID-01, A§6, doc 07 §4)', () => {
  const FORBIDDEN = [
    'id', 'account_id', 'user_id', 'internal_id', 'email', 'phone', 'password',
    'initiator_id', 'recipient_id', 'sender_id', 'sender_public_user_id', 'owner_id', 'viewer_id',
    'active_boost', 'boost_ends_at', 'boost_expires_at', 'is_sparse_market', 'eligible_count', 'audience_size',
    'followers', 'follower_ids', 'friends', 'friend_count', 'friend_ids', 'liker_ids', 'storage_key',
  ];
  const doc = buildOpenApi() as { components: { schemas: Record<string, unknown> } };
  const responseSchemaNames = new Set(
    OPERATIONS.flatMap((op) => (op.response === null ? [] : [typeof op.response === 'string' ? op.response : op.response.array])),
  );

  it.each([...responseSchemaNames])('%s exposes no forbidden property', (name) => {
    const names = propertyNames(doc.components.schemas[name]);
    const allowed = new Set<string>((SELF_ONLY_FIELD_ALLOWANCES as Record<string, readonly string[] | undefined>)[name] ?? []);
    expect(FORBIDDEN.filter((f) => names.has(f) && !allowed.has(f))).toEqual([]);
  });

  it('self-only allowances are used only by operations under /v1/me (or auth/onboarding about the caller)', () => {
    for (const [schema] of Object.entries(SELF_ONLY_FIELD_ALLOWANCES)) {
      const users = OPERATIONS.filter((o) => o.response === schema || (typeof o.response === 'object' && o.response?.array === schema));
      for (const o of users) expect(o.path, `${o.operationId} returns ${schema}`).toMatch(/^\/v1\/(me|onboarding)(\/|$)/);
    }
  });

  it('every realtime server event exposes no forbidden property', () => {
    const names = propertyNames((buildAsyncApi() as { components: { schemas: unknown } }).components.schemas);
    expect(FORBIDDEN.filter((f) => names.has(f))).toEqual([]);
  });

  it('the anonymous counterparty carries nothing that identifies or narrows the initiator (DEC-12)', () => {
    expect(Object.keys(AnonymousCounterparty.shape).sort()).toEqual(['avatar_style', 'kind', 'label_key']);
    expect(AnonymousCounterparty.safeParse({ kind: 'ANONYMOUS', label_key: 'chat.anonymous_user', avatar_style: 1, gender: 'MALE' }).success).toBe(false);
    expect(AnonymousCounterparty.safeParse({ kind: 'ANONYMOUS', label_key: 'chat.anonymous_user', avatar_style: 1, public_user_id: 'usr_aaaaaaaaaaaaaaaaaaaaaaaaaa' }).success).toBe(false);
  });

  it('all response objects are closed (additionalProperties: false), so serializers cannot leak extra fields', () => {
    const open: string[] = [];
    const walk = (s: unknown, path: string) => {
      if (Array.isArray(s)) s.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (s && typeof s === 'object') {
        const o = s as Record<string, unknown>;
        if (o.type === 'object' && o.properties && o.additionalProperties !== false) open.push(path);
        Object.entries(o).forEach(([k, v]) => walk(v, `${path}.${k}`));
      }
    };
    for (const name of responseSchemaNames) walk(doc.components.schemas[name], name);
    expect(open).toEqual([]);
  });
});

describe('Shuffle request edge validation (A§6, SHF-T84, T87, T01–T04)', () => {
  it.each(FORBIDDEN_SHUFFLE_OVERRIDE_KEYS)('rejects client override "%s" with the dedicated code', (key) => {
    expect(parseShuffleRequest({ mode: 'DISTRICT', gender: 'ALL', [key]: 50 })).toEqual({
      ok: false, code: 'SHUFFLE_BATCH_SIZE_NOT_CLIENT_CONFIGURABLE', status: 400,
    });
  });
  it('rejects unknown fields generically (strict schema)', () => {
    expect(parseShuffleRequest({ mode: 'DISTRICT', gender: 'ALL', tier: 'PLUS' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });
  it('rejects a district on CITY mode and accepts the canonical requests', () => {
    expect(parseShuffleRequest({ mode: 'CITY', gender: 'FEMALE', target_district_id: 'dst_3401' })).toMatchObject({ ok: false });
    expect(parseShuffleRequest({ mode: 'DISTRICT', target_district_id: null, gender: 'ALL' })).toMatchObject({ ok: true });
    expect(parseShuffleRequest({ mode: 'CITY', gender: 'FEMALE' })).toMatchObject({ ok: true });
  });
});

describe('Shuffle response semantics (A§4, §6, §3.7)', () => {
  const card = (rank: number, placement: 'BOOST_BLOCK' | 'DISCOVERY', tier: 'STANDARD' | 'PLUS', n: number) => ({
    public_user_id: `usr_${String.fromCharCode(97 + n).repeat(26)}`,
    presentation_rank: rank, placement, membership_tier: tier, display_name: 'Ayşe', avatar: null,
    home_city_label_key: 'geo.city.istanbul', home_district_label_key: 'geo.district.kadikoy', gender: 'FEMALE',
    card_badges: [...(placement === 'BOOST_BLOCK' ? ['badge.promoted'] : []), ...(tier === 'PLUS' ? ['badge.plus'] : [])],
  });
  const base = {
    batch_id: 'bat_0123456789abcdefXYZ', mode: 'DISTRICT',
    applied: { gender: 'ALL', shuffle_batch_size: 10, district_id: 'dst_3401', config_version: 'cfg_1' },
    selection_mode: 'NORMAL', completion: 'FULL', has_more: true,
    items: [card(0, 'BOOST_BLOCK', 'STANDARD', 0), card(1, 'DISCOVERY', 'PLUS', 1), card(2, 'DISCOVERY', 'STANDARD', 2)],
  };

  it('accepts a well-formed NORMAL batch (A§6 example shape)', () => {
    expect(ShuffleSampleResponse.safeParse(base).success).toBe(true);
  });
  it('rejects a promoted badge on DISCOVERY (T42)', () => {
    const bad = structuredClone(base);
    bad.items[1]!.card_badges = ['badge.promoted', 'badge.plus'];
    expect(ShuffleSampleResponse.safeParse(bad).success).toBe(false);
  });
  it('rejects Standard DISCOVERY above Plus DISCOVERY (T73, release blocker)', () => {
    const bad = structuredClone(base);
    bad.items = [card(0, 'BOOST_BLOCK', 'STANDARD', 0), card(1, 'DISCOVERY', 'STANDARD', 2), card(2, 'DISCOVERY', 'PLUS', 1)];
    expect(ShuffleSampleResponse.safeParse(bad).success).toBe(false);
  });
  it('rejects in-batch duplicates (T16) and SPARSE_COMPLETE with has_more (T17)', () => {
    const dup = structuredClone(base);
    dup.items[2]!.public_user_id = dup.items[0]!.public_user_id;
    expect(ShuffleSampleResponse.safeParse(dup).success).toBe(false);
    expect(ShuffleSampleResponse.safeParse({ ...base, selection_mode: 'SPARSE_COMPLETE', completion: 'EXHAUSTED', has_more: true }).success).toBe(false);
    expect(ShuffleSampleResponse.safeParse({ ...base, selection_mode: 'SPARSE_COMPLETE', completion: 'EXHAUSTED', has_more: false }).success).toBe(true);
  });
  it('rejects UNCERTAIN presented as exhausted (T18, T48)', () => {
    expect(ShuffleSampleResponse.safeParse({ ...base, selection_mode: 'UNCERTAIN_PARTIAL', completion: 'EXHAUSTED', has_more: false }).success).toBe(false);
  });
  it('rejects a client-visible batch larger than the server N', () => {
    const big = structuredClone(base);
    big.applied.shuffle_batch_size = 10;
    big.items = Array.from({ length: 11 }, (_, i) => card(i, 'DISCOVERY', 'STANDARD', i));
    expect(ShuffleSampleResponse.safeParse(big).success).toBe(false);
  });
});

describe('surface rules (doc 07, rules/backend-data.md)', () => {
  it('every array response is cursor-paginated or an explicitly bounded list', () => {
    const offenders = OPERATIONS.filter((o) => typeof o.response === 'object' && o.response !== null)
      .filter((o) => !(o.query === 'list' || (typeof o.query === 'object' && !Array.isArray(o.query) && 'list' in o.query)))
      .filter((o) => !(o.operationId in BOUNDED_LISTS))
      .map((o) => o.operationId);
    expect(offenders).toEqual([]);
  });
  it('there is no unlike route (REQ-SOC-07)', () => {
    expect(OPERATIONS.filter((o) => o.method === 'delete' && o.path.startsWith('/v1/likes'))).toEqual([]);
  });
  it('friend lists and counts exist only under /v1/me (REQ-SOC-05)', () => {
    for (const o of OPERATIONS.filter((x) => /friend/i.test(x.operationId))) expect(o.path).toMatch(/^\/v1\/me\//);
  });
  it('only auth bootstrap endpoints are unauthenticated', () => {
    for (const o of OPERATIONS.filter((x) => x.public)) expect(o.path).toMatch(/^\/v1\/auth\//);
  });
  it('operationIds are unique and the public surface has no remaining TODO besides the admin API', () => {
    const ids = OPERATIONS.map((o) => o.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(COVERAGE_TODO).toEqual(['admin-api (separate document, M7)']);
  });
});

describe('economic request shapes', () => {
  it('a Gold gift body has no amount field — the amount is always 1 (REQ-GLD-05)', () => {
    expect(GoldGiftRequest.safeParse({}).success).toBe(true);
    expect(GoldGiftRequest.safeParse({ amount: 5 }).success).toBe(false);
  });
  it('every quote carries the identical neutral disclosure and no sparse flag (T100)', () => {
    expect(Object.keys(BoostQuote.shape)).not.toContain('is_sparse_market');
    expect(Object.keys(BoostQuote.shape)).toContain('disclosure_keys');
  });
  it('every economic or creating POST requires an Idempotency-Key (doc 07 §1)', () => {
    const mustBeIdempotent = ['sendMessage', 'startConversation', 'sendGoldGift', 'unlockMedia', 'verifyPurchase', 'activateBoost', 'createReport', 'revealIdentity'];
    for (const id of mustBeIdempotent) expect(OPERATIONS.find((o) => o.operationId === id)?.idempotent, id).toBe(true);
  });
});
