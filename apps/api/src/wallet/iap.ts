import { z } from 'zod';
import { err } from '../errors.ts';

export type Store = 'APPLE' | 'GOOGLE';

/** What a store-verified purchase tells us. Never trust the client for any of these fields. */
export interface VerifiedPurchase {
  storeTxnId: string;
  originalTxnId: string; // subscriptions: stable across renewals
  productId: string;
  expiresAt: Date | null; // subscriptions only
}

export interface PurchaseVerifier {
  verify(store: Store, signedPayload: string): Promise<VerifiedPurchase>;
}

/**
 * INTEGRATION STUB (doc 21): the real verifiers call the App Store Server API (JWS, x5c chain) and the Google Play
 * Developer API. Until those credentials exist, non-production builds accept a "dev." payload so the whole engine
 * (exactly-once credit, renewals, chargebacks) is exercised end-to-end. Production refuses: 503, never a free credit.
 */
const DevPayload = z.strictObject({
  store_txn_id: z.string().min(1).max(100),
  original_txn_id: z.string().min(1).max(100).optional(),
  product_id: z.string().min(1).max(100),
  expires_at: z.iso.datetime({ offset: true }).optional(),
});

export class DevPurchaseVerifier implements PurchaseVerifier {
  private readonly production: boolean;
  constructor(production: boolean) { this.production = production; }
  async verify(_store: Store, signedPayload: string): Promise<VerifiedPurchase> {
    if (this.production) throw err.retryable();
    if (!signedPayload.startsWith('dev.')) throw err.validation({ field: 'signed_payload' });
    let json: unknown;
    try {
      json = JSON.parse(Buffer.from(signedPayload.slice(4), 'base64url').toString('utf8'));
    } catch {
      throw err.validation({ field: 'signed_payload' });
    }
    const p = DevPayload.safeParse(json);
    if (!p.success) throw err.validation({ field: 'signed_payload' });
    return {
      storeTxnId: p.data.store_txn_id, originalTxnId: p.data.original_txn_id ?? p.data.store_txn_id,
      productId: p.data.product_id, expiresAt: p.data.expires_at ? new Date(p.data.expires_at) : null,
    };
  }
}

/** Test/dev helper: builds a payload the dev verifier accepts. */
export const devPayload = (p: z.input<typeof DevPayload>) => `dev.${Buffer.from(JSON.stringify(p)).toString('base64url')}`;
