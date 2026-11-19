import { z } from 'zod';
import { Avatar, ConversationId, MediaId, MessageId, PublicUserId, Timestamp } from './common.ts';

/**
 * The ONLY representation of "who is on the other side" (ADR-016 counterpartyView). In anonymous
 * contexts it carries nothing that identifies or narrows down the initiator (DEC-12): no id, name,
 * avatar, gender, age or district — only a style index derived from the conversation, not the user.
 */
export const AnonymousCounterparty = z.strictObject({
  kind: z.literal('ANONYMOUS'),
  label_key: z.literal('chat.anonymous_user'),
  avatar_style: z.int().min(0).max(7),
});
export const IdentifiedCounterparty = z.strictObject({
  kind: z.literal('IDENTIFIED'),
  public_user_id: PublicUserId,
  display_name: z.string().min(1).max(40),
  avatar: Avatar,
});
export const Counterparty = z.discriminatedUnion('kind', [AnonymousCounterparty, IdentifiedCounterparty]);

export const ConversationState = z.enum(['REQUEST', 'ACTIVE', 'REJECTED', 'CLOSED', 'SEALED']);

export const ConversationView = z.strictObject({
  conversation_id: ConversationId,
  state: ConversationState,
  counterparty: Counterparty,
  my_role: z.enum(['INITIATOR', 'RECIPIENT']),
  can_reveal: z.boolean(), // initiator only, while still anonymous
  can_send: z.boolean(),
  last_seq: z.int().min(0),
  delivered_seq: z.int().min(0),
  read_seq: z.int().min(0),
  /** the counterpart's watermarks over MY messages (✓✓ delivered / read), capped at what I can see */
  peer_delivered_seq: z.int().min(0),
  peer_read_seq: z.int().min(0),
  muted_until: Timestamp.nullable(),
  archived: z.boolean(),
  canonical_conversation_id: ConversationId.nullable(), // set when SEALED (consolidated, DEC-01)
});

export const SendMessageRequest = z.strictObject({
  client_msg_id: z.uuid(),
  kind: z.literal('TEXT'),
  body: z.string().min(1).max(4000),
});

export const Message = z.strictObject({
  message_id: MessageId,
  conversation_id: ConversationId,
  seq: z.int().min(1),
  mine: z.boolean(), // the client never needs the sender's id
  kind: z.enum(['TEXT', 'PHOTO', 'GOLD_GIFT', 'SYSTEM']),
  body: z.string().max(4000).nullable(),
  media_id: MediaId.nullable(),
  system_key: z.string().nullable(),
  server_ts: Timestamp,
});

export const ReceiptsRequest = z
  .strictObject({ delivered_seq: z.int().min(0).optional(), read_seq: z.int().min(0).optional() })
  .refine((r) => r.delivered_seq !== undefined || r.read_seq !== undefined, 'at least one watermark');

export const SyncResponse = z.strictObject({
  version: z.int().min(0),
  full_resync_required: z.boolean(),
  changed: z.array(
    z.strictObject({
      conversation_id: ConversationId,
      state: ConversationState,
      last_seq: z.int().min(0),
      delivered_seq: z.int().min(0),
      read_seq: z.int().min(0),
      counterparty: Counterparty,
    }),
  ),
});

export const MediaView = z.strictObject({
  media_id: MediaId,
  state: z.enum(['PROCESSING', 'READY', 'REJECTED', 'EXPIRED', 'REMOVED']),
  kind: z.enum(['PERSISTENT', 'ONE_VIEW']),
  unlock_price_gold: z.int().min(1),
  expires_at: Timestamp, // shown before unlock (DEC-05)
  /** pixel size after re-encode: lets the chat reserve the right bubble shape (metadata only, never pixels) */
  width: z.int().min(1).nullable(),
  height: z.int().min(1).nullable(),
  locked: z.boolean(),
  one_view_state: z.enum(['UNOPENED', 'OPENING', 'CONSUMED']).nullable(),
  access: z.strictObject({ url: z.url(), expires_in: z.int().min(1).max(300) }).nullable(),
});
