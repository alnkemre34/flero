import { ConversationView, Message, PublicProfile } from '@flero/contracts';
import { NORMAL_BATCH } from '@/features/shuffle/fixtures';

/**
 * Prototype fixtures parsed with the REAL contract schemas, so screens can only render fields the API is allowed
 * to send (e.g. an anonymous counterparty has no id, name, gender or district — DEC-12).
 */
const cnv = (ch: string) => `cnv_${ch.repeat(26)}`;
const msg = (ch: string, n: number) => `msg_${ch.repeat(25)}${'abcdefghijklmnop'[n]}`;

export function profileFor(id: string) {
  const card = NORMAL_BATCH.items.find((i) => i.public_user_id === id) ?? NORMAL_BATCH.items[0]!;
  const seed = card.public_user_id.charCodeAt(4) - 96;
  return PublicProfile.parse({
    public_user_id: card.public_user_id,
    handle: card.display_name.toLocaleLowerCase('tr-TR').replace(/[^a-z0-9]/g, '').slice(0, 12).padEnd(3, 'x'),
    display_name: card.display_name,
    avatar: null,
    gender: card.gender,
    home_city_label_key: card.home_city_label_key,
    home_district_label_key: card.home_district_label_key,
    bio: seed % 2 ? 'Kahve, uzun yürüyüşler ve iyi bir çalma listesi. Moda sahilinde gün batımı.' : 'Fotoğraf, konser, kitap. Yeni insanlarla tanışmayı seviyorum.',
    membership_tier_style: card.membership_tier,
    follower_count: 120 + seed * 37,
    like_count: 48 + seed * 11,
    relationship: { i_follow: false, follows_me: seed % 3 === 0, i_liked: false, is_friend: false },
    actions: { message: { kind: 'START_NEW' } },
  });
}

/** Recipient's view of an anonymous request thread (counterparty fully redacted). */
export const ANON_THREAD = ConversationView.parse({
  conversation_id: cnv('k'),
  state: 'REQUEST',
  counterparty: { kind: 'ANONYMOUS', label_key: 'chat.anonymous_user', avatar_style: 3 },
  my_role: 'RECIPIENT',
  can_reveal: false,
  can_send: true,
  last_seq: 4, delivered_seq: 4, read_seq: 3, peer_delivered_seq: 0, peer_read_seq: 0,
  muted_until: null, archived: false, canonical_conversation_id: null,
});

const at = (min: number) => new Date(Date.UTC(2026, 10, 14, 19, min)).toISOString();
export const ANON_MESSAGES = [
  { message_id: msg('m', 0), conversation_id: cnv('k'), seq: 1, mine: false, kind: 'TEXT', body: 'Selam! Kadıköy’deki konser fotoğrafını gördüm, harikaydı 📸', media_id: null, system_key: null, server_ts: at(2) },
  { message_id: msg('m', 1), conversation_id: cnv('k'), seq: 2, mine: false, kind: 'PHOTO', body: null, media_id: `med_${'p'.repeat(26)}`, system_key: null, server_ts: at(3) },
  { message_id: msg('m', 2), conversation_id: cnv('k'), seq: 3, mine: true, kind: 'TEXT', body: 'Teşekkürler 🙂 Sen de orada mıydın?', media_id: null, system_key: null, server_ts: at(5) },
  { message_id: msg('m', 3), conversation_id: cnv('k'), seq: 4, mine: false, kind: 'TEXT', body: 'Evet, sahnenin sağ tarafındaydım. Kim olduğumu tahmin et 😄', media_id: null, system_key: null, server_ts: at(6) },
].map((m) => Message.parse(m));

export const INBOX = [
  { thread: ANON_THREAD, preview: 'Evet, sahnenin sağ tarafındaydım…', time: '19:06', unread: 1 },
  {
    thread: ConversationView.parse({
      conversation_id: cnv('l'), state: 'ACTIVE',
      counterparty: { kind: 'IDENTIFIED', public_user_id: NORMAL_BATCH.items[3]!.public_user_id, display_name: NORMAL_BATCH.items[3]!.display_name, avatar: null },
      my_role: 'INITIATOR', can_reveal: true, can_send: true, last_seq: 12, delivered_seq: 12, read_seq: 12, peer_delivered_seq: 0, peer_read_seq: 0,
      muted_until: null, archived: false, canonical_conversation_id: null,
    }),
    preview: 'Cumartesi Moda’da buluşalım mı?', time: '18:40', unread: 0,
  },
  {
    thread: ConversationView.parse({
      conversation_id: cnv('n'), state: 'ACTIVE',
      counterparty: { kind: 'IDENTIFIED', public_user_id: NORMAL_BATCH.items[0]!.public_user_id, display_name: NORMAL_BATCH.items[0]!.display_name, avatar: null },
      my_role: 'RECIPIENT', can_reveal: false, can_send: true, last_seq: 30, delivered_seq: 30, read_seq: 28, peer_delivered_seq: 0, peer_read_seq: 0,
      muted_until: null, archived: false, canonical_conversation_id: null,
    }),
    preview: 'Çok güzel bir öneriydi, teşekkürler!', time: 'Dün', unread: 2,
  },
];
