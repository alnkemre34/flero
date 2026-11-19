'use client';

import { Crown, History, Plus, Rocket, Unlock } from 'lucide-react';
import { useState } from 'react';
import { PageHead } from '@/components/shell';
import { Button, Dialog, Empty, ErrorState, Field, Gold, SkeletonRows, useData, useToast } from '@/components/ui';
import { api, ApiError, fmt } from '@/lib/api';

interface GoldP { store: string; product_id: string; version: number; gold_amount: number; active: boolean; created_by: string; created_at: string }
interface BoostP { package_id: number; version: number; scope: 'DISTRICT' | 'CITY'; duration_minutes: number; price_gold: number; active: boolean; created_at: string }
interface PlusP { plan_id: string; version: number; period: string; store: string; product_id: string; bonus_gold: number; active: boolean; created_at: string }
interface UnlockP { kind: string; version: number; price_gold: number; created_at: string }
interface Catalog { gold_products: GoldP[]; boost_packages: BoostP[]; plus_plans: PlusP[]; unlock_prices: UnlockP[] }
type Tab = 'gold' | 'boost' | 'plus' | 'unlock';
type Kind = 'gold_product' | 'boost_package' | 'plus_plan' | 'unlock_price';

const dur = (m: number) => (m % 1440 === 0 ? `${m / 1440} gün` : m % 60 === 0 ? `${m / 60} saat` : `${m} dk`);
const Status = ({ active }: { active: boolean }) => <span className={`badge badge-dot ${active ? 'b-success' : ''}`}>{active ? 'Satışta' : 'Kapalı'}</span>;

export default function PricingPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('gold');
  const { data: c, error, loading, reload } = useData(() => api<Catalog>('catalog').then((r) => r.data), []);
  const [edit, setEdit] = useState<{ tab: Tab; values: Record<string, string | boolean>; isNew: boolean } | null>(null);
  const [hist, setHist] = useState<{ kind: Kind; key: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const history = useData(() => (hist ? api<{ version: number; value: number; active: boolean; created_by: string; created_at: string }[]>(`catalog/history?kind=${hist.kind}&key=${encodeURIComponent(hist.key)}`).then((r) => r.data) : Promise.resolve([])), [hist?.kind, hist?.key]);

  const open = (t: Tab, values: Record<string, string | boolean>, isNew = false) => { setErr(null); setEdit({ tab: t, values: { reason: '', active: true, ...values }, isNew }); };
  const set = (k: string, v: string | boolean) => setEdit((e) => (e ? { ...e, values: { ...e.values, [k]: v } } : e));

  async function save() {
    if (!edit) return;
    const v = edit.values;
    if (String(v.reason ?? '').trim().length < 5) { setErr('Değişiklik gerekçesi en az 5 karakter olmalı.'); return; }
    const num = (k: string) => Number(v[k]);
    const body = {
      gold: { path: 'catalog/gold-products', b: { store: v.store, product_id: v.product_id, gold_amount: num('gold_amount'), active: v.active, reason: v.reason } },
      boost: { path: 'catalog/boost-packages', b: { ...(v.package_id ? { package_id: num('package_id') } : {}), scope: v.scope, duration_minutes: num('duration_minutes'), price_gold: num('price_gold'), active: v.active, reason: v.reason } },
      plus: { path: 'catalog/plus-plans', b: { plan_id: v.plan_id, period: v.period, store: v.store, product_id: v.product_id, bonus_gold: num('bonus_gold'), active: v.active, reason: v.reason } },
      unlock: { path: 'catalog/unlock-prices', b: { kind: v.kind, price_gold: num('price_gold'), reason: v.reason } },
    }[edit.tab];
    setBusy(true); setErr(null);
    try {
      const r = await api<{ version: number }>(body.path, { method: 'POST', body: body.b });
      toast('success', `Kaydedildi — yeni sürüm v${r.data.version} hemen yürürlükte. Verilmiş teklifler eski fiyatla kalır.`);
      setEdit(null);
      reload();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Kaydedilemedi.'); } finally { setBusy(false); }
  }

  const tabs: { id: Tab; label: string; icon: typeof Rocket }[] = [
    { id: 'gold', label: 'Gold paketleri', icon: Plus }, { id: 'boost', label: 'Boost', icon: Rocket },
    { id: 'plus', label: 'Plus', icon: Crown }, { id: 'unlock', label: 'Medya kilidi', icon: Unlock },
  ];
  const v = edit?.values ?? {};
  const input = (k: string, label: string, p: { hint?: string; numeric?: boolean; disabled?: boolean } = {}) => (
    <Field id={`f-${k}`} label={label} {...(p.hint ? { hint: p.hint } : {})}>
      <input id={`f-${k}`} className={`input ${p.numeric ? 'num' : ''}`} inputMode={p.numeric ? 'numeric' : undefined} value={String(v[k] ?? '')} disabled={p.disabled} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );
  const choice = (k: string, label: string, opts: [string, string][], disabled = false) => (
    <Field id={`f-${k}`} label={label}>
      <select id={`f-${k}`} className="select" value={String(v[k] ?? '')} disabled={disabled} onChange={(e) => set(k, e.target.value)}>{opts.map(([val, l]) => <option key={val} value={val}>{l}</option>)}</select>
    </Field>
  );

  return (
    <>
      <PageHead title="Fiyatlandırma" description="Her değişiklik yeni ve değiştirilemez bir sürüm oluşturur. Satın alma anındaki fiyat kilitlenir; geçmiş hiçbir zaman yeniden yazılmaz."
        actions={tab !== 'unlock' || !c?.unlock_prices.length ? (
          <button className="btn btn-primary" onClick={() => open(tab, tab === 'gold' ? { store: 'APPLE', product_id: '', gold_amount: '' } : tab === 'boost' ? { scope: 'DISTRICT', duration_minutes: '60', price_gold: '' } : tab === 'plus' ? { plan_id: '', period: 'MONTHLY', store: 'APPLE', product_id: '', bonus_gold: '0' } : { kind: 'ONE_VIEW', price_gold: '' }, true)}>
            <Plus size={16} aria-hidden />Yeni ekle
          </button>
        ) : undefined} />
      <div className="tabs" role="tablist" aria-label="Katalog" style={{ marginBottom: 14 }}>
        {tabs.map((t) => <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls="catalog-panel" className="tab" onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {error && <ErrorState error={error} retry={reload} />}
      <section id="catalog-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="card table-wrap">
        <table className="stack">
          {tab === 'gold' && <><thead><tr><th>Ürün (mağaza SKU)</th><th>Mağaza</th><th className="right">Verilen Gold</th><th>Sürüm</th><th>Durum</th><th /></tr></thead>
            {loading && !c ? <SkeletonRows cols={6} /> : <tbody>{[...(c?.gold_products ?? [])].sort((a, b) => a.store.localeCompare(b.store) || a.gold_amount - b.gold_amount).map((p) => (
              <tr key={`${p.store}${p.product_id}`}>
                <td className="cell-main">{p.product_id}<div className="cell-sub">Fiyat (TL) mağaza konsolunda belirlenir</div></td>
                <td data-label="Mağaza">{p.store === 'APPLE' ? 'App Store' : 'Google Play'}</td>
                <td data-label="Gold" className="right"><Gold v={p.gold_amount} /></td>
                <td data-label="Sürüm" className="num muted">v{p.version}</td>
                <td><Status active={p.active} /></td>
                <td className="right"><div className="toolbar" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost btn-sm" aria-label={`${p.product_id} geçmişi`} onClick={() => setHist({ kind: 'gold_product', key: p.product_id, title: p.product_id })}><History size={15} /></button>
                  <button className="btn btn-sm" onClick={() => open('gold', { store: p.store, product_id: p.product_id, gold_amount: String(p.gold_amount), active: p.active })}>Düzenle</button>
                </div></td>
              </tr>))}</tbody>}</>}
          {tab === 'boost' && <><thead><tr><th>Paket</th><th>Kapsam</th><th>Süre</th><th className="right">Fiyat</th><th>Sürüm</th><th>Durum</th><th /></tr></thead>
            {loading && !c ? <SkeletonRows cols={7} /> : <tbody>{c?.boost_packages.map((p) => (
              <tr key={p.package_id}>
                <td className="cell-main num">#{p.package_id}</td>
                <td data-label="Kapsam"><span className={`badge ${p.scope === 'CITY' ? 'b-gold' : 'b-signal'}`}>{p.scope === 'CITY' ? 'Şehir (Plus)' : 'İlçe'}</span></td>
                <td data-label="Süre">{dur(p.duration_minutes)}</td>
                <td data-label="Fiyat" className="right"><Gold v={p.price_gold} /></td>
                <td data-label="Sürüm" className="num muted">v{p.version}</td>
                <td><Status active={p.active} /></td>
                <td className="right"><div className="toolbar" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost btn-sm" aria-label={`Paket ${p.package_id} geçmişi`} onClick={() => setHist({ kind: 'boost_package', key: String(p.package_id), title: `Boost #${p.package_id}` })}><History size={15} /></button>
                  <button className="btn btn-sm" onClick={() => open('boost', { package_id: String(p.package_id), scope: p.scope, duration_minutes: String(p.duration_minutes), price_gold: String(p.price_gold), active: p.active })}>Düzenle</button>
                </div></td>
              </tr>))}</tbody>}</>}
          {tab === 'plus' && <><thead><tr><th>Plan</th><th>Dönem</th><th>Mağaza SKU</th><th className="right">Bonus Gold</th><th>Sürüm</th><th>Durum</th><th /></tr></thead>
            {loading && !c ? <SkeletonRows cols={7} /> : <tbody>{c?.plus_plans.map((p) => (
              <tr key={p.plan_id}>
                <td className="cell-main">{p.plan_id}</td>
                <td data-label="Dönem">{p.period === 'MONTHLY' ? 'Aylık' : 'Yıllık'}</td>
                <td data-label="SKU" className="muted">{p.store === 'APPLE' ? 'iOS' : 'Android'} · {p.product_id}</td>
                <td data-label="Bonus" className="right"><Gold v={p.bonus_gold} /></td>
                <td data-label="Sürüm" className="num muted">v{p.version}</td>
                <td><Status active={p.active} /></td>
                <td className="right"><div className="toolbar" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost btn-sm" aria-label={`${p.plan_id} geçmişi`} onClick={() => setHist({ kind: 'plus_plan', key: p.plan_id, title: p.plan_id })}><History size={15} /></button>
                  <button className="btn btn-sm" onClick={() => open('plus', { plan_id: p.plan_id, period: p.period, store: p.store, product_id: p.product_id, bonus_gold: String(p.bonus_gold), active: p.active })}>Düzenle</button>
                </div></td>
              </tr>))}</tbody>}</>}
          {tab === 'unlock' && <><thead><tr><th>Medya türü</th><th className="right">Kilit açma fiyatı</th><th>Sürüm</th><th>Güncelleme</th><th /></tr></thead>
            {loading && !c ? <SkeletonRows cols={5} /> : <tbody>{c?.unlock_prices.map((p) => (
              <tr key={p.kind}>
                <td className="cell-main">{p.kind === 'ONE_VIEW' ? 'Tek görüntülük fotoğraf' : 'Kalıcı fotoğraf'}</td>
                <td data-label="Fiyat" className="right"><Gold v={p.price_gold} /></td>
                <td data-label="Sürüm" className="num muted">v{p.version}</td>
                <td data-label="Güncelleme" className="muted">{fmt.date(p.created_at)}</td>
                <td className="right"><button className="btn btn-sm" onClick={() => open('unlock', { kind: p.kind, price_gold: String(p.price_gold) })}>Düzenle</button></td>
              </tr>))}</tbody>}</>}
        </table>
        {c && !loading && ({ gold: c.gold_products, boost: c.boost_packages, plus: c.plus_plans, unlock: c.unlock_prices }[tab].length === 0) &&
          <Empty title="Henüz kayıt yok">Uygulamada görünmesi için “Yeni ekle” ile ilk sürümü oluşturun.</Empty>}
      </section>

      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit?.isNew ? 'Yeni sürüm oluştur' : 'Fiyatı güncelle'}
        description="Kaydettiğinizde yeni sürüm anında yürürlüğe girer ve denetim kaydına yazılır."
        footer={<><button className="btn btn-ghost" onClick={() => setEdit(null)}>Vazgeç</button><Button className="btn-primary" busy={busy} onClick={save}>Kaydet</Button></>}>
        {err && <div className="alert alert-danger" role="alert">{err}</div>}
        <div className="form-grid">
          {edit?.tab === 'gold' && <>{choice('store', 'Mağaza', [['APPLE', 'App Store'], ['GOOGLE', 'Google Play']], !edit.isNew)}{input('product_id', 'Mağaza SKU', { disabled: !edit.isNew, hint: 'ör. gold_500' })}{input('gold_amount', 'Verilen Gold', { numeric: true })}</>}
          {edit?.tab === 'boost' && <>{choice('scope', 'Kapsam', [['DISTRICT', 'İlçe'], ['CITY', 'Şehir (Plus)']], !edit.isNew)}{input('duration_minutes', 'Süre (dakika)', { numeric: true, hint: '15 dk – 30 gün' })}{input('price_gold', 'Fiyat (Gold)', { numeric: true })}</>}
          {edit?.tab === 'plus' && <>{input('plan_id', 'Plan kimliği', { disabled: !edit.isNew })}{choice('period', 'Dönem', [['MONTHLY', 'Aylık'], ['YEARLY', 'Yıllık']])}{choice('store', 'Mağaza', [['APPLE', 'App Store'], ['GOOGLE', 'Google Play']])}{input('product_id', 'Mağaza SKU')}{input('bonus_gold', 'Yenileme bonusu (Gold)', { numeric: true })}</>}
          {edit?.tab === 'unlock' && <>{choice('kind', 'Medya türü', [['ONE_VIEW', 'Tek görüntülük'], ['PERSISTENT', 'Kalıcı']], !edit.isNew)}{input('price_gold', 'Fiyat (Gold)', { numeric: true })}</>}
        </div>
        {edit && edit.tab !== 'unlock' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!v.active} onChange={(e) => set('active', e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--brand)' }} />Satışta
          </label>
        )}
        <Field id="f-reason" label="Gerekçe" hint="ör. “Kasım kampanyası %20 fazla Gold”">
          <textarea id="f-reason" className="textarea" value={String(v.reason ?? '')} onChange={(e) => set('reason', e.target.value)} />
        </Field>
      </Dialog>

      <Dialog open={!!hist} onClose={() => setHist(null)} title={`Sürüm geçmişi · ${hist?.title ?? ''}`} footer={<button className="btn" onClick={() => setHist(null)}>Kapat</button>}>
        {history.loading ? <div className="skeleton" style={{ height: 80 }} /> : (
          <table><thead><tr><th>Sürüm</th><th className="right">Değer</th><th>Yazan</th><th>Tarih</th></tr></thead>
            <tbody>{history.data?.map((h) => <tr key={h.version}><td className="num">v{h.version} {!h.active && <span className="badge">kapalı</span>}</td><td className="right"><Gold v={h.value} /></td><td className="muted">{h.created_by}</td><td className="muted">{fmt.date(h.created_at)}</td></tr>)}</tbody>
          </table>
        )}
      </Dialog>
    </>
  );
}
