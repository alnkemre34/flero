import { z } from 'zod';
import { ConversationId, LabelKey, MediaId, Timestamp } from './common.ts';
import { ConversationView } from './conversation.ts';
import { BOOST_DISCLOSURE_KEYS, BoostEntitlement } from './wallet.ts';

// ---------- inbox ----------
export const InboxEntry = z.strictObject({
  conversation: ConversationView, // counterparty via counterpartyView (ADR-016)
  last_message_preview: z.string().max(140).nullable(),
  /** lets the list say "Fotoğraf" / "1 Gold" for messages without text (never a preview of the photo) */
  last_message_kind: z.enum(['TEXT', 'PHOTO', 'GOLD_GIFT', 'SYSTEM']).nullable(),
  last_message_at: Timestamp.nullable(),
  unread_count: z.int().min(0),
});
export const MuteRequest = z.strictObject({ until: Timestamp.nullable() });

// ---------- chat media ----------
export const MediaUploadRequest = z.strictObject({
  kind: z.enum(['PERSISTENT', 'ONE_VIEW']),
  content_type: z.enum(['image/jpeg', 'image/png', 'image/heif']),
  byte_size: z.int().min(1).max(15_000_000),
});
export const MediaUploadTicket = z.strictObject({
  media_id: MediaId, url: z.url(), fields: z.record(z.string(), z.string()), expires_in: z.int().min(30).max(900),
});
export const OneViewLease = z.strictObject({ lease_id: z.uuid(), url: z.url(), expires_in: z.int().min(10).max(90) });
export const RenderedRequest = z.strictObject({ lease_id: z.uuid() });

// ---------- store, Plus, Boost catalog ----------
export const StoreProduct = z.strictObject({
  product_id: z.string().max(100), platform: z.enum(['APPLE', 'GOOGLE']), gold_amount: z.int().min(1),
});
export const PlusPlan = z.strictObject({
  plan_id: z.string().max(64), period: z.enum(['MONTHLY', 'YEARLY']), product_id: z.string().max(100),
  benefit_keys: z.array(LabelKey).min(1), // must include the rank advantage (A§8.8) — copy reviewed
});
export const PlusStatus = z.strictObject({
  active: z.boolean(), state: z.enum(['NONE', 'ACTIVE', 'GRACE', 'ON_HOLD', 'EXPIRED']),
  valid_until: Timestamp.nullable(), auto_renew: z.boolean().nullable(),
});
export const BoostPackage = z.strictObject({
  package_id: z.int().min(1), version: z.int().min(1), scope: z.enum(['DISTRICT', 'CITY']),
  duration_seconds: z.int().min(60), price_gold: z.int().min(1),
});
export const BoostCatalog = z.strictObject({
  packages: z.array(BoostPackage), // Standard sees DISTRICT only (server-filtered)
  disclosure_keys: z.tuple([z.literal(BOOST_DISCLOSURE_KEYS[0]), z.literal(BOOST_DISCLOSURE_KEYS[1])]),
});
export const BoostActivationStatus = z.strictObject({
  state: z.enum(['PENDING', 'SUCCEEDED', 'FAILED']), boost: BoostEntitlement.nullable(), error_code: z.string().nullable(),
});
export const MyBoost = z.strictObject({ active: BoostEntitlement.nullable() });

// ---------- home banners ----------
export const Banner = z.strictObject({
  banner_id: z.string().regex(/^bnr_[a-z0-9]{6,32}$/),
  image_url: z.url(), alt_key: LabelKey,
  destination: z.string().regex(/^flero:\/\/[a-z/_-]{1,64}$/), // allowlisted in-app deep links only (REQ-HOM-01)
  sponsored: z.boolean(),
});

// ---------- notifications ----------
export const NotificationType = z.enum([
  'MESSAGE_REQUEST', 'REQUEST_ACCEPTED', 'PHOTO_RECEIVED', 'PHOTO_UNLOCKED', 'GOLD_GIFT', 'FOLLOW', 'LIKE',
  'FRIENDSHIP', 'REVEAL', 'PLUS_LIFECYCLE', 'BOOST_LIFECYCLE', 'WALLET', 'SECURITY', 'MODERATION',
]);
/** Copy is generic by design (doc 09 §4): params never carry a counterpart identity for anonymous classes. */
export const Notification = z.strictObject({
  notification_id: z.string().regex(/^ntf_[a-z2-7]{26}$/), type: NotificationType,
  title_key: LabelKey, body_key: LabelKey, params: z.record(z.string(), z.union([z.string(), z.int()])),
  deep_link: z.string().regex(/^flero:\/\/[a-z]+\/[A-Za-z0-9_]+$/).nullable(),
  conversation_id: ConversationId.nullable(), created_at: Timestamp, read: z.boolean(),
});
export const NotificationReadRequest = z.strictObject({ up_to_id: z.string().regex(/^ntf_[a-z2-7]{26}$/) });
export const PushTokenRequest = z.strictObject({
  provider: z.enum(['apns', 'fcm']), token: z.string().min(16).max(4096), locale: z.enum(['tr', 'en']),
});
export const NotificationPrefs = z.strictObject({
  topics: z.strictObject({
    messages: z.boolean(), requests: z.boolean(), social: z.boolean(), gifts_unlocks: z.boolean(),
    plus_boost: z.boolean(), wallet: z.boolean(), marketing: z.boolean(),
  }), // security and moderation cannot be disabled
  quiet_hours: z.strictObject({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/), tz: z.string().max(64) }).nullable(),
  message_preview: z.boolean(), // off by default (doc 09 §4)
});
