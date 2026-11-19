import Link from 'next/link';

/** Turkish 404 (Next's default page is English). */
export default function NotFound() {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="card" style={{ padding: 28, maxWidth: 420, textAlign: 'center', display: 'grid', gap: 12 }}>
        <h1 style={{ margin: 0, font: '700 22px/1.2 var(--font-display)' }}>Sayfa bulunamadı</h1>
        <p className="muted" style={{ margin: 0 }}>Aradığınız sayfa taşınmış ya da hiç var olmamış olabilir.</p>
        <Link href="/" className="btn btn-primary" style={{ justifySelf: 'center' }}>Kontrol paneline dön</Link>
      </div>
    </main>
  );
}
