'use client';

import { CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHead } from '@/components/shell';
import { Button, Empty, ErrorState, Gold, SkeletonRows, useData, useToast } from '@/components/ui';
import { api, ApiError, fmt } from '@/lib/api';

interface Approval { id: number; kind: string; payload: { public_id: string; amount: number }; reason: string; created_at: string; decision: string | null; decided_at: string | null; executed_at: string | null; requested_by: string; approved_by: string | null }

export default function ApprovalsPage() {
  const toast = useToast();
  const [status, setStatus] = useState<'PENDING' | 'DECIDED'>('PENDING');
  const { data, error, loading, reload } = useData(() => api<Approval[]>(`approvals?status=${status}`).then((r) => r.data), [status]);
  const [busy, setBusy] = useState<number | null>(null);

  async function decide(a: Approval, decision: 'APPROVED' | 'REJECTED') {
    setBusy(a.id);
    try {
      await api(`approvals/${a.id}/decision`, { method: 'POST', body: { decision } });
      toast('success', decision === 'APPROVED' ? 'Onaylandı ve uygulandı.' : 'Talep reddedildi.');
      reload();
    } catch (e) {
      const four = e instanceof ApiError && e.params?.reason === 'four_eyes';
      toast('error', four ? 'Kendi talebinizi onaylayamazsınız (dört göz kuralı).' : e instanceof Error ? e.message : 'İşlem başarısız.');
    } finally { setBusy(null); }
  }

  return (
    <>
      <PageHead title="Onaylar" description="Para hareketi içeren her talep, talep edenden farklı bir yetkili tarafından onaylanmalıdır. Kural veritabanında da zorunludur." />
      <div className="tabs" role="tablist" aria-label="Durum" style={{ marginBottom: 14 }}>
        <button role="tab" aria-selected={status === 'PENDING'} className="tab" onClick={() => setStatus('PENDING')}>Bekleyen</button>
        <button role="tab" aria-selected={status === 'DECIDED'} className="tab" onClick={() => setStatus('DECIDED')}>Sonuçlanan</button>
      </div>
      {error && <ErrorState error={error} retry={reload} />}
      <div className="card table-wrap">
        <table className="stack">
          <thead><tr><th>Talep</th><th className="right">Tutar</th><th>Gerekçe</th><th>Talep eden</th><th>{status === 'PENDING' ? 'Tarih' : 'Karar'}</th>{status === 'PENDING' && <th className="right">İşlem</th>}</tr></thead>
          {loading && !data ? <SkeletonRows cols={6} /> : (
            <tbody>
              {data?.map((a) => (
                <tr key={a.id}>
                  <td className="cell-main">Gold düzeltmesi<div className="cell-sub"><Link href={`/users/${a.payload.public_id}`}>{a.payload.public_id.slice(0, 12)}…</Link></div></td>
                  <td data-label="Tutar" className="right" style={{ color: a.payload.amount > 0 ? 'var(--success)' : 'var(--danger)' }}>{a.payload.amount > 0 ? '+' : ''}<Gold v={a.payload.amount} /></td>
                  <td data-label="Gerekçe" style={{ maxWidth: 300 }}>{a.reason}</td>
                  <td data-label="Talep eden" className="muted">{a.requested_by}</td>
                  <td data-label="Tarih" className="muted">{status === 'PENDING' ? fmt.date(a.created_at) : <><span className={`badge ${a.decision === 'APPROVED' ? 'b-success' : 'b-danger'}`}>{a.decision === 'APPROVED' ? 'Onaylandı' : 'Reddedildi'}</span> <span className="cell-sub">{a.approved_by}</span></>}</td>
                  {status === 'PENDING' && <td className="right"><div className="toolbar" style={{ justifyContent: 'flex-end' }}>
                    <Button className="btn-ghost btn-sm" busy={busy === a.id} onClick={() => decide(a, 'REJECTED')}>Reddet</Button>
                    <Button className="btn-primary btn-sm" busy={busy === a.id} onClick={() => decide(a, 'APPROVED')}>Onayla</Button>
                  </div></td>}
                </tr>
              ))}
            </tbody>
          )}
        </table>
        {data && !data.length && <Empty title={status === 'PENDING' ? 'Bekleyen onay yok' : 'Kayıt yok'} icon={<CheckCheck size={28} aria-hidden />} />}
      </div>
    </>
  );
}
