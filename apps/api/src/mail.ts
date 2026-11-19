/**
 * Transactional e-mail. INTEGRATION STUB (doc 21): production plugs in an SES/Postmark sender behind this
 * interface. The dev mailer never sends anything; it logs a redacted line and keeps the last messages in memory
 * so tests (and a developer on localhost) can complete the flows. Templates are Turkish-first.
 */
export interface Mail { to: string; template: 'password_reset' | 'email_code' | 'password_changed'; vars: Record<string, string> }
export interface Mailer { send(m: Mail): Promise<void> }

/** Production placeholder until the e-mail integration exists: fails loudly (503) instead of pretending. */
export const errUnconfiguredMailer: Mailer = {
  async send() { const { err } = await import('./errors.ts'); throw err.retryable(); },
};

export class DevMailer implements Mailer {
  readonly sent: Mail[] = [];
  private readonly log: boolean;
  constructor(log = true) { this.log = log; }
  async send(m: Mail) {
    this.sent.push(m);
    if (this.sent.length > 100) this.sent.shift();
    // never log secrets in production; this class is refused there (see index.ts)
    if (this.log) console.info(`[dev-mail] ${m.template} → ${m.to.replace(/^(.).*(@.*)$/, '$1***$2')} ${JSON.stringify(m.vars)}`);
  }
  last(to: string, template: Mail['template']) { return [...this.sent].reverse().find((m) => m.to === to && m.template === template); }
}
