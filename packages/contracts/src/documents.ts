/**
 * Builds the machine-readable contracts from the Zod schemas (ADR-003): OpenAPI 3.1 for HTTP and
 * AsyncAPI 3.0 for the WebSocket protocol. v0 covers the M1 core surface; resources still to be
 * added are listed in COVERAGE_TODO so the gap stays explicit.
 */
import { z } from 'zod';
import {
  AgeAssuranceRequest, AgeAssuranceResult, AvatarCompleteRequest, AvatarUploadRequest, City, ConsentRequest, District,
  EmailVerifyRequest, FriendCount, PasswordChangeRequest, HomeRegionRequest, LoginRequest, Me, OidcRequest, PasswordReset, PasswordResetRequest,
  PersonSummary, PrivacyRequestStatus, ProfilePatch, RefreshRequest, Session, SignupRequest, TokenPair, UploadTicket,
} from './account.ts';
import {
  Banner, BoostActivationStatus, BoostCatalog, InboxEntry, MediaUploadRequest, MediaUploadTicket, MuteRequest, MyBoost,
  Notification, NotificationPrefs, NotificationReadRequest, OneViewLease, PlusPlan, PlusStatus, PushTokenRequest,
  RenderedRequest, StoreProduct,
} from './catalog.ts';
import { Problem } from './common.ts';
import { ConversationView, MediaView, Message, ReceiptsRequest, SendMessageRequest, SyncResponse } from './conversation.ts';
import { ClientEvents, ServerEvents } from './realtime.ts';
import { ShuffleSampleRequest, ShuffleSampleResponse } from './shuffle.ts';
import { PublicProfile, ReportRequest, StartConversationRequest } from './social.ts';
import {
  BoostActivationRequest, BoostEntitlement, BoostQuote, BoostQuoteRequest, GoldGiftRequest,
  PurchaseVerifyRequest, Wallet, WalletTransaction,
} from './wallet.ts';

export const CONTRACT_VERSION = '0.1.0';

/** Named HTTP schemas → components.schemas. Response schemas are checked by the forbidden-field suite. */
export const REQUEST_SCHEMAS = {
  ShuffleSampleRequest, StartConversationRequest, SendMessageRequest, ReceiptsRequest, ReportRequest,
  GoldGiftRequest, PurchaseVerifyRequest, BoostQuoteRequest, BoostActivationRequest,
  SignupRequest, LoginRequest, OidcRequest, RefreshRequest, PasswordResetRequest, PasswordReset, EmailVerifyRequest, PasswordChangeRequest,
  AgeAssuranceRequest, ConsentRequest, HomeRegionRequest, ProfilePatch, AvatarUploadRequest, AvatarCompleteRequest,
  MuteRequest, MediaUploadRequest, RenderedRequest, NotificationReadRequest, PushTokenRequest, NotificationPrefsUpdate: NotificationPrefs,
} as const;
export const RESPONSE_SCHEMAS = {
  Problem, ShuffleSampleResponse, PublicProfile, ConversationView, Message, SyncResponse, MediaView,
  Wallet, WalletTransaction, BoostQuote, BoostEntitlement,
  TokenPair, Session, AgeAssuranceResult, Me, UploadTicket, PrivacyRequestStatus, City, District, PersonSummary, FriendCount,
  InboxEntry, MediaUploadTicket, OneViewLease, StoreProduct, PlusPlan, PlusStatus, BoostCatalog, BoostActivationStatus,
  MyBoost, Banner, Notification, NotificationPrefs,
} as const;

/**
 * Fields allowed ONLY in responses about the viewer themself (doc 07 §4 forbidden-field suite exceptions).
 * Never used on any response describing another user.
 */
export const SELF_ONLY_FIELD_ALLOWANCES: Partial<Record<keyof typeof RESPONSE_SCHEMAS, readonly string[]>> = {
  Me: ['email'],
  FriendCount: ['friend_count'], // served only under /v1/me/ (owner-only, REQ-SOC-05)
};

type SchemaName = keyof typeof REQUEST_SCHEMAS | keyof typeof RESPONSE_SCHEMAS;

interface Operation {
  method: 'get' | 'post' | 'put' | 'delete';
  /** 'list' = cursor pagination (`cursor`, `limit`); string[] = extra required query params. */
  query?: 'list' | readonly string[] | { list: true; required: readonly string[] };
  /** Unauthenticated (auth bootstrap only). */
  public?: boolean;
  path: string;
  operationId: string;
  summary: string;
  tag: string;
  request?: SchemaName;
  response: SchemaName | { array: SchemaName } | null; // null = 204
  status?: 200 | 201 | 204;
  idempotent?: boolean; // requires Idempotency-Key (doc 07 §1)
  errors: number[];
}

const CORE_OPERATIONS: Operation[] = [
  { method: 'post', path: '/v1/shuffle/sample', operationId: 'sampleShuffle', summary: 'Independent randomized discovery batch (Appendix A §6). Batch size is server-only.', tag: 'discovery', request: 'ShuffleSampleRequest', response: 'ShuffleSampleResponse', errors: [400, 401, 403, 429, 503] },
  { method: 'get', path: '/v1/profiles/{public_user_id}', operationId: 'getProfile', summary: 'Public profile with the oracle-free message action.', tag: 'social', response: 'PublicProfile', errors: [401, 404, 429] },
  { method: 'post', path: '/v1/conversations', operationId: 'startConversation', summary: 'Start a directional thread; the initiator is anonymous to the recipient.', tag: 'conversations', request: 'StartConversationRequest', response: 'ConversationView', status: 201, idempotent: true, errors: [400, 401, 403, 429] },
  { method: 'get', path: '/v1/conversations/{conversation_id}', operationId: 'getConversation', summary: 'Conversation via the counterparty projection.', tag: 'conversations', response: 'ConversationView', errors: [401, 404] },
  { method: 'post', path: '/v1/conversations/{conversation_id}/messages', operationId: 'sendMessage', summary: 'Durably commit a text message; idempotent on client_msg_id.', tag: 'conversations', request: 'SendMessageRequest', response: 'Message', status: 201, idempotent: true, errors: [400, 401, 403, 409, 429, 503] },
  { method: 'get', path: '/v1/conversations/{conversation_id}/messages', operationId: 'listMessages', summary: 'Page messages by seq.', tag: 'conversations', response: { array: 'Message' }, query: 'list', errors: [401, 404] },
  { method: 'post', path: '/v1/conversations/{conversation_id}/receipts', operationId: 'updateReceipts', summary: 'Monotonic delivered/read watermarks.', tag: 'conversations', request: 'ReceiptsRequest', response: null, status: 204, errors: [400, 401, 404] },
  { method: 'post', path: '/v1/conversations/{conversation_id}/reveal', operationId: 'revealIdentity', summary: 'Initiator irreversibly reveals identity (Profilimi Göster).', tag: 'conversations', response: 'ConversationView', idempotent: true, errors: [401, 403, 404] },
  { method: 'post', path: '/v1/conversations/{conversation_id}/block', operationId: 'blockByConversation', summary: 'Block the counterpart without knowing their id (shield if anonymous, DEC-02).', tag: 'safety', response: null, status: 204, idempotent: true, errors: [401, 404] },
  { method: 'get', path: '/v1/sync', operationId: 'sync', summary: 'Changed conversations since a sync version.', tag: 'conversations', response: 'SyncResponse', errors: [401] },
  { method: 'post', path: '/v1/reports', operationId: 'createReport', summary: 'Report a profile, conversation, message or media (no Gold needed).', tag: 'safety', request: 'ReportRequest', response: null, status: 204, idempotent: true, errors: [400, 401, 429] },
  { method: 'get', path: '/v1/media/{media_id}', operationId: 'getMedia', summary: 'Locked media state; the sender always gets access.', tag: 'media', response: 'MediaView', errors: [401, 404] },
  { method: 'post', path: '/v1/media/{media_id}/unlock', operationId: 'unlockMedia', summary: 'Spend Gold to unlock; never charged twice.', tag: 'media', response: 'MediaView', idempotent: true, errors: [401, 402, 404, 409, 503] },
  { method: 'get', path: '/v1/wallet', operationId: 'getWallet', summary: 'Available Gold balance.', tag: 'wallet', response: 'Wallet', errors: [401] },
  { method: 'get', path: '/v1/wallet/transactions', operationId: 'listWalletTransactions', summary: 'History with anonymity-safe counterparties.', tag: 'wallet', response: { array: 'WalletTransaction' }, query: 'list', errors: [401] },
  { method: 'post', path: '/v1/wallet/purchases/verify', operationId: 'verifyPurchase', summary: 'Server-verified, exactly-once Gold top-up.', tag: 'wallet', request: 'PurchaseVerifyRequest', response: 'Wallet', idempotent: true, errors: [400, 401, 409, 503] },
  { method: 'post', path: '/v1/conversations/{conversation_id}/gold-gifts', operationId: 'sendGoldGift', summary: 'Send exactly 1 Gold (no amount field exists).', tag: 'wallet', request: 'GoldGiftRequest', response: 'Wallet', status: 201, idempotent: true, errors: [401, 402, 403, 429, 503] },
  { method: 'post', path: '/v1/boosts/quotes', operationId: 'createBoostQuote', summary: 'Short-lived, versioned Gold quote with the mandatory disclosure.', tag: 'boost', request: 'BoostQuoteRequest', response: 'BoostQuote', status: 201, errors: [400, 401, 403] },
  { method: 'post', path: '/v1/boosts/activations', operationId: 'activateBoost', summary: 'Atomic Gold debit + entitlement; never a store payment.', tag: 'boost', request: 'BoostActivationRequest', response: 'BoostEntitlement', status: 201, idempotent: true, errors: [400, 401, 402, 409, 503] },
];

const op = (o: Operation) => o;
const REMAINING_OPERATIONS: Operation[] = [
  // auth (public bootstrap endpoints)
  op({ method: 'post', path: '/v1/auth/signup', operationId: 'signup', summary: 'Email/password sign-up (generic errors; no enumeration).', tag: 'auth', public: true, request: 'SignupRequest', response: 'TokenPair', status: 201, idempotent: true, errors: [400, 409, 429] }),
  op({ method: 'post', path: '/v1/auth/login', operationId: 'login', summary: 'Email/password login with progressive delays.', tag: 'auth', public: true, request: 'LoginRequest', response: 'TokenPair', errors: [400, 401, 429] }),
  op({ method: 'post', path: '/v1/auth/oidc/{provider}', operationId: 'oidcLogin', summary: 'Google/Apple sign-in; never auto-merges by email.', tag: 'auth', public: true, request: 'OidcRequest', response: 'TokenPair', errors: [400, 401, 409, 429] }),
  op({ method: 'post', path: '/v1/auth/refresh', operationId: 'refresh', summary: 'Rotate refresh token; reuse revokes the family.', tag: 'auth', public: true, request: 'RefreshRequest', response: 'TokenPair', errors: [401, 429] }),
  op({ method: 'post', path: '/v1/auth/logout', operationId: 'logout', summary: 'Revoke the current session and its push tokens.', tag: 'auth', response: null, status: 204, errors: [401] }),
  op({ method: 'post', path: '/v1/auth/password/reset-request', operationId: 'requestPasswordReset', summary: 'Always 204 (no account enumeration).', tag: 'auth', public: true, request: 'PasswordResetRequest', response: null, status: 204, errors: [400, 429] }),
  op({ method: 'post', path: '/v1/auth/password/reset', operationId: 'resetPassword', summary: 'Set a new password with a reset token.', tag: 'auth', public: true, request: 'PasswordReset', response: null, status: 204, errors: [400, 401, 429] }),
  op({ method: 'post', path: '/v1/auth/email/resend', operationId: 'resendEmailCode', summary: 'Send a fresh 6-digit code (rate-limited).', tag: 'auth', response: null, status: 204, errors: [401, 429] }),
  op({ method: 'post', path: '/v1/me/password', operationId: 'changePassword', summary: 'Re-checks the current password; signs out every other session.', tag: 'account', request: 'PasswordChangeRequest', response: null, status: 204, errors: [400, 401, 429] }),
  op({ method: 'post', path: '/v1/auth/email/verify', operationId: 'verifyEmail', summary: 'Confirm email with a 6-digit code.', tag: 'auth', request: 'EmailVerifyRequest', response: null, status: 204, errors: [400, 401, 429] }),
  op({ method: 'get', path: '/v1/me/sessions', operationId: 'listSessions', summary: 'Own sessions and devices.', tag: 'account', response: { array: 'Session' }, errors: [401] }),
  op({ method: 'delete', path: '/v1/me/sessions/{session_id}', operationId: 'revokeSession', summary: 'Revoke one session.', tag: 'account', response: null, status: 204, errors: [401, 404] }),
  op({ method: 'post', path: '/v1/me/sessions/revoke-all', operationId: 'revokeAllSessions', summary: 'Sign out everywhere (step-up required).', tag: 'account', response: null, status: 204, idempotent: true, errors: [401, 403] }),
  // onboarding
  op({ method: 'post', path: '/v1/onboarding/age-assurance', operationId: 'assureAge', summary: '18+ check; DOB is discarded after evaluation (DEC-06).', tag: 'account', request: 'AgeAssuranceRequest', response: 'AgeAssuranceResult', errors: [400, 401, 429] }),
  op({ method: 'post', path: '/v1/onboarding/consents', operationId: 'acceptConsents', summary: 'Versioned consents; marketing separate.', tag: 'account', request: 'ConsentRequest', response: null, status: 204, idempotent: true, errors: [400, 401] }),
  op({ method: 'post', path: '/v1/onboarding/home-region', operationId: 'setInitialHomeRegion', summary: 'First home region; starts the 30-day clock.', tag: 'account', request: 'HomeRegionRequest', response: 'Me', idempotent: true, errors: [400, 401, 409] }),
  // me
  op({ method: 'get', path: '/v1/me', operationId: 'getMe', summary: 'Own account.', tag: 'account', response: 'Me', errors: [401] }),
  op({ method: 'post', path: '/v1/me/profile', operationId: 'updateProfile', summary: 'Edit display name / bio (gender is support-only).', tag: 'account', request: 'ProfilePatch', response: 'Me', errors: [400, 401] }),
  op({ method: 'put', path: '/v1/me/home-region', operationId: 'changeHomeRegion', summary: '30-day rule + active-Boost lock (A§8.4).', tag: 'account', request: 'HomeRegionRequest', response: 'Me', idempotent: true, errors: [400, 401, 409] }),
  op({ method: 'post', path: '/v1/me/avatar/uploads', operationId: 'createAvatarUpload', summary: 'Presigned POST policy for the square source crop.', tag: 'account', request: 'AvatarUploadRequest', response: 'UploadTicket', status: 201, errors: [400, 401, 429] }),
  op({ method: 'post', path: '/v1/me/avatar/uploads/{upload_id}/complete', operationId: 'completeAvatarUpload', summary: 'Server re-encode + moderation; previous avatar kept until READY.', tag: 'account', request: 'AvatarCompleteRequest', response: 'Me', idempotent: true, errors: [400, 401, 404] }),
  op({ method: 'delete', path: '/v1/me/avatar', operationId: 'deleteAvatar', summary: 'Remove own avatar.', tag: 'account', response: null, status: 204, errors: [401] }),
  op({ method: 'post', path: '/v1/me/export', operationId: 'requestExport', summary: 'KVKK data export (counterparts as aliases, DEC-19).', tag: 'account', response: 'PrivacyRequestStatus', status: 201, idempotent: true, errors: [401, 429] }),
  op({ method: 'post', path: '/v1/me/deletion', operationId: 'requestDeletion', summary: 'Schedule account deletion (step-up).', tag: 'account', response: 'PrivacyRequestStatus', status: 201, idempotent: true, errors: [401, 403] }),
  op({ method: 'get', path: '/v1/me/deletion', operationId: 'getDeletion', summary: 'Deletion status.', tag: 'account', response: 'PrivacyRequestStatus', errors: [401, 404] }),
  // geo & people
  op({ method: 'get', path: '/v1/geo/cities', operationId: 'listCities', summary: 'Enabled cities.', tag: 'geo', response: { array: 'City' }, errors: [401] }),
  op({ method: 'get', path: '/v1/geo/cities/{city_id}/districts', operationId: 'listDistricts', summary: 'Districts of a city.', tag: 'geo', response: { array: 'District' }, errors: [401, 404] }),
  op({ method: 'get', path: '/v1/search/users', operationId: 'searchUsers', summary: 'Prefix handle search; throttled, block-aware, not personalised.', tag: 'social', query: ['q'], response: { array: 'PersonSummary' }, errors: [400, 401, 429] }),
  op({ method: 'put', path: '/v1/follows/{public_user_id}', operationId: 'follow', summary: 'Idempotent follow; mutual follow reveals (REQ-SOC-06).', tag: 'social', response: null, status: 204, errors: [401, 403, 429] }),
  op({ method: 'delete', path: '/v1/follows/{public_user_id}', operationId: 'unfollow', summary: 'Unfollow (never un-reveals).', tag: 'social', response: null, status: 204, errors: [401] }),
  op({ method: 'put', path: '/v1/likes/{public_user_id}', operationId: 'like', summary: 'Irreversible like (no DELETE route exists).', tag: 'social', response: null, status: 204, errors: [401, 403, 429] }),
  op({ method: 'put', path: '/v1/blocks/{public_user_id}', operationId: 'blockProfile', summary: 'Full block from a profile.', tag: 'safety', response: null, status: 204, idempotent: true, errors: [401, 404] }),
  op({ method: 'delete', path: '/v1/blocks/{public_user_id}', operationId: 'unblockProfile', summary: 'Unblock (no auto-restore; a retained shield stays).', tag: 'safety', response: null, status: 204, errors: [401, 404] }),
  op({ method: 'get', path: '/v1/me/blocks', operationId: 'listBlocks', summary: 'Own FULL blocks (shields are never listed with identity).', tag: 'safety', response: { array: 'PersonSummary' }, query: 'list', errors: [401] }),
  op({ method: 'get', path: '/v1/me/following', operationId: 'listFollowing', summary: 'Whom I follow (owner only).', tag: 'social', response: { array: 'PersonSummary' }, query: 'list', errors: [401] }),
  op({ method: 'get', path: '/v1/me/friends', operationId: 'listFriends', summary: 'Mutual follows (owner only, REQ-SOC-05).', tag: 'social', response: { array: 'PersonSummary' }, query: 'list', errors: [401] }),
  op({ method: 'get', path: '/v1/me/friends/count', operationId: 'getFriendCount', summary: 'Own friend count (owner only).', tag: 'social', response: 'FriendCount', errors: [401] }),
  // inbox & conversation actions
  op({ method: 'get', path: '/v1/inbox', operationId: 'listInbox', summary: 'Main / requests / archived.', tag: 'conversations', query: { list: true, required: ['filter'] }, response: { array: 'InboxEntry' }, errors: [400, 401] }),
  op({ method: 'get', path: '/v1/inbox/search', operationId: 'searchInbox', summary: 'Searches text and viewer-visible labels only.', tag: 'conversations', query: { list: true, required: ['q'] }, response: { array: 'InboxEntry' }, errors: [400, 401, 429] }),
  op({ method: 'post', path: '/v1/conversations/{conversation_id}/accept', operationId: 'acceptRequest', summary: 'Move a request to the main inbox.', tag: 'conversations', response: 'ConversationView', idempotent: true, errors: [401, 404, 409] }),
  op({ method: 'post', path: '/v1/conversations/{conversation_id}/reject', operationId: 'rejectRequest', summary: 'Reject; 30-day restart cooldown for the initiator (DEC-17).', tag: 'conversations', response: 'ConversationView', idempotent: true, errors: [401, 404, 409] }),
  op({ method: 'post', path: '/v1/conversations/{conversation_id}/archive', operationId: 'archiveConversation', summary: 'Archive.', tag: 'conversations', response: 'ConversationView', errors: [401, 404] }),
  op({ method: 'post', path: '/v1/conversations/{conversation_id}/unarchive', operationId: 'unarchiveConversation', summary: 'Unarchive.', tag: 'conversations', response: 'ConversationView', errors: [401, 404] }),
  op({ method: 'post', path: '/v1/conversations/{conversation_id}/mute', operationId: 'muteConversation', summary: 'Mute until a time (null = unmute).', tag: 'conversations', request: 'MuteRequest', response: 'ConversationView', errors: [400, 401, 404] }),
  // chat media
  op({ method: 'post', path: '/v1/conversations/{conversation_id}/media/uploads', operationId: 'createMediaUpload', summary: 'Presigned upload into quarantine.', tag: 'media', request: 'MediaUploadRequest', response: 'MediaUploadTicket', status: 201, errors: [400, 401, 403, 429] }),
  op({ method: 'post', path: '/v1/media/{media_id}/complete', operationId: 'completeMediaUpload', summary: 'Scan + re-encode; the PHOTO message posts when READY.', tag: 'media', response: 'MediaView', idempotent: true, errors: [401, 404, 409] }),
  op({ method: 'post', path: '/v1/media/{media_id}/open', operationId: 'openOneView', summary: 'One-view lease with a proxied single-use URL.', tag: 'media', response: 'OneViewLease', idempotent: true, errors: [401, 403, 404, 409] }),
  op({ method: 'post', path: '/v1/media/{media_id}/rendered', operationId: 'confirmRendered', summary: 'Consume a one-view after successful render.', tag: 'media', request: 'RenderedRequest', response: 'MediaView', idempotent: true, errors: [400, 401, 404, 409] }),
  // store, Plus, Boost
  op({ method: 'get', path: '/v1/store/products', operationId: 'listStoreProducts', summary: 'Gold packs for this platform.', tag: 'wallet', query: ['platform'], response: { array: 'StoreProduct' }, errors: [400, 401] }),
  op({ method: 'get', path: '/v1/plus/plans', operationId: 'listPlusPlans', summary: 'Plus plans with honest benefit keys.', tag: 'plus', response: { array: 'PlusPlan' }, errors: [401] }),
  op({ method: 'post', path: '/v1/plus/verify', operationId: 'verifyPlus', summary: 'Server-verified subscription purchase.', tag: 'plus', request: 'PurchaseVerifyRequest', response: 'PlusStatus', idempotent: true, errors: [400, 401, 409, 503] }),
  op({ method: 'get', path: '/v1/me/plus', operationId: 'getPlusStatus', summary: 'Own Plus status.', tag: 'plus', response: 'PlusStatus', errors: [401] }),
  op({ method: 'get', path: '/v1/boosts/catalog', operationId: 'getBoostCatalog', summary: 'Packages the viewer may buy + mandatory disclosure.', tag: 'boost', response: 'BoostCatalog', errors: [401] }),
  op({ method: 'get', path: '/v1/boosts/activations/{idempotency_key}', operationId: 'getBoostActivation', summary: 'Poll an activation after a timeout (A§8.7).', tag: 'boost', response: 'BoostActivationStatus', errors: [401, 404] }),
  op({ method: 'get', path: '/v1/me/boost', operationId: 'getMyBoost', summary: 'Own active Boost (never other users’).', tag: 'boost', response: 'MyBoost', errors: [401] }),
  // home & notifications
  op({ method: 'get', path: '/v1/home/banners', operationId: 'listBanners', summary: 'Scheduled banners; allowlisted destinations; sponsored flag.', tag: 'home', query: ['placement'], response: { array: 'Banner' }, errors: [400, 401] }),
  op({ method: 'get', path: '/v1/notifications', operationId: 'listNotifications', summary: 'Notification centre (generic copy).', tag: 'notifications', response: { array: 'Notification' }, query: 'list', errors: [401] }),
  op({ method: 'post', path: '/v1/notifications/read', operationId: 'markNotificationsRead', summary: 'Mark read up to an id.', tag: 'notifications', request: 'NotificationReadRequest', response: null, status: 204, errors: [400, 401] }),
  op({ method: 'put', path: '/v1/me/devices/{installation_id}/push-token', operationId: 'registerPushToken', summary: 'Register/rotate a push token bound to the session.', tag: 'notifications', request: 'PushTokenRequest', response: null, status: 204, errors: [400, 401] }),
  op({ method: 'delete', path: '/v1/me/devices/{installation_id}/push-token', operationId: 'deletePushToken', summary: 'Remove a push token.', tag: 'notifications', response: null, status: 204, errors: [401] }),
  op({ method: 'get', path: '/v1/me/notification-preferences', operationId: 'getNotificationPrefs', summary: 'Topics, quiet hours, preview.', tag: 'notifications', response: 'NotificationPrefs', errors: [401] }),
  op({ method: 'put', path: '/v1/me/notification-preferences', operationId: 'setNotificationPrefs', summary: 'Update preferences (security/moderation always on).', tag: 'notifications', request: 'NotificationPrefsUpdate', response: 'NotificationPrefs', errors: [400, 401] }),
];

export const OPERATIONS: Operation[] = [...CORE_OPERATIONS, ...REMAINING_OPERATIONS];

/** Array responses that are naturally bounded and therefore not cursor-paginated (rules/backend-data.md). */
export const BOUNDED_LISTS: Readonly<Record<string, string>> = {
  listSessions: 'max ~10 devices per account (oldest evicted)',
  listCities: 'reference data, < 100 rows',
  listDistricts: 'reference data, < 100 rows per city',
  searchUsers: 'server caps results at 20',
  listStoreProducts: 'catalog, < 20 rows',
  listPlusPlans: 'catalog, < 5 rows',
  listBanners: 'scheduled campaigns per placement, < 10 rows',
};

/** v1 public surface is complete; the staff API is a separate document (doc 15, M7). */
export const COVERAGE_TODO = ['admin-api (separate document, M7)'];

const TAG_DESCRIPTIONS: Record<string, string> = {
  account: 'Own account, onboarding, sessions, avatar, privacy requests',
  auth: 'Sign-up, login, OIDC, token rotation, password reset (ADR-007)',
  geo: 'City and district reference data',
  home: 'Admin-operated home banners',
  notifications: 'Notification centre, push tokens and preferences (doc 09)',
  plus: 'Plus subscription plans and status',
  boost: 'Gold-funded Boost quotes and activation (Appendix A §8.7)',
  conversations: 'Directional anonymous threads, messages, receipts and sync (doc 08)',
  discovery: 'Shuffle sampling (Appendix A)',
  media: 'Locked chat photos and Gold unlocks (master §6)',
  safety: 'Blocking and reporting',
  social: 'Profiles and relationships',
  wallet: 'Gold balance, history, top-ups and 1-Gold gifts (doc 12)',
};

const jsonSchema = (s: z.ZodType, io: 'input' | 'output') => {
  const { $schema: _drop, ...rest } = z.toJSONSchema(s, { io, unrepresentable: 'throw' }) as Record<string, unknown>;
  return rest;
};
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

export function buildOpenApi(): Record<string, unknown> {
  const schemas: Record<string, unknown> = {};
  for (const [name, s] of Object.entries(REQUEST_SCHEMAS)) schemas[name] = jsonSchema(s, 'input');
  for (const [name, s] of Object.entries(RESPONSE_SCHEMAS)) schemas[name] = jsonSchema(s, 'output');

  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    const params = [...op.path.matchAll(/\{([a-z_]+)\}/g)].map(([, name]) => ({ name, in: 'path', required: true, schema: { type: 'string' } }));
    if (op.idempotent) params.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } as never });
    const paginated = op.query === 'list' || (typeof op.query === 'object' && 'list' in op.query);
    const requiredQuery = Array.isArray(op.query) ? op.query : typeof op.query === 'object' && 'required' in op.query ? op.query.required : [];
    for (const q of requiredQuery) params.push({ name: q, in: 'query', required: true, schema: { type: 'string' } } as never);
    if (paginated) {
      params.push({ name: 'cursor', in: 'query', required: false, schema: { type: 'string' } } as never);
      params.push({ name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } } as never);
    }
    const status = String(op.status ?? 200);
    const success = op.response === null
      ? { description: 'No content' }
      : { description: 'OK', content: { 'application/json': { schema: typeof op.response === 'string' ? ref(op.response) : { type: 'array', items: ref(op.response.array) } } } };
    const responses: Record<string, unknown> = { [status]: success };
    for (const code of op.errors) {
      responses[String(code)] = { description: 'Problem', content: { 'application/problem+json': { schema: ref('Problem') } } };
    }
    (paths[op.path] ??= {})[op.method] = {
      operationId: op.operationId,
      summary: op.summary,
      tags: [op.tag],
      security: op.public ? [] : [{ bearer: [] }],
      ...(params.length ? { parameters: params } : {}),
      ...(op.request ? { requestBody: { required: true, content: { 'application/json': { schema: ref(op.request) } } } } : {}),
      responses,
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'FLERO Public API',
      version: CONTRACT_VERSION,
      description: 'Generated from packages/contracts (Zod). Do not edit by hand. v0: complete public v1 surface; admin API is a separate document.',
      license: { name: 'Proprietary', identifier: 'LicenseRef-Proprietary' },
    },
    servers: [{ url: 'https://api.flero.example', description: 'placeholder until DEC-07 hosting is provisioned' }],
    security: [{ bearer: [] }],
    tags: [...new Set(OPERATIONS.map((o) => o.tag))].sort().map((name) => ({ name, description: TAG_DESCRIPTIONS[name] ?? name })),
    paths,
    components: { schemas, securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
  };
}

export function buildAsyncApi(): Record<string, unknown> {
  const messages: Record<string, unknown> = {};
  const schemas: Record<string, unknown> = {};
  const serverToClient: Record<string, unknown> = {};
  const clientToServer: Record<string, unknown> = {};
  const add = (dir: 'server' | 'client', name: string, s: z.ZodType) => {
    const id = `${dir}_${name.replace(/\./g, '_')}`;
    schemas[id] = jsonSchema(s, dir === 'server' ? 'output' : 'input');
    messages[id] = { name, payload: { $ref: `#/components/schemas/${id}` } };
    (dir === 'server' ? serverToClient : clientToServer)[id] = { $ref: `#/components/messages/${id}` };
  };
  for (const [name, s] of Object.entries(ServerEvents)) add('server', name, s);
  for (const [name, s] of Object.entries(ClientEvents)) add('client', name, s);

  return {
    asyncapi: '3.0.0',
    info: { title: 'FLERO Realtime Protocol', version: CONTRACT_VERSION, description: 'Generated from packages/contracts. One implicit per-user channel; first frame must be auth within 5 s.' },
    servers: { production: { host: 'rt.flero.example', pathname: '/v1', protocol: 'wss' } },
    channels: {
      userEvents: { address: '/v1', messages: { ...serverToClient, ...clientToServer } },
    },
    operations: {
      receiveServerEvents: { action: 'receive', channel: { $ref: '#/channels/userEvents' }, security: [{ $ref: '#/components/securitySchemes/firstFrameToken' }], messages: Object.keys(serverToClient).map((id) => ({ $ref: `#/channels/userEvents/messages/${id}` })) },
      sendClientEvents: { action: 'send', channel: { $ref: '#/channels/userEvents' }, security: [{ $ref: '#/components/securitySchemes/firstFrameToken' }], messages: Object.keys(clientToServer).map((id) => ({ $ref: `#/channels/userEvents/messages/${id}` })) },
    },
    components: {
      schemas,
      messages,
      securitySchemes: {
        firstFrameToken: { type: 'apiKey', in: 'user', description: 'Short-lived access JWT sent in the first `auth` frame (never in the URL); refreshed with `reauth`.' },
      },
    },
  };
}
