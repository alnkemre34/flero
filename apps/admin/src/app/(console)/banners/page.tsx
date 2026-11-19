'use client';

import { ImageIcon, Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHead } from '@/components/shell';
import { Button, Dialog, Empty, ErrorState, Field, SkeletonRows, useData, useToast } from '@/components/ui';
import { api, ApiError, fmt } from '@/lib/api';

interface Banner { public_id: string; placement: string; image_url: string; alt_key: string; destination: string; sponsored: boolean; priority: number; starts_at: string; ends_at: string; active: boolean }
const DEST: [string, string][] = [['flero://plus', 'Plus sayfası'], ['flero://boost', 'Boost'], ['flero://wallet', 'Cüzdan'], ['flero://shuffle', 'Shuffle']];

export default function BannersPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useData(() => api<Banner[]>('banners').then((r) => r.data), []);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ placement: 'HOME', image_url: 'https://', alt_key: 'banner.', destination: 'flero://plus', sponsored: false, priority: '10', days: '7' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setBusy(true); setErr(null);
    try {
      await api('banners', { method: 'POST', body: { placement: f.placement, image_url: f.image_url, alt_key: f.alt_key, destination: f.destination, sponsored: f.sponsored, priority: Number(f.priority), ends_at: new Date(Date.now() + Number(f.days) * 86400_000).toISOString() } });
      toast('success', 'Banner yayına alındı.');
      setOpen(false); reload();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Kaydedilemedi.'); } finally { setBusy(false); }
  }
  async function toggle(b: Banner) {
    try { await api(`banners/${b.public_id}/active`, { method: 'POST', body: { active: !b.active } }); reload(); }
    catch (e) { toast('error', e instanceof Error ? e.message : 'Güncellenemedi.'); }
  }
  const live = (b: Banner) => b.active && new Date(b.starts_at) <= new Date() && new Date(b.ends_at) > new Date();

  return (
    <>
      <PageHead title="Bannerlar" description="Yalnızca izinli uygulama içi bağlantılara yönlenir. Sponsorlu içerik kullanıcıya her zaman etiketli gösterilir."
        actions={<button className="btn btn-primary" onClick={() => { setErr(null); setOpen(true); }}><Plus size={16} aria-hidden />Yeni banner</button>} />
      {error && <ErrorState error={error} retry={reload} />}
      <div className="card table-wrap">
        <table className="stack">
          <thead><tr><th>Görsel</th><th>Yerleşim</th><th>Hedef</th><th>Yayın</th><th>Durum</th><th className="right" /></tr></thead>
          {loading && !data ? <SkeletonRows cols={6} /> : (
            <tbody>{data?.map((b) => (
              <tr key={b.public_id}>
                <td><div className="cell-main" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.alt_key}</div><div className="cell-sub" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.image_url}</div></td>
                <td data-label="Yerleşim">{b.placement}{b.sponsored && <span className="badge b-signal" style={{ marginLeft: 6 }}>Sponsorlu</span>}</td>
                <td data-label="Hedef" className="num muted">{b.destination}</td>
                <td data-label="Yayın" className="muted">{fmt.date(b.ends_at)} bitiş</td>
                <td><span className={`badge badge-dot ${live(b) ? 'b-success' : ''}`}>{live(b) ? 'Yayında' : b.active ? 'Planlı / bitti' : 'Kapalı'}</span></td>
                <td className="right"><button className="btn btn-sm" onClick={() => toggle(b)}>{b.active ? 'Kapat' : 'Aç'}</button></td>
              </tr>))}</tbody>
          )}
        </table>
        {data && !data.length && <Empty title="Banner yok" icon={<ImageIcon size={28} aria-hidden />}>Ana sayfada kampanya göstermek için ilk banner’ı ekleyin.</Empty>}
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title="Yeni banner" footer={<><button className="btn btn-ghost" onClick={() => setOpen(false)}>Vazgeç</button><Button className="btn-primary" busy={busy} onClick={create}>Yayına al</Button></>}>
        {err && <div className="alert alert-danger" role="alert">{err}</div>}
        <Field id="img" label="Görsel adresi (https)"><input id="img" className="input" value={f.image_url} onChange={(e) => setF({ ...f, image_url: e.target.value })} /></Field>
        <div className="form-grid">
          <Field id="alt" label="Erişilebilir metin anahtarı" hint="ör. banner.plus_kasim"><input id="alt" className="input" value={f.alt_key} onChange={(e) => setF({ ...f, alt_key: e.target.value })} /></Field>
          <Field id="dst" label="Hedef"><select id="dst" className="select" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })}>{DEST.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field id="plc" label="Yerleşim"><select id="plc" className="select" value={f.placement} onChange={(e) => setF({ ...f, placement: e.target.value })}><option value="HOME">Ana sayfa</option><option value="WALLET">Cüzdan</option><option value="SHUFFLE">Shuffle</option></select></Field>
          <Field id="days" label="Süre (gün)"><input id="days" className="input num" inputMode="numeric" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></Field>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}><input type="checkbox" checked={f.sponsored} onChange={(e) => setF({ ...f, sponsored: e.target.checked })} style={{ width: 18, height: 18, accentColor: 'var(--brand)' }} />Sponsorlu içerik</label>
      </Dialog>
    </>
  );
}
