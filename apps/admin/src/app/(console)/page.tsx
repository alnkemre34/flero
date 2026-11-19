'use client';

import { Activity, AlertTriangle, Coins, Crown, MessagesSquare, Rocket, UserPlus, Users, Vote } from 'lucide-react';
import Link from 'next/link';
import { PageHead } from '@/components/shell';
import { ErrorState, Gold, useData } from '@/components/ui';
import { api, fmt } from '@/lib/api';

interface Dash {
  accounts: number; signups_24h: number; signups_7d: number; plus_active: number; boosts_active: number; sessions_24h: number;
  conversations_24h: number; gold_sold_24h: number; gold_spent_24h: number; gold_outstanding: number; reports_open: number;
  reports_urgent: number; approvals_pending: number; signups_daily: { day: string; signups: number }[];
}

function Kpi({ label, value, sub, icon: Icon, tone }: { label: string; value: React.ReactNode; sub?: string; icon: typeof Users; tone?: string }) {
  return (
    <div className="card kpi">
      <div className="label"><Icon size={14} aria-hidden style={{ color: tone ?? 'var(--text-3)' }} />{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { data: d, error, loading, reload } = useData(() => api<Dash>('dashboard').then((r) => r.data), []);
  const max = Math.max(1, ...(d?.signups_daily.map((x) => x.signups) ?? [1]));
  return (
    <>
      <PageHead title="Kontrol paneli" description="Topluluğun ve ekonominin son 24 saati. Rakamlar her açılışta canlı veritabanından okunur." />
      {error && <ErrorState error={error} retry={reload} />}
      {loading && !d ? (
        <div className="grid kpis">{Array.from({ length: 8 }, (_, i) => <div key={i} className="card kpi"><div className="skeleton" style={{ height: 12, width: '50%' }} /><div className="skeleton" style={{ height: 26, width: '70%', marginTop: 10 }} /></div>)}</div>
      ) : d && (
        <div className="grid" style={{ gap: 20 }}>
          {(d.reports_urgent > 0) && (
            <div className="alert alert-danger" role="alert">
              <AlertTriangle size={18} aria-hidden style={{ color: 'var(--danger)', flexShrink: 0 }} />
              <div style={{ flex: 1 }}><strong>{d.reports_urgent} acil şikâyet</strong> (reşit olmayan güvenliği) inceleme bekliyor.</div>
              <Link href="/reports" className="btn btn-sm btn-danger">Kuyruğa git</Link>
            </div>
          )}
          <div className="grid kpis">
            <Kpi label="Toplam hesap" value={fmt.int(d.accounts)} sub={`Son 7 gün +${fmt.int(d.signups_7d)}`} icon={Users} />
            <Kpi label="Yeni kayıt (24s)" value={fmt.int(d.signups_24h)} icon={UserPlus} tone="var(--brand)" />
            <Kpi label="Aktif oturum (24s)" value={fmt.int(d.sessions_24h)} icon={Activity} />
            <Kpi label="Yeni sohbet (24s)" value={fmt.int(d.conversations_24h)} icon={MessagesSquare} />
            <Kpi label="Aktif Plus" value={fmt.int(d.plus_active)} icon={Crown} tone="var(--gold)" />
            <Kpi label="Aktif Boost" value={fmt.int(d.boosts_active)} icon={Rocket} tone="var(--signal)" />
            <Kpi label="Satılan Gold (24s)" value={<Gold v={d.gold_sold_24h} />} sub={`Harcanan ${fmt.int(d.gold_spent_24h)}`} icon={Coins} tone="var(--gold)" />
            <Kpi label="Dolaşımdaki Gold" value={<Gold v={d.gold_outstanding} />} sub="Kullanıcı cüzdanları toplamı" icon={Coins} />
          </div>
          <div className="grid two">
            <section className="card" aria-labelledby="signups-h">
              <div className="card-head"><h2 id="signups-h">Günlük kayıtlar (14 gün)</h2><span className="muted num">{fmt.int(d.signups_daily.reduce((s, x) => s + x.signups, 0))} toplam</span></div>
              <div className="card-body">
                <div className="bars" role="img" aria-label={`Son 14 günde günlük kayıtlar: ${d.signups_daily.map((x) => `${x.day.slice(5)} ${x.signups}`).join(', ')}`}>
                  {d.signups_daily.map((x, i) => (
                    <div key={x.day} className="bar" title={`${x.day}: ${x.signups}`}>
                      <i style={{ height: `${Math.max(2, (x.signups / max) * 100)}%`, animationDelay: `${Math.min(i, 8) * 30}ms` }} />
                      <span className="num">{x.day.slice(8)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
            <section className="card" aria-labelledby="queue-h">
              <div className="card-head"><h2 id="queue-h">Bekleyen işler</h2></div>
              <div className="card-body" style={{ display: 'grid', gap: 10 }}>
                <Link href="/reports" className="nav-link" style={{ border: '1px solid var(--border)' }}><AlertTriangle size={16} aria-hidden />Açık şikâyetler<span className="badge num" style={{ marginLeft: 'auto' }}>{d.reports_open}</span></Link>
                <Link href="/approvals" className="nav-link" style={{ border: '1px solid var(--border)' }}><Vote size={16} aria-hidden />Dört göz onayı<span className="badge num" style={{ marginLeft: 'auto' }}>{d.approvals_pending}</span></Link>
                <p className="muted" style={{ margin: '4px 2px 0', fontSize: 12 }}>Para hareketi içeren her işlem, talep edenden farklı bir yetkilinin onayıyla yürür.</p>
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
