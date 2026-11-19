import { z } from 'zod';
import { Avatar, DistrictId, Gender, LabelKey, MembershipTier, PublicUserId, Timestamp } from './common.ts';

export const CityId = z.string().regex(/^cty_[0-9]{1,8}$/);
const Handle = z.string().regex(/^[a-z0-9._]{3,20}$/);
const Password = z.string().min(10).max(128);
const Locale = z.enum(['tr', 'en']);

// ---------- auth (ADR-007; generic errors, no account enumeration) ----------
export const SignupRequest = z.strictObject({
  email: z.email().max(254), password: Password, handle: Handle,
  display_name: z.string().min(1).max(40), gender: Gender, locale: Locale,
});
export const LoginRequest = z.strictObject({ email: z.email().max(254), password: z.string().min(1).max(128) });
export const OidcRequest = z.strictObject({
  id_token: z.string().min(20).max(8000), nonce: z.string().min(16).max(128),
  // first sign-in only (profile completion); ignored for existing accounts
  handle: Handle.optional(), display_name: z.string().min(1).max(40).optional(), gender: Gender.optional(), locale: Locale.optional(),
});
export const RefreshRequest = z.strictObject({ refresh_token: z.string().min(32).max(256) });
export const PasswordResetRequest = z.strictObject({ email: z.email().max(254) });
export const PasswordReset = z.strictObject({ token: z.string().min(32).max(256), new_password: Password });
export const EmailVerifyRequest = z.strictObject({ code: z.string().regex(/^[0-9]{6}$/) });
/** Change password while signed in: the current password is re-checked; every OTHER session is signed out. */
export const PasswordChangeRequest = z.strictObject({ current_password: z.string().min(1).max(128), new_password: Password });

export const OnboardingStatus = z.strictObject({
  email_verified: z.boolean(), age_assured: z.boolean(), consents_current: z.boolean(), home_region_set: z.boolean(),
});
export const TokenPair = z.strictObject({
  access_token: z.string(), access_expires_in: z.int().min(60).max(900),
  refresh_token: z.string(), session_id: z.uuid(), onboarding: OnboardingStatus,
});
export const Session = z.strictObject({
  session_id: z.uuid(), device_label: z.string().max(80).nullable(), platform: z.enum(['ios', 'android', 'web']),
  created_at: Timestamp, last_seen_at: Timestamp, current: z.boolean(),
});

// ---------- onboarding ----------
/** DOB is used once to compute 18+ and then discarded (DEC-06); only the result is stored. */
export const AgeAssuranceRequest = z.strictObject({ method: z.literal('SELF_DECLARED_DOB'), date_of_birth: z.iso.date() });
export const AgeAssuranceResult = z.strictObject({ age_assured: z.boolean(), next_step: z.enum(['NONE', 'VENDOR_CHECK', 'BLOCKED']) });
export const ConsentRequest = z.strictObject({
  locale: Locale,
  consents: z.array(z.strictObject({ kind: z.enum(['TERMS', 'PRIVACY', 'COMMUNITY', 'MARKETING']), doc_version: z.string().max(32) })).min(1).max(4),
});
export const HomeRegionRequest = z.strictObject({ city_id: CityId, district_id: DistrictId });

// ---------- me ----------
/** The viewer's OWN account. The only response that may carry the viewer's email. */
export const Me = z.strictObject({
  public_user_id: PublicUserId, handle: Handle, display_name: z.string().min(1).max(40),
  email: z.email().nullable(), email_verified: z.boolean(), gender: Gender, locale: Locale,
  home_city_label_key: LabelKey.nullable(), home_district_label_key: LabelKey.nullable(), // null until onboarding sets the region
  home_region_next_change_at: Timestamp.nullable(), // 30-day rule (A§8.4); Boost lock is reported on attempt
  bio: z.string().max(300).nullable(), avatar: Avatar, membership_tier: MembershipTier, plus_until: Timestamp.nullable(),
  onboarding: OnboardingStatus,
});
export const ProfilePatch = z.strictObject({ display_name: z.string().min(1).max(40).optional(), bio: z.string().max(300).nullable().optional() });
export const AvatarUploadRequest = z.strictObject({
  content_type: z.enum(['image/jpeg', 'image/png', 'image/heif']), byte_size: z.int().min(1).max(15_000_000),
});
/** Presigned POST policy (content-length-range enforced by storage, review L2). */
export const UploadTicket = z.strictObject({
  upload_id: z.uuid(), url: z.url(), fields: z.record(z.string(), z.string()), expires_in: z.int().min(30).max(900),
});
export const AvatarCompleteRequest = z.strictObject({
  crop: z.strictObject({ x: z.int().min(0), y: z.int().min(0), size: z.int().min(256) }), // square, source-pixel space
});
export const PrivacyRequestStatus = z.strictObject({
  kind: z.enum(['EXPORT', 'DELETION']), state: z.enum(['REQUESTED', 'PROCESSING', 'READY', 'SCHEDULED', 'CANCELLED', 'DONE']),
  scheduled_for: Timestamp.nullable(), download_url: z.url().nullable(),
});

// ---------- geo & people ----------
export const City = z.strictObject({ city_id: CityId, label_key: LabelKey });
export const District = z.strictObject({ district_id: DistrictId, city_id: CityId, label_key: LabelKey });
/** Minimal person row for search and the owner's own following/friends lists. */
export const PersonSummary = z.strictObject({
  public_user_id: PublicUserId, handle: Handle, display_name: z.string().min(1).max(40), avatar: Avatar,
});
/** Owner-only (REQ-SOC-05): served solely under /v1/me/. */
export const FriendCount = z.strictObject({ friend_count: z.int().min(0) });
