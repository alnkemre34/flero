'use client';

import { Crown, Search, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHead } from '@/components/shell';
import { Empty, ErrorState, Gold, SkeletonRows, StateBadge, useData } from '@/components/ui';
import { api, fmt, place } from '@/lib/api';

interface Row { public_id: string; handle: string; display_name: string; state: string; created_at: string; email: string | null; city_key: string | null; district_key: string | null; gold: number; plus: boolean }

export default function UsersPage() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [state, setState] = useState('');
  const [pages, setPages] = useState<Row[][]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const qs = (c?: string | null) => new URLSearchParams({ ...(debounced ? { q: debounced } : {}), ...(state ? { state } : {}), ...(c ? { cursor: c } : {}), limit: '50' }).toString();
  const { data, error, loading, reload } = useData(() => api<Row[]>(`users?${qs()}`), [debounced, state]);
  useEffect(() => { if (data) { setPages([data.data]); setCursor(data.next); } }, [data]);
  const loadMore = async () => {
    if (!cursor) return;
    setMore(true);
    try { const r = await api<Row[]>(`users?${qs(cursor)}`); setPages((p) => [...p, r.data]); setCursor(r.next); } finally { setMore(false); }
  };
  const rows = pages.flat();

  return (
    <>
      <PageHead title="Kullanıcılar" description="Kullanıcı adı ön eki, e-posta ya da kullanıcı kimliği ile arayın." />
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <div className="search">
          <Search size={16} aria-hidden />
          <label className="sr-only" htmlFor="q">Kullanıcı ara</label>
          <input id="q" className="input" placeholder="@kullanıcı, e-posta veya usr_…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </div>
        <label className="sr-only" htmlFor="st">Durum</label>
        <select id="st" className="select" style={{ width: 160 }} value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">Tüm durumlar</option><option value="ACTIVE">Aktif</option><option value="SUSPENDED">Askıda</option><option value="BANNED">Yasaklı</option>
        </select>
      </div>
      {error && <ErrorState error={error} retry={reload} />}
      <div className="card table-wrap">
        <table className="stack">
          <thead><tr><th>Kullanıcı</th><th>Durum</th><th>Bölge</th><th className="right">Gold</th><th>Katılım</th></tr></thead>
          {loading && !rows.length ? <SkeletonRows /> : (
            <tbody>
              {rows.map((u) => (
                <tr key={u.public_id}>
                  <td>
                    <Link href={`/users/${u.public_id}`} className="cell-main" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {u.display_name}{u.plus && <Crown size={13} aria-label="Plus" style={{ color: 'var(--gold)' }} />}
                    </Link>
                    <div className="cell-sub">@{u.handle}{u.email ? ` · ${u.email}` : ''}</div>
                  </td>
                  <td data-label="Durum"><StateBadge state={u.state} /></td>
                  <td data-label="Bölge">{u.city_key ? `${place(u.district_key)}, ${place(u.city_key)}` : <span className="muted">Seçilmedi</span>}</td>
                  <td data-label="Gold" className="right"><Gold v={u.gold} /></td>
                  <td data-label="Katılım" className="muted">{fmt.date(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
        {!loading && !rows.length && !error && <Empty title="Kullanıcı bulunamadı" icon={<Users size={28} aria-hidden />}>Aramayı genişletmeyi deneyin.</Empty>}
      </div>
      {cursor && <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}><button className="btn" onClick={loadMore} disabled={more} aria-busy={more || undefined}>Daha fazla yükle</button></div>}
    </>
  );
}
