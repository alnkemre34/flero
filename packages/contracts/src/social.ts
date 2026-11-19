import { z } from 'zod';
import { Avatar, ConversationId, Gender, LabelKey, MembershipTier, PublicUserId } from './common.ts';

/**
 * Public profile as seen by any viewer (doc 07 §2). `actions.message` follows the oracle-free CTA rule
 * (doc 08 §3.2): it never depends on a thread in which the profile owner is anonymous to the viewer.
 * No follower list, friend list or friend count of other users is ever exposed (REQ-SOC-03/05).
 */
export const PublicProfile = z.strictObject({
  public_user_id: PublicUserId,
  handle: z.string().regex(/^[a-z0-9._]{3,20}$/),
  display_name: z.string().min(1).max(40),
  avatar: Avatar,
  gender: Gender,
  home_city_label_key: LabelKey,
  home_district_label_key: LabelKey,
  bio: z.string().max(300).nullable(),
  membership_tier_style: MembershipTier,
  follower_count: z.int().min(0),
  like_count: z.int().min(0),
  relationship: z.strictObject({
    i_follow: z.boolean(),
    follows_me: z.boolean(), // "Seni takip ediyor": accepted, rate-limited disclosure (REQ-SOC-04)
    i_liked: z.boolean(),
    is_friend: z.boolean(), // derivable from i_follow ∧ follows_me; adds no information
  }),
  actions: z.strictObject({
    message: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('OPEN_EXISTING'), conversation_id: ConversationId }),
      z.strictObject({ kind: z.literal('START_NEW') }),
      z.strictObject({ kind: z.literal('UNAVAILABLE') }),
    ]),
  }),
});

export const StartConversationRequest = z.strictObject({
  recipient: PublicUserId,
  first_message: z.strictObject({ client_msg_id: z.uuid(), body: z.string().min(1).max(4000) }),
});

export const ReportRequest = z.strictObject({
  target: z.strictObject({
    type: z.enum(['PROFILE', 'CONVERSATION', 'MESSAGE', 'MEDIA']),
    id: z.string().min(1).max(64), // opaque public id of the target; reporting never needs the anonymous sender's id
  }),
  reason: z.enum(['SPAM', 'HARASSMENT', 'NUDITY', 'MINOR_SAFETY', 'VIOLENCE', 'IMPERSONATION', 'OTHER']),
  note: z.string().max(1000).optional(),
});
