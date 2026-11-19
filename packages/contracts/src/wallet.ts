import { z } from 'zod';
import { BoostId, LabelKey, Timestamp, TransactionId } from './common.ts';
import { Counterparty } from './conversation.ts';

export const Wallet = z.strictObject({
  available: z.int().min(0),
  restricted: z.boolean(), // debt / hold / frozen explained via restriction_key, never amounts of others
  restriction_key: LabelKey.nullable(),
});

/** 1-Gold gift (REQ-GLD-05): the body is intentionally EMPTY — there is no amount field to tamper with. */
export const GoldGiftRequest = z.strictObject({});

export const WalletTransaction = z.strictObject({
  transaction_id: TransactionId,
  kind: z.enum(['TOP_UP', 'GIFT_SENT', 'GIFT_RECEIVED', 'UNLOCK', 'BOOST', 'BONUS', 'PROMO', 'GRANT', 'COMPENSATION', 'REVERSAL']),
  amount: z.int(), // signed, from the viewer's perspective
  counterparty: Counterparty.nullable(), // via counterpartyView: "Anonim Kullanıcı" in anonymous threads (REQ-GLD-08)
  created_at: Timestamp,
});

export const PurchaseVerifyRequest = z.strictObject({
  platform: z.enum(['APPLE', 'GOOGLE']),
  signed_payload: z.string().min(16).max(20_000),
});

export const BoostQuoteRequest = z.strictObject({
  package_id: z.int().min(1),
  scope: z.enum(['DISTRICT', 'CITY']), // target is always resolved server-side from the home region
});

/** Mandatory, identical disclosure on every quote (A§8.8, T100): no sparse flag, no audience size. */
export const BOOST_DISCLOSURE_KEYS = ['boost.disclosure.viewer_dependent', 'boost.disclosure.no_guarantee'] as const;

export const BoostQuote = z.strictObject({
  quote_id: z.uuid(),
  scope: z.enum(['DISTRICT', 'CITY']),
  target_city_label_key: LabelKey,
  target_district_label_key: LabelKey.nullable(),
  price_gold: z.int().min(1),
  duration_seconds: z.int().min(60),
  available_gold: z.int().min(0),
  survives_plus_expiry: z.literal(true),
  quote_expires_at: Timestamp,
  disclosure_keys: z.tuple([z.literal(BOOST_DISCLOSURE_KEYS[0]), z.literal(BOOST_DISCLOSURE_KEYS[1])]),
});

export const BoostActivationRequest = z.strictObject({ quote_id: z.uuid() });

export const BoostEntitlement = z.strictObject({
  boost_id: BoostId,
  scope: z.enum(['DISTRICT', 'CITY']),
  target_city_label_key: LabelKey,
  target_district_label_key: LabelKey.nullable(),
  starts_at: Timestamp,
  ends_at: Timestamp,
  price_gold: z.int().min(1),
  balance_after: z.int().min(0),
});
