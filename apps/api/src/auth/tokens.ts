import { createPrivateKey, createPublicKey, randomBytes, randomUUID } from 'node:crypto';
import { generateKeyPair, importPKCS8, importSPKI, jwtVerify, SignJWT, type CryptoKey } from 'jose';
import type { Config } from '../config.ts';
import type { Tx } from '../db.ts';
import { err } from '../errors.ts';
import { sha256 } from '../ids.ts';

export interface AccessClaims { sub: string; sid: string; aid: number; exp?: number }

/**
 * Access tokens: short-lived EdDSA JWTs. Refresh tokens: opaque 256-bit, stored only as SHA-256, rotated on every
 * use; re-use of a spent token revokes the session (family) — ADR-007.
 */
export class TokenService {
  private readonly signingKey: CryptoKey;
  private readonly pub: CryptoKey;
  private readonly cfg: Config;
  private constructor(signingKey: CryptoKey, pub: CryptoKey, cfg: Config) {
    this.signingKey = signingKey;
    this.pub = pub;
    this.cfg = cfg;
  }

  static async create(cfg: Config): Promise<TokenService> {
    if (cfg.JWT_PRIVATE_KEY_PEM) {
      const key = await importPKCS8(cfg.JWT_PRIVATE_KEY_PEM, 'EdDSA');
      const spki = createPublicKey(createPrivateKey(cfg.JWT_PRIVATE_KEY_PEM)).export({ type: 'spki', format: 'pem' }).toString();
      return new TokenService(key, await importSPKI(spki, 'EdDSA'), cfg);
    }
    // development/test: ephemeral key; tokens die with the process
    const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    return new TokenService(privateKey, publicKey, cfg);
  }

  signAccess(c: AccessClaims): Promise<string> {
    return new SignJWT({ sid: c.sid, aid: c.aid })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setSubject(c.sub)
      .setIssuer(this.cfg.JWT_ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${this.cfg.ACCESS_TTL_SECONDS}s`)
      .sign(this.signingKey);
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.pub, { issuer: this.cfg.JWT_ISSUER, algorithms: ['EdDSA'] });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || typeof payload.aid !== 'number') throw new Error('claims');
      return { sub: payload.sub, sid: payload.sid, aid: payload.aid, ...(typeof payload.exp === 'number' ? { exp: payload.exp } : {}) };
    } catch {
      throw err.unauthenticated();
    }
  }

  /** New session + first refresh token (family root). */
  async issue(tx: Tx, accountId: number, publicUserId: string, platform: string | null) {
    const sid = randomUUID();
    await tx.query('INSERT INTO app.session (id, account_id, platform) VALUES ($1, $2, $3)', [sid, accountId, platform]);
    const refresh = await this.newRefresh(tx, sid, randomUUID(), null);
    return { sid, refresh, access: await this.signAccess({ sub: publicUserId, sid, aid: accountId }) };
  }

  /** Rotation with reuse detection, inside the caller's transaction (token row locked). */
  async rotate(tx: Tx, presented: string) {
    const hash = sha256(presented);
    const { rows } = await tx.query<{ session_id: string; family_id: string; used_at: Date | null; expires_at: Date; revoked_at: Date | null; account_id: number; public_id: string; state: string }>(
      `SELECT r.session_id, r.family_id, r.used_at, r.expires_at, s.revoked_at, a.id AS account_id, a.public_id, a.state
         FROM app.refresh_token r JOIN app.session s ON s.id = r.session_id JOIN app.account a ON a.id = s.account_id
        WHERE r.token_hash = $1 FOR UPDATE OF r`,
      [hash],
    );
    const row = rows[0];
    if (!row || row.revoked_at || row.expires_at.getTime() <= Date.now() || row.state !== 'ACTIVE') throw err.unauthenticated();
    if (row.used_at) {
      await tx.query('UPDATE app.session SET revoked_at = now() WHERE id = $1', [row.session_id]); // probable theft
      return { reused: true as const };
    }
    await tx.query('UPDATE app.refresh_token SET used_at = now() WHERE token_hash = $1', [hash]);
    await tx.query('UPDATE app.session SET last_seen_at = now() WHERE id = $1', [row.session_id]);
    const refresh = await this.newRefresh(tx, row.session_id, row.family_id, hash);
    const access = await this.signAccess({ sub: row.public_id, sid: row.session_id, aid: row.account_id });
    return { reused: false as const, sid: row.session_id, refresh, access, accountId: row.account_id };
  }

  private async newRefresh(tx: Tx, sid: string, family: string, parent: Buffer | null): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await tx.query(
      `INSERT INTO app.refresh_token (token_hash, session_id, family_id, parent_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))`,
      [sha256(token), sid, family, parent, this.cfg.REFRESH_TTL_DAYS],
    );
    return token;
  }
}
