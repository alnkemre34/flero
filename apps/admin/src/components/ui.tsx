'use client';

import { CheckCircle2, Inbox, Loader2, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// ---------- toast (one polite live region; success is shown only after the server confirmed) ----------
type Toast = { id: number; kind: 'success' | 'error'; text: string };
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-2), { id, kind, text }]); // never more than 3 on screen
    setTimeout(() => setItems((xs) => xs.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast" data-kind={t.kind}>
            {t.kind === 'success' ? <CheckCircle2 size={18} aria-hidden /> : <XCircle size={18} aria-hidden />}
            <span style={{ flex: 1 }}>{t.text}</span>
            <button className="btn btn-ghost btn-sm icon-btn" aria-label="Bildirimi kapat" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}><X size={14} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- dialog (native <dialog>: focus trap, Escape and inert background built in; focus returns to opener) ----------
export function Dialog({ open, onClose, title, description, children, footer }: {
  open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { opener.current = document.activeElement; d.showModal(); }
    if (!open && d.open) { d.close(); (opener.current as HTMLElement | null)?.focus?.(); }
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="dlg-title" onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {open && (
        <>
          <div className="dialog-head">
            <h2 id="dlg-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <div className="dialog-body">{children}</div>
          <div className="dialog-foot">{footer}</div>
        </>
      )}
    </dialog>
  );
}

// ---------- button with a loading state that blocks double submit ----------
export function Button({ busy, children, className = '', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button {...p} className={`btn ${className}`} disabled={p.disabled || busy} aria-busy={busy || undefined}>
      {busy && <Loader2 size={15} className="spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children, id }: { label: string; hint?: string; error?: string | null; children: ReactNode; id: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? <span className="error" id={`${id}-err`}>{error}</span> : hint ? <span className="hint" id={`${id}-hint`}>{hint}</span> : null}
    </div>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return <div className="empty">{icon ?? <Inbox size={28} aria-hidden />}<strong>{title}</strong>{children && <span>{children}</span>}</div>;
}

export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <tbody aria-hidden>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>{Array.from({ length: cols }, (_, c) => <td key={c}><div className="skeleton" style={{ height: 14, width: `${50 + ((r * 7 + c * 13) % 45)}%` }} /></td>)}</tr>
      ))}
    </tbody>
  );
}

export function ErrorState({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <div className="alert alert-danger" role="alert">
      <XCircle size={18} aria-hidden style={{ color: 'var(--danger)', flexShrink: 0 }} />
      <div style={{ flex: 1 }}>{error.message}</div>
      <button className="btn btn-sm" onClick={retry}>Tekrar dene</button>
    </div>
  );
}

const STATE_BADGE: Record<string, string> = { ACTIVE: 'b-success', SUSPENDED: 'b-warning', BANNED: 'b-danger', DELETED: '', PENDING_DELETION: 'b-warning' };
const STATE_TR: Record<string, string> = { ACTIVE: 'Aktif', SUSPENDED: 'Askıda', BANNED: 'Yasaklı', DELETED: 'Silindi', PENDING_DELETION: 'Silinecek' };
export const StateBadge = ({ state }: { state: string }) => <span className={`badge badge-dot ${STATE_BADGE[state] ?? ''}`}>{STATE_TR[state] ?? state}</span>;

/** Gold amount with the FLERO "G" coin (never a crypto symbol). */
export const Gold = ({ v }: { v: number | string }) => (
  <span className="num" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
    <span aria-hidden style={{ width: 14, height: 14, borderRadius: '50%', background: 'var(--gold)', color: '#1a1300', fontSize: 9, fontWeight: 800, display: 'grid', placeItems: 'center', fontFamily: 'var(--font-ui)' }}>G</span>
    {new Intl.NumberFormat('tr-TR').format(Number(v))}
  </span>
);

/** Data hook with loading / error / reload and stale-response protection. */
export function useData<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, set] = useState<{ data: T | null; error: Error | null; loading: boolean }>({ data: null, error: null, loading: true });
  const gen = useRef(0);
  const run = useCallback(() => {
    const g = ++gen.current;
    set((s) => ({ ...s, loading: true, error: null }));
    load().then((data) => { if (g === gen.current) set({ data, error: null, loading: false }); },
      (error: Error) => { if (g === gen.current) set((s) => ({ ...s, error, loading: false })); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}
