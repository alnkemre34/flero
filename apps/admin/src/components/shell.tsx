'use client';

import {
  BadgePercent, Flag, Gauge, Image as ImageIcon, LogOut, Menu, Moon, ScrollText, Shuffle, Sun, UserCog, Users, Vote,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';

type Me = { email: string; display_name: string; roles: string[]; permissions: string[] };
const NAV: { group: string; items: { href: string; label: string; icon: typeof Gauge; perm: string; badge?: 'reports' | 'approvals' }[] }[] = [
  { group: 'Genel', items: [{ href: '/', label: 'Kontrol paneli', icon: Gauge, perm: 'dashboard.read' }] },
  { group: 'Topluluk', items: [
    { href: '/users', label: 'Kullanıcılar', icon: Users, perm: 'users.read' },
    { href: '/reports', label: 'Şikâyetler', icon: Flag, perm: 'reports.read', badge: 'reports' },
  ] },
  { group: 'Gelir', items: [
    { href: '/pricing', label: 'Fiyatlandırma', icon: BadgePercent, perm: 'catalog.read' },
    { href: '/approvals', label: 'Onaylar', icon: Vote, perm: 'finance.read', badge: 'approvals' },
  ] },
  { group: 'Ürün', items: [
    { href: '/discovery', label: 'Shuffle ayarları', icon: Shuffle, perm: 'catalog.read' },
    { href: '/banners', label: 'Bannerlar', icon: ImageIcon, perm: 'catalog.read' },
  ] },
  { group: 'Güvenlik', items: [
    { href: '/audit', label: 'Denetim kaydı', icon: ScrollText, perm: 'audit.read' },
    { href: '/staff', label: 'Ekip', icon: UserCog, perm: 'staff.manage' },
  ] },
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [counts, setCounts] = useState<{ reports: number; approvals: number }>({ reports: 0, approvals: 0 });
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => { api<Me>('me').then((r) => setMe(r.data), () => {}); }, []);
  useEffect(() => {
    if (!me?.permissions.includes('dashboard.read')) return;
    api<{ reports_open: number; approvals_pending: number }>('dashboard').then((r) => setCounts({ reports: r.data.reports_open, approvals: r.data.approvals_pending }), () => {});
  }, [me, path]);
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem('flero-admin-theme'); } catch {}
    if (saved === 'light' || saved === 'dark') setTheme(saved);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('flero-admin-theme', theme); } catch {}
  }, [theme]);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open]);

  const logout = async () => { await fetch('/api/session', { method: 'DELETE' }); router.replace('/login'); };
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  return (
    <div className="shell">
      <div className="mobile-bar">
        <button className="btn btn-ghost icon-btn" aria-label="Menüyü aç" aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen(true)}><Menu size={20} /></button>
        <span className="brand" style={{ padding: 0 }}><span className="brand-mark">F</span>FLERO</span>
      </div>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden />}
      <aside id="sidebar" className="sidebar" data-open={open} aria-label="Ana gezinme">
        <div className="brand"><span className="brand-mark" aria-hidden>F</span><span>FLERO<br /><small>Yönetim</small></span></div>
        <nav>
          {NAV.map((g) => {
            const items = g.items.filter((i) => !me || me.permissions.includes(i.perm) || me.roles.includes('SUPERADMIN'));
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <div className="nav-group">{g.group}</div>
                {items.map(({ href, label, icon: Icon, badge }) => (
                  <Link key={href} href={href} className="nav-link" aria-current={active(href) ? 'page' : undefined}>
                    <Icon size={17} aria-hidden />{label}
                    {badge && counts[badge] > 0 && <span className="count num" aria-label={`${counts[badge]} bekleyen`}>{counts[badge]}</span>}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          {me ? <div><div style={{ color: 'var(--text)', fontWeight: 600 }}>{me.display_name}</div><div>{me.roles.join(', ')}</div></div> : <div className="skeleton" style={{ height: 30 }} />}
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'}>
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}{theme === 'dark' ? 'Açık' : 'Koyu'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={logout}><LogOut size={15} aria-hidden />Çıkış</button>
          </div>
        </div>
      </aside>
      <main className="main" id="main">{children}</main>
    </div>
  );
}

export function PageHead({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div><h1>{title}</h1>{description && <p>{description}</p>}</div>
      {actions && <div className="toolbar">{actions}</div>}
    </header>
  );
}
