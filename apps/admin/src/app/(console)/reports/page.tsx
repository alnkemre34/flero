'use client';

import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHead } from '@/components/shell';
import { Button, Dialog, Empty, ErrorState, Field, SkeletonRows, StateBadge, useData, useToast } from '@/components/ui';
import { api, ApiError, fmt } from '@/lib/api';

interface Report { public_id: string; target_type: string; reason: string; note: string | null; priority: number; status: string; created_at: string; target_public_id: string | null; target_handle: string | null; target_state: string | null; target_report_count: number; reporter_alias: string }
const REASON: Record<string, string> = { SPAM: 'Spam', HARASSMENT: 'Taciz', NUDITY: 'Çıplaklık', MINOR_SAFETY: 'Reşit olmayan güvenliği', VIOLENCE: 'Şiddet', IMPERSONATION: 'Kimliğe bürünme', OTHER: 'Diğer' };
const TARGET: Record<string, string> = { PROFILE: 'Profil', CONVERSATION: 'Sohbet', MESSAGE: 'Mesaj', MEDIA: 'Medya' };
const STATUS: [string, string][] = [['OPEN', 'Açık'], ['ACTIONED', 'İşlem yapıldı'], ['DISMISSED', 'Reddedildi']];

export default function ReportsPage() {
  const toast = useToast();
  const [status, setStatus] = useState('OPEN');
  const { data, error, loading, reload } = useData(() => api<Report[]>(`reports?status=${status}`).then((r) => r.data), [status]);
  const [act, setAct] = useState<{ r: Report; action: 'DISMISS' | 'SUSPEND_TARGET' | 'BAN_TARGET' } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function resolve() {
    if (!act) return;
    if (note.trim().length < 5) { setErr('Karar notu en az 5 karakter olmalı.'); return; }
    setBusy(true); setErr(null);
    try {
      await api(`reports/${act.r.public_id}/resolve`, { method: 'POST', body: { action: act.action, note } });
      toast('success', act.action === 'DISMISS' ? 'Şikâyet reddedildi.' : 'İşlem uygulandı; hedef hesabın oturumları kapatıldı.');
      setAct(null); setNote(''); reload();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'İşlem başarısız.'); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHead title="Şikâyetler" description="Reşit olmayan güvenliği bildirimleri her zaman en üsttedir. Şikâyet edenin kimliği yalnızca anahtarlı bir takma adla gösterilir." />
      <div className="tabs" role="tablist" aria-label="Durum" style={{ marginBottom: 14 }}>
        {STATUS.map(([s, l]) => <button key={s} role="tab" aria-selected={status === s} className="tab" onClick={() => setStatus(s)}>{l}</button>)}
      </div>
      {error && <ErrorState error={error} retry={reload} />}
      <div className="card table-wrap">
        <table className="stack">
          <thead><tr><th>Neden</th><th>Hedef</th><th>Not</th><th>Bildiren</th><th>Tarih</th>{status === 'OPEN' && <th className="right">Karar</th>}</tr></thead>
          {loading && !data ? <SkeletonRows cols={6} /> : (
            <tbody>
              {data?.map((r) => (
                <tr key={r.public_id}>
                  <td><span className={`badge ${r.priority === 0 ? 'b-danger' : 'b-warning'}`}>{REASON[r.reason] ?? r.reason}</span><div className="cell-sub">{TARGET[r.target_type]}</div></td>
                  <td data-label="Hedef">
                    {r.target_public_id ? <Link className="cell-main" href={`/users/${r.target_public_id}`}>@{r.target_handle}</Link> : '—'}
                    <div className="cell-sub">{r.target_state && <StateBadge state={r.target_state} />} {r.target_report_count > 1 && <span className="badge num">{r.target_report_count} şikâyet</span>}</div>
                  </td>
                  <td data-label="Not" style={{ maxWidth: 320 }}>{r.note ?? <span className="muted">—</span>}</td>
                  <td data-label="Bildiren" className="num muted">{r.reporter_alias}</td>
                  <td data-label="Tarih" className="muted">{fmt.date(r.created_at)}</td>
                  {status === 'OPEN' && <td className="right"><div className="toolbar" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setAct({ r, action: 'DISMISS' })}>Reddet</button>
                    <button className="btn btn-sm" onClick={() => setAct({ r, action: 'SUSPEND_TARGET' })}>Askıya al</button>
                    <button className="btn btn-danger btn-sm" onClick={() => setAct({ r, action: 'BAN_TARGET' })}>Yasakla</button>
                  </div></td>}
                </tr>
              ))}
            </tbody>
          )}
        </table>
        {data && !data.length && <Empty title={status === 'OPEN' ? 'Kuyruk temiz' : 'Kayıt yok'} icon={<ShieldCheck size={28} aria-hidden />}>{status === 'OPEN' ? 'İnceleme bekleyen şikâyet yok.' : undefined}</Empty>}
      </div>
      <Dialog open={!!act} onClose={() => { setAct(null); setErr(null); }}
        title={act?.action === 'DISMISS' ? 'Şikâyeti reddet' : act?.action === 'BAN_TARGET' ? `@${act.r.target_handle} yasaklansın mı?` : `@${act?.r.target_handle} askıya alınsın mı?`}
        description={act?.action === 'DISMISS' ? 'Hedef hesapta değişiklik yapılmaz.' : 'Hedefin tüm oturumları anında kapanır ve keşiften çıkarılır.'}
        footer={<><button className="btn btn-ghost" onClick={() => setAct(null)}>Vazgeç</button><Button className={act?.action === 'BAN_TARGET' ? 'btn-danger' : 'btn-primary'} busy={busy} onClick={resolve}>Onayla</Button></>}>
        {err && <div className="alert alert-danger" role="alert">{err}</div>}
        <Field id="note" label="Karar notu" hint="Denetim kaydına yazılır."><textarea id="note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></Field>
      </Dialog>
    </>
  );
}
