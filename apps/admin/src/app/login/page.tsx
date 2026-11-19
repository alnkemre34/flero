'use client';

import { Loader2, LockKeyhole } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: f.get('email'), password: f.get('password'), remember: f.get('remember') === 'on' }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) { setError(res?.status === 401 ? 'E-posta veya şifre hatalı.' : 'Sunucuya ulaşılamıyor. Biraz sonra tekrar deneyin.'); return; }
    const next = params.get('next');
    router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
  }

  return (
    <form onSubmit={submit} className="card" style={{ width: 'min(400px, 100%)', padding: 28, display: 'grid', gap: 16 }} noValidate>
      <div className="brand" style={{ padding: 0 }}><span className="brand-mark" aria-hidden>F</span><span>FLERO<br /><small>Yönetim paneli</small></span></div>
      <div>
        <h1 style={{ margin: 0, font: '700 22px/1.2 var(--font-display)', letterSpacing: '-0.02em' }}>Ekip girişi</h1>
        <p className="muted" style={{ margin: '6px 0 0' }}>Bu alan yalnızca yetkili FLERO ekibi içindir. Tüm işlemler denetim kaydına yazılır.</p>
      </div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      <div className="field"><label htmlFor="email">E-posta</label><input id="email" name="email" type="email" autoComplete="username" required className="input" aria-invalid={!!error} /></div>
      <div className="field"><label htmlFor="password">Şifre</label><input id="password" name="password" type="password" autoComplete="current-password" required className="input" aria-invalid={!!error} /></div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minHeight: 32 }}>
          <input type="checkbox" name="remember" defaultChecked style={{ width: 17, height: 17, accentColor: 'var(--brand)' }} />Beni hatırla
        </label>
        <span className="muted" style={{ fontSize: 12 }}>Şifrenizi mi unuttunuz? Süper yöneticiye başvurun.</span>
      </div>
      <button className="btn btn-primary" style={{ minHeight: 42 }} disabled={busy} aria-busy={busy || undefined}>
        {busy ? <Loader2 size={16} className="spin" aria-hidden /> : <LockKeyhole size={16} aria-hidden />}Giriş yap
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16, background: 'radial-gradient(1200px 600px at 20% -10%, color-mix(in srgb, var(--brand) 9%, transparent), transparent 60%), var(--bg)' }}>
      <Suspense><LoginForm /></Suspense>
    </main>
  );
}
