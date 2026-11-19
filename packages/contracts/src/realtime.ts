import { z } from 'zod';
import { ConversationId, MediaId, MessageId, Timestamp } from './common.ts';
import { Counterparty, ConversationState } from './conversation.ts';

/** WebSocket protocol v1 (doc 08 §6). Every server event is already redacted per recipient. */
const v = z.literal(1);
const sync_version = z.int().min(0);

export const ServerEvents = {
  hello: z.strictObject({ t: z.literal('hello'), v, heartbeat_s: z.int().min(5).max(120), sync_version }),
  'message.new': z.strictObject({
    t: z.literal('message.new'), v, event_id: z.uuid(), conversation_id: ConversationId, seq: z.int().min(1),
    message_id: MessageId, kind: z.enum(['TEXT', 'PHOTO', 'GOLD_GIFT', 'SYSTEM']), body: z.string().max(4000).nullable(),
    media: z.strictObject({ media_id: MediaId, locked: z.boolean() }).nullable(), server_ts: Timestamp, sync_version,
  }),
  'message.committed': z.strictObject({
    t: z.literal('message.committed'), v, event_id: z.uuid(), conversation_id: ConversationId, seq: z.int().min(1),
    message_id: MessageId, client_msg_id: z.uuid(), server_ts: Timestamp, sync_version,
  }),
  'receipt.updated': z.strictObject({
    t: z.literal('receipt.updated'), v, conversation_id: ConversationId,
    delivered_seq: z.int().min(0), read_seq: z.int().min(0), sync_version,
  }),
  'conversation.updated': z.strictObject({
    t: z.literal('conversation.updated'), v, conversation_id: ConversationId, state: ConversationState,
    counterparty: Counterparty, sync_version,
  }),
  typing: z.strictObject({ t: z.literal('typing'), v, conversation_id: ConversationId, state: z.enum(['on', 'off']) }),
  'sync.hint': z.strictObject({ t: z.literal('sync.hint'), v, sync_version }),
  'session.revoked': z.strictObject({ t: z.literal('session.revoked'), v }),
  /** In-app notification hint: generic by design, the client fetches the redacted row (doc 09 §4). */
  'notification.new': z.strictObject({ t: z.literal('notification.new'), v, notification_type: z.string().max(40) }),
  pong: z.strictObject({ t: z.literal('pong'), v, sync_version }), // carries sync_version (review M4)
} as const;

export const ClientEvents = {
  auth: z.strictObject({ t: z.literal('auth'), token: z.string().min(20) }), // token never in the URL
  reauth: z.strictObject({ t: z.literal('reauth'), token: z.string().min(20) }),
  ack: z.strictObject({ t: z.literal('ack'), conversation_id: ConversationId, seq: z.int().min(1) }),
  typing: z.strictObject({ t: z.literal('typing'), conversation_id: ConversationId, state: z.enum(['on', 'off']) }),
  ping: z.strictObject({ t: z.literal('ping') }),
} as const;

const S = ServerEvents;
const C = ClientEvents;
export const ServerEvent = z.discriminatedUnion('t', [
  S.hello, S['message.new'], S['message.committed'], S['receipt.updated'], S['conversation.updated'],
  S.typing, S['sync.hint'], S['session.revoked'], S['notification.new'], S.pong,
]);
export const ClientEvent = z.discriminatedUnion('t', [C.auth, C.reauth, C.ack, C.typing, C.ping]);
