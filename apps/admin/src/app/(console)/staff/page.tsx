'use client';

import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { PageHead } from '@/components/shell';
import { Button, Dialog, ErrorState, Field, SkeletonRows, useData, useToast } from '@/components/ui';
import { api, ApiError, fmt } from '@/lib/api';

interface Staff { id: number; email: string; display_name: string; roles: string[]; disabled_at: string | null; created_at: string }
const ROLES: [string, string][] = [
  ['SUPERADMIN', 'Süper yönetici'], ['MODERATOR', 'Moderatör'], ['SENIOR_MODERATOR', 'Kıdemli moderatör'], ['SUPPORT_L1', 'Destek'],
  ['FINANCE_OPERATOR', 'Finans (talep)'], ['FINANCE_APPROVER', 'Finans (onay)'], ['FINANCE_VIEWER', 'Finans (görüntüleme)'],
  ['PRODUCT_CONFIG_EDITOR', 'Ürün / fiyat editörü'], ['GROWTH', 'Büyüme (banner)'], ['AUDITOR', 'Denetçi'],
];

export default function StaffPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useData(() => api<Staff[]>('staff').then((r) => r.data), []);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ email: '', display_name: '', password: '', roles: ['MODERATOR'] as string[] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function create() {
    if (f.password.length < 12) { setErr('Şifre en az 12 karakter olmalı.'); return; }
    setBusy(true); setErr(null);
    try { await api('staff', { method: 'POST', body: f }); toast('success', 'Ekip üyesi eklendi.'); setOpen(false); reload(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Eklenemedi.'); } finally { setBusy(false); }
  }
  const label = (r: string) => ROLES.find(([v]) => v === r)?.[1] ?? r;
  return (
    <>
      <PageHead title="Ekip" description="Rol tabanlı yetki: her kişiye yalnızca işi için gereken rolleri verin. Finans talebi ve onayı farklı kişilerde olmalı."
        actions={<button className="btn btn-primary" onClick={() => { setErr(null); setOpen(true); }}><UserPlus size={16} aria-hidden />Üye ekle</button>} />
      {error && <ErrorState error={error} retry={reload} />}
      <div className="card table-wrap">
        <table className="stack"><thead><tr><th>Ad</th><th>Roller</th><th>Eklenme</th></tr></thead>
          {loading && !data ? <SkeletonRows cols={3} /> : <tbody>{data?.map((s) => (
            <tr key={s.id}><td className="cell-main">{s.display_name}<div className="cell-sub">{s.email}</div></td>
              <td data-label="Roller">{s.roles.map((r) => <span key={r} className={`badge ${r === 'SUPERADMIN' ? 'b-brand' : ''}`} style={{ marginRight: 4 }}>{label(r)}</span>)}</td>
              <td data-label="Eklenme" className="muted">{fmt.date(s.created_at)}</td></tr>))}</tbody>}
        </table>
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title="Ekip üyesi ekle" description="Üretimde giriş SSO + donanım anahtarı (WebAuthn) ile korunur."
        footer={<><button className="btn btn-ghost" onClick={() => setOpen(false)}>Vazgeç</button><Button className="btn-primary" busy={busy} onClick={create}>Ekle</Button></>}>
        {err && <div className="alert alert-danger" role="alert">{err}</div>}
        <div className="form-grid">
          <Field id="em" label="E-posta"><input id="em" type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field id="dn" label="Ad soyad"><input id="dn" className="input" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
        </div>
        <Field id="pw" label="Geçici şifre" hint="En az 12 karakter."><input id="pw" type="password" autoComplete="new-password" className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 6 }}>
          <legend style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>Roller</legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 6 }}>
            {ROLES.map(([v, l]) => (
              <label key={v} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', minHeight: 32 }}>
                <input type="checkbox" checked={f.roles.includes(v)} style={{ width: 17, height: 17, accentColor: 'var(--brand)' }}
                  onChange={(e) => setF({ ...f, roles: e.target.checked ? [...f.roles, v] : f.roles.filter((x) => x !== v) })} />{l}
              </label>
            ))}
          </div>
        </fieldset>
      </Dialog>
    </>
  );
}
