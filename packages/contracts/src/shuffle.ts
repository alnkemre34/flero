import { z } from 'zod';
import { Avatar, DistrictId, Gender, LabelKey, MembershipTier, PublicUserId, type ErrorCode } from './common.ts';

/** Appendix A §6 / T84 / T87: client-supplied algorithm overrides are rejected before any selection. */
export const FORBIDDEN_SHUFFLE_OVERRIDE_KEYS = [
  'shuffle_batch_size', 'batch_size', 'page_size', 'N', 'sparse_threshold', 'priority_ratio',
] as const;

const GenderFilter = z.enum(['ALL', 'FEMALE', 'MALE']);

export const ShuffleSampleRequest = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('DISTRICT'),
    target_district_id: DistrictId.nullable().optional(), // Standard: absent/null/home only (server-resolved)
    gender: GenderFilter,
  }),
  z.strictObject({
    mode: z.literal('CITY'), // Plus only; always the viewer's home city
    gender: GenderFilter,
  }),
]);
export type ShuffleSampleRequest = z.infer<typeof ShuffleSampleRequest>;

export const Placement = z.enum(['BOOST_BLOCK', 'DISCOVERY']);
export const CardBadge = z.enum(['badge.promoted', 'badge.plus']);

export const ShuffleCard = z.strictObject({
  public_user_id: PublicUserId,
  presentation_rank: z.int().min(0),
  placement: Placement,
  membership_tier: MembershipTier,
  display_name: z.string().min(1).max(40),
  avatar: Avatar,
  home_city_label_key: LabelKey,
  home_district_label_key: LabelKey,
  gender: Gender,
  card_badges: z.array(CardBadge).max(2),
});

export const ShuffleSampleResponse = z
  .strictObject({
    batch_id: z.string().regex(/^bat_[A-Za-z0-9_-]{16,}$/),
    mode: z.enum(['DISTRICT', 'CITY']),
    applied: z.strictObject({
      gender: GenderFilter,
      shuffle_batch_size: z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(25), z.literal(35), z.literal(50)]),
      district_id: DistrictId.optional(),
      config_version: z.string().regex(/^cfg_[A-Za-z0-9]+$/),
    }),
    selection_mode: z.enum(['NORMAL', 'SPARSE_COMPLETE', 'UNCERTAIN_PARTIAL']),
    completion: z.enum(['FULL', 'EXHAUSTED', 'UNCERTAIN']),
    has_more: z.boolean(),
    items: z.array(ShuffleCard).max(50),
  })
  .superRefine((r, ctx) => {
    // Runtime semantic checks (A§4, §6, §3.7); JSON Schema cannot express these.
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const ids = r.items.map((i) => i.public_user_id);
    if (new Set(ids).size !== ids.length) fail('duplicate public_user_id within one batch (T16)');
    if (r.items.length > r.applied.shuffle_batch_size) fail('more items than the server batch size');
    if (r.selection_mode === 'SPARSE_COMPLETE' && (r.completion !== 'EXHAUSTED' || r.has_more)) fail('SPARSE_COMPLETE must be EXHAUSTED with has_more=false');
    if (r.selection_mode === 'UNCERTAIN_PARTIAL' && (r.completion !== 'UNCERTAIN' || !r.has_more)) fail('UNCERTAIN_PARTIAL must be UNCERTAIN with has_more=true');
    if (r.completion === 'EXHAUSTED' && r.has_more) fail('EXHAUSTED implies has_more=false');
    if (r.mode === 'CITY' && r.applied.district_id !== undefined) fail('CITY responses carry no district');
    const group = (i: (typeof r.items)[number]) => (i.placement === 'BOOST_BLOCK' ? 0 : i.membership_tier === 'PLUS' ? 1 : 2);
    r.items.forEach((item, idx) => {
      if (item.presentation_rank !== idx) fail('presentation_rank must equal array position');
      if (idx > 0 && group(r.items[idx - 1]!) > group(item)) fail('order must be BOOST_BLOCK → DISCOVERY_PLUS → DISCOVERY_STANDARD');
      if (item.card_badges.includes('badge.promoted') !== (item.placement === 'BOOST_BLOCK')) fail('badge.promoted iff BOOST_BLOCK (A§0.1.10)');
      if (item.card_badges.includes('badge.plus') !== (item.membership_tier === 'PLUS')) fail('badge.plus iff current Plus');
    });
  });
export type ShuffleSampleResponse = z.infer<typeof ShuffleSampleResponse>;

/** Edge validation used by the API handler: override keys take precedence over generic validation errors. */
export function parseShuffleRequest(
  body: unknown,
): { ok: true; value: ShuffleSampleRequest } | { ok: false; code: ErrorCode; status: 400 } {
  if (body !== null && typeof body === 'object' && FORBIDDEN_SHUFFLE_OVERRIDE_KEYS.some((k) => Object.hasOwn(body, k))) {
    return { ok: false, code: 'SHUFFLE_BATCH_SIZE_NOT_CLIENT_CONFIGURABLE', status: 400 };
  }
  const parsed = ShuffleSampleRequest.safeParse(body);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, code: 'VALIDATION_FAILED', status: 400 };
}
