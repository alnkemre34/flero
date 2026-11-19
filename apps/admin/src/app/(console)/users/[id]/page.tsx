'use client';

import { ArrowLeft, Ban, Coins, PauseCircle, PlayCircle } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { PageHead } from '@/components/shell';
import { Button, Dialog, ErrorState, Field, Gold, StateBadge, useData, useToast } from '@/components/ui';
import { api, ApiError, fmt, place } from '@/lib/api';

interface Detail {
  public_id: string; handle: string; display_name: string; bio: string | null; state: string; gender: string; created_at: string; email: string | null;
  email_verified: boolean; age_assured: boolean; discoverable: boolean; city_key: string | null; district_key: string | null;
  gold: number; debt: number; frozen: boolean; followers: number; likes: number; active_sessions: number; reports_against: number;
  plus_until: string | null; boost: { scope: string; ends_at: string } | null;
  ledger: { public_id: string; op_type: string; created_at: string; actor: string; reason: string | null; amount: number }[];
}
const OP_TR: Record<string, string> = { IAP_CREDIT: 'Gold satın alımı', GIFT_SEND: 'Hediye gönderdi', GIFT_RECEIVE: 'Hediye aldı', UNLOCK: 'Medya kilidi', BOOST: 'Boost', PLUS_BONUS: 'Plus bonusu', ADMIN_GRANT: 'Yönetici düzeltmesi', IAP_REVERSAL: 'İade / chargeback', PROMO: 'Promosyon', COMPENSATION: 'Telafi' };

export default function UserDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const { data: u, error, loading, reload } = useData(() => api<Detail>(`users/${id}`).then((r) => r.data), [id]);
  const [dlg, setDlg] = useState<null | 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'gold'>(null);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const close = () => { setDlg(null); setReason(''); setAmount(''); setErr(null); };

  async function submit() {
    if (reason.trim().length < 5) { setErr('Gerekçe en az 5 karakter olmalı.'); return; }
    setBusy(true); setErr(null);
    try {
      if (dlg === 'gold') {
        const n = Number(amount);
        if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 100_000) { setErr('0 dışında, ±100.000 aralığında bir tam sayı girin.'); setBusy(false); return; }
        await api(`users/${id}/gold-adjustments`, { method: 'POST', body: { amount: n, reason } });
        toast('success', 'Düzeltme talebi oluşturuldu. Başka bir yetkilinin onayı bekleniyor.');
      } else if (dlg) {
        await api(`users/${id}/state`, { method: 'POST', body: { state: dlg, reason } });
        toast('success', dlg === 'ACTIVE' ? 'Hesap yeniden etkinleştirildi.' : 'Hesap durumu güncellendi; oturumları kapatıldı.');
        reload();
      }
      close();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'İşlem başarısız.'); } finally { setBusy(false); }
  }

  return (
    <>
      <Link href="/users" className="btn btn-ghost btn-sm" style={{ marginBottom: 12 }}><ArrowLeft size={15} aria-hidden />Kullanıcılar</Link>
      {error && <ErrorState error={error} retry={reload} />}
      {loading && !u && <div className="card card-body"><div className="skeleton" style={{ height: 22, width: 220 }} /><div className="skeleton" style={{ height: 14, width: 320, marginTop: 10 }} /></div>}
      {u && (
        <>
          <PageHead title={u.display_name} description={`@${u.handle} · ${u.public_id}`} actions={
            <>
              {u.state === 'ACTIVE' ? (
                <>
                  <button className="btn" onClick={() => setDlg('SUSPENDED')}><PauseCircle size={16} aria-hidden />Askıya al</button>
                  <button className="btn btn-danger" onClick={() => setDlg('BANNED')}><Ban size={16} aria-hidden />Yasakla</button>
                </>
              ) : <button className="btn" onClick={() => setDlg('ACTIVE')}><PlayCircle size={16} aria-hidden />Etkinleştir</button>}
              <button className="btn btn-primary" onClick={() => setDlg('gold')}><Coins size={16} aria-hidden />Gold düzeltmesi</button>
            </>
          } />
          <div className="grid two">
            <section className="card" aria-labelledby="ledger-h">
              <div className="card-head"><h2 id="ledger-h">Cüzdan hareketleri</h2><span className="muted" style={{ fontSize: 12 }}>Karşı taraflar anonimlik gereği gösterilmez</span></div>
              <div className="table-wrap">
                <table className="stack">
                  <thead><tr><th>İşlem</th><th>Kaynak</th><th>Tarih</th><th className="right">Tutar</th></tr></thead>
                  <tbody>
                    {u.ledger.map((t) => (
                      <tr key={t.public_id}>
                        <td className="cell-main">{OP_TR[t.op_type] ?? t.op_type}{t.reason && <div className="cell-sub">{t.reason}</div>}</td>
                        <td data-label="Kaynak" className="muted">{t.actor}</td>
                        <td data-label="Tarih" className="muted">{fmt.date(t.created_at)}</td>
                        <td data-label="Tutar" className="right num" style={{ color: t.amount > 0 ? 'var(--success)' : 'var(--text)' }}>{t.amount > 0 ? '+' : ''}{fmt.int(t.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!u.ledger.length && <div className="empty"><strong>Henüz hareket yok</strong></div>}
              </div>
            </section>
            <section className="card" aria-labelledby="acct-h">
              <div className="card-head"><h2 id="acct-h">Hesap</h2><StateBadge state={u.state} /></div>
              <div className="card-body">
                <dl className="kv">
                  <dt>Bakiye</dt><dd><Gold v={u.gold} />{u.debt > 0 && <span className="badge b-danger" style={{ marginLeft: 8 }}>Borç {fmt.int(u.debt)}</span>}</dd>
                  <dt>Üyelik</dt><dd>{u.plus_until ? <span className="badge b-gold">Plus · {fmt.date(u.plus_until)}</span> : 'Standart'}</dd>
                  <dt>Boost</dt><dd>{u.boost ? <span className="badge b-signal">{u.boost.scope === 'CITY' ? 'Şehir' : 'İlçe'} · {fmt.date(u.boost.ends_at)}</span> : '—'}</dd>
                  <dt>Bölge</dt><dd>{u.city_key ? `${place(u.district_key)}, ${place(u.city_key)}` : '—'}</dd>
                  <dt>E-posta</dt><dd>{u.email ?? '—'} {u.email_verified && <span className="badge b-success">doğrulandı</span>}</dd>
                  <dt>18+ teyidi</dt><dd>{u.age_assured ? 'Evet' : 'Hayır'}</dd>
                  <dt>Takipçi / beğeni</dt><dd className="num">{fmt.int(u.followers)} / {fmt.int(u.likes)}</dd>
                  <dt>Açık oturum</dt><dd className="num">{u.active_sessions}</dd>
                  <dt>Hakkındaki şikâyet</dt><dd>{u.reports_against > 0 ? <span className="badge b-warning num">{u.reports_against}</span> : '0'}</dd>
                  <dt>Katılım</dt><dd>{fmt.date(u.created_at)}</dd>
                </dl>
              </div>
            </section>
          </div>
        </>
      )}
      <Dialog open={dlg !== null} onClose={close}
        title={dlg === 'gold' ? 'Gold düzeltmesi talep et' : dlg === 'BANNED' ? 'Hesabı yasakla' : dlg === 'SUSPENDED' ? 'Hesabı askıya al' : 'Hesabı etkinleştir'}
        description={dlg === 'gold' ? 'Talep, sizden farklı bir finans onaylayıcısı onaylayana kadar uygulanmaz.' : dlg === 'ACTIVE' ? undefined : 'Kullanıcının tüm oturumları anında kapanır ve keşiften çıkarılır.'}
        footer={<><button className="btn btn-ghost" onClick={close}>Vazgeç</button><Button className={dlg === 'BANNED' ? 'btn-danger' : 'btn-primary'} busy={busy} onClick={submit}>{dlg === 'gold' ? 'Onaya gönder' : 'Onayla'}</Button></>}>
        {err && <div className="alert alert-danger" role="alert">{err}</div>}
        {dlg === 'gold' && (
          <Field id="amt" label="Tutar (Gold)" hint="Eksi değer bakiyeden düşer (ör. -20).">
            <input id="amt" className="input num" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
        )}
        <Field id="rsn" label="Gerekçe" hint="Denetim kaydına yazılır.">
          <textarea id="rsn" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} {...(dlg !== 'gold' ? { autoFocus: true } : {})} />
        </Field>
      </Dialog>
    </>
  );
}
