import { z } from 'zod';

/** Opaque public identifiers (REQ-ID-01): prefixed random base32, never internal ids. */
const opaque = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-z2-7]{26}$`));
export const PublicUserId = opaque('usr');
export const ConversationId = opaque('cnv');
export const MessageId = opaque('msg');
export const MediaId = opaque('med');
export const BoostId = opaque('bst');
export const TransactionId = opaque('txn');
export const DistrictId = z.string().regex(/^dst_[0-9]{1,8}$/);
export const LabelKey = z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/);
export const Timestamp = z.iso.datetime({ offset: true });

/** Stable error codes; clients localize them (REQ-PLT-02). Additive changes only. */
export const ErrorCode = z.enum([
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'ACTION_UNAVAILABLE', // single code for blocked / suspended / deleted / hidden-thread states (doc 10 O10)
  'RATE_LIMITED',
  'TEMPORARILY_UNAVAILABLE',
  'IDEMPOTENCY_PAYLOAD_MISMATCH',
  'NOT_FOUND',
  'SHUFFLE_BATCH_SIZE_NOT_CLIENT_CONFIGURABLE',
  'SHUFFLE_SURFACE_NOT_ALLOWED',
  'SHUFFLE_FILTER_REQUIRES_PLUS',
  'HOME_REGION_CHANGE_TOO_SOON',
  'HOME_REGION_LOCKED_BY_ACTIVE_BOOST',
  'INSUFFICIENT_GOLD',
  'BOOST_ALREADY_ACTIVE',
  'BOOST_QUOTE_EXPIRED',
  'BOOST_QUOTE_STALE_REGION',
  'BOOST_SCOPE_REQUIRES_PLUS',
  'BOOST_PRODUCT_UNAVAILABLE',
  'BOOST_ACTIVATION_RETRYABLE',
  'MEDIA_NOT_READY',
  'MEDIA_EXPIRED',
  'ONE_VIEW_ALREADY_CONSUMED',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** RFC 9457 problem details with a stable `code`; never carries counter state or hidden-thread hints. */
export const Problem = z.strictObject({
  type: z.string(),
  code: ErrorCode,
  status: z.int().min(400).max(599),
  title_key: LabelKey,
  detail_key: LabelKey.optional(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  request_id: z.string(),
});

export const Avatar = z.strictObject({ url: z.url() }).nullable();
export const Gender = z.enum(['FEMALE', 'MALE']);
export const MembershipTier = z.enum(['STANDARD', 'PLUS']);
