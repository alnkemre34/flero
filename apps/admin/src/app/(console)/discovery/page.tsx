'use client';

import { FlaskConical, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHead } from '@/components/shell';
import { Button, ErrorState, Field, useData, useToast } from '@/components/ui';
import { api, ApiError, fmt } from '@/lib/api';

interface Cfg { id: number; shuffle_batch_size: number; priority_bps: number; local_bps: number; created_by: string; reason: string; created_at: string; activated_at: string | null }
interface Sim { runs: number; modes: Record<string, number>; avg_cards: number; boost_share: number; remote_share: number; latency_ms: { p50: number; p95: number } }
const SIZES = [10, 15, 20, 25, 35, 50];
const DISTRICTS: [number, string][] = [[3401, 'Kadıköy'], [3402, 'Beşiktaş'], [3403, 'Üsküdar'], [3404, 'Şişli'], [3405, 'Esenyurt'], [3406, 'Beyoğlu'], [3407, 'Ataşehir'], [3408, 'Bakırköy'], [601, 'Çankaya'], [602, 'Keçiören'], [603, 'Yenimahalle'], [3501, 'Konak'], [3502, 'Karşıyaka'], [3503, 'Bornova']];

function Slider({ id, label, value, min, max, step, onChange, hint }: { id: string; label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; hint: string }) {
  return (
    <Field id={id} label={`${label}: %${(value / 100).toLocaleString('tr-TR')}`} hint={hint}>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ accentColor: 'var(--brand)', width: '100%' }} />
    </Field>
  );
}

export default function DiscoveryPage() {
  const toast = useToast();
  const { data, error, reload } = useData(() => api<{ active: Cfg | null; history: Cfg[] }>('discovery/config').then((r) => r.data), []);
  const [n, setN] = useState(10);
  const [pr, setPr] = useState(3000);
  const [lo, setLo] = useState(7000);
  const [district, setDistrict] = useState(3401);
  const [reason, setReason] = useState('');
  const [sim, setSim] = useState<Sim | null>(null);
  const [busy, setBusy] = useState<'save' | 'sim' | null>(null);
  useEffect(() => { if (data?.active) { setN(data.active.shuffle_batch_size); setPr(data.active.priority_bps); setLo(data.active.local_bps); } }, [data]);
  const dirty = data?.active && (n !== data.active.shuffle_batch_size || pr !== data.active.priority_bps || lo !== data.active.local_bps);

  async function simulate() {
    setBusy('sim');
    try { setSim((await api<Sim>('discovery/simulate', { method: 'POST', body: { shuffle_batch_size: n, priority_bps: pr, local_bps: lo, district_id: district, runs: 60 } })).data); }
    catch (e) { toast('error', e instanceof ApiError ? e.message : 'Simülasyon başarısız.'); } finally { setBusy(null); }
  }
  async function save() {
    if (reason.trim().length < 5) { toast('error', 'Değişiklik gerekçesi en az 5 karakter olmalı.'); return; }
    setBusy('save');
    try {
      await api('discovery/config', { method: 'POST', body: { shuffle_batch_size: n, priority_bps: pr, local_bps: lo, reason } });
      toast('success', 'Yeni Shuffle ayarı yürürlüğe girdi (en geç 5 sn içinde tüm sunucularda).');
      setReason(''); reload();
    } catch (e) { toast('error', e instanceof ApiError ? e.message : 'Kaydedilemedi.'); } finally { setBusy(null); }
  }

  return (
    <>
      <PageHead title="Shuffle ayarları" description="Sınırlar sunucu ve veritabanında zorunludur: parti boyutu yalnızca izinli değerlerden biri olabilir, öncelik %5–40, yerel pay %50–90." />
      {error && <ErrorState error={error} retry={reload} />}
      <div className="grid two">
        <section className="card" aria-labelledby="cfg-h">
          <div className="card-head"><h2 id="cfg-h">Yapılandırma</h2>{data?.active && <span className="badge b-success num">Yürürlükte: cfg_{data.active.id}</span>}</div>
          <div className="card-body" style={{ display: 'grid', gap: 18 }}>
            <Field id="n" label="Parti boyutu (N)" hint="Bir Shuffle isteğinde dönen kart sayısı. İstemci değiştiremez.">
              <div className="tabs" role="radiogroup" aria-label="Parti boyutu" id="n">
                {SIZES.map((s) => <button key={s} role="radio" aria-checked={n === s} aria-selected={n === s} className="tab num" onClick={() => setN(s)}>{s}</button>)}
              </div>
            </Field>
            <Slider id="pr" label="Öncelik payı (Boost)" value={pr} min={500} max={4000} step={100} onChange={setPr} hint="Bir partide Boost sahiplerine ayrılabilecek en yüksek oran." />
            <Slider id="lo" label="Yerel pay" value={lo} min={5000} max={9000} step={100} onChange={setLo} hint="İlçe modunda kartların ev ilçesinden gelen hedef oranı; kalan şehir geneli (Plus/şehir Boost)." />
            <div className="toolbar">
              <label className="sr-only" htmlFor="dist">Simülasyon ilçesi</label>
              <select id="dist" className="select" style={{ width: 180 }} value={district} onChange={(e) => setDistrict(Number(e.target.value))}>{DISTRICTS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select>
              <Button busy={busy === 'sim'} onClick={simulate}><FlaskConical size={16} aria-hidden />Canlı veride simüle et</Button>
            </div>
            <Field id="reason" label="Gerekçe"><input id="reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ör. Daha büyük partiler testi" /></Field>
            <div><Button className="btn-primary" busy={busy === 'save'} disabled={!dirty} onClick={save}><Save size={16} aria-hidden />Yürürlüğe al</Button>{!dirty && <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>Değişiklik yok</span>}</div>
          </div>
        </section>
        <section className="card" aria-labelledby="sim-h" aria-live="polite">
          <div className="card-head"><h2 id="sim-h">Simülasyon sonucu</h2>{sim && <span className="muted num">{sim.runs} çalıştırma</span>}</div>
          <div className="card-body">
            {!sim ? <p className="muted" style={{ margin: 0 }}>Seçili ilçede, gerçek dizin verisi üzerinde salt okunur çalıştırılır. Kullanıcılara hiçbir şey gösterilmez.</p> : (
              <div style={{ display: 'grid', gap: 14 }}>
                {[['Boost payı', sim.boost_share, 'var(--signal)'], ['Şehir geneli payı', sim.remote_share, 'var(--gold)']].map(([l, v, c]) => (
                  <div key={l as string}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>{l as string}</span><span className="num">{fmt.pct(v as number)}</span></div><div className="meter"><i style={{ width: `${(v as number) * 100}%`, background: c as string }} /></div></div>
                ))}
                <dl className="kv">
                  <dt>Ortalama kart</dt><dd className="num">{sim.avg_cards.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}</dd>
                  <dt>Modlar</dt><dd>{Object.entries(sim.modes).map(([m, c]) => <span key={m} className="badge num" style={{ marginRight: 6 }}>{m} · {c}</span>)}</dd>
                  <dt>Gecikme p50 / p95</dt><dd className="num">{sim.latency_ms.p50.toFixed(1)} / {sim.latency_ms.p95.toFixed(1)} ms</dd>
                </dl>
              </div>
            )}
          </div>
        </section>
      </div>
      {data && (
        <section className="card table-wrap" style={{ marginTop: 16 }} aria-labelledby="hist-h">
          <div className="card-head"><h2 id="hist-h">Geçmiş</h2></div>
          <table className="stack"><thead><tr><th>Sürüm</th><th className="right">N</th><th className="right">Öncelik</th><th className="right">Yerel</th><th>Gerekçe</th><th>Yazan</th><th>Tarih</th></tr></thead>
            <tbody>{data.history.map((h) => <tr key={h.id}><td className="num">cfg_{h.id}</td><td className="right num">{h.shuffle_batch_size}</td><td className="right num">%{h.priority_bps / 100}</td><td className="right num">%{h.local_bps / 100}</td><td>{h.reason}</td><td className="muted">{h.created_by}</td><td className="muted">{fmt.date(h.created_at)}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </>
  );
}
