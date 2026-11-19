'use client';

import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { PageHead } from '@/components/shell';
import { Button, ErrorState, SkeletonRows, useData } from '@/components/ui';
import { api, fmt } from '@/lib/api';

interface Ev { id: number; at: string; actor: string | null; action: string; target_type: string; target_ref: string; reason: string | null; hash: string }

export default function AuditPage() {
  const { data, error, loading, reload } = useData(() => api<Ev[]>('audit?limit=100').then((r) => r.data), []);
  const [check, setCheck] = useState<{ ok: boolean; checked: number; broken_at?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const verify = async () => { setBusy(true); try { setCheck((await api<{ ok: boolean; checked: number; broken_at?: number }>('audit/verify')).data); } finally { setBusy(false); } };
  return (
    <>
      <PageHead title="Denetim kaydı" description="Silinemez, değiştirilemez ve hash zinciriyle bağlı. Tek bir satırın değiştirilmesi zinciri o noktada kırar."
        actions={<Button busy={busy} onClick={verify}><ShieldCheck size={16} aria-hidden />Zinciri doğrula</Button>} />
      <div aria-live="polite">
        {check && (check.ok
          ? <div className="alert alert-info" style={{ marginBottom: 14 }}><ShieldCheck size={18} aria-hidden style={{ color: 'var(--success)' }} />Zincir sağlam — {fmt.int(check.checked)} kayıt doğrulandı.</div>
          : <div className="alert alert-danger" role="alert" style={{ marginBottom: 14 }}><ShieldAlert size={18} aria-hidden style={{ color: 'var(--danger)' }} />Zincir #{check.broken_at} numaralı kayıtta kırık. Güvenlik ekibine bildirin.</div>)}
      </div>
      {error && <ErrorState error={error} retry={reload} />}
      <div className="card table-wrap">
        <table className="stack">
          <thead><tr><th>#</th><th>Zaman</th><th>Yetkili</th><th>İşlem</th><th>Hedef</th><th>Gerekçe</th><th>Hash</th></tr></thead>
          {loading && !data ? <SkeletonRows cols={7} /> : (
            <tbody>{data?.map((e) => (
              <tr key={e.id}>
                <td className="num muted">{e.id}</td>
                <td data-label="Zaman" className="muted">{fmt.date(e.at)}</td>
                <td data-label="Yetkili">{e.actor ?? 'sistem'}</td>
                <td data-label="İşlem"><span className="badge num">{e.action}</span></td>
                <td data-label="Hedef" className="num muted" style={{ maxWidth: 220, overflowWrap: 'anywhere' }}>{e.target_type}:{e.target_ref}</td>
                <td data-label="Gerekçe" style={{ maxWidth: 280 }}>{e.reason ?? '—'}</td>
                <td data-label="Hash" className="num muted">{e.hash.slice(0, 10)}…</td>
              </tr>))}</tbody>
          )}
        </table>
      </div>
    </>
  );
}
