'use client';

/** Turkish error boundary: never shows a raw (English) exception message to staff. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main style={{ minHeight: '60dvh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="card" role="alert" style={{ padding: 28, maxWidth: 440, textAlign: 'center', display: 'grid', gap: 12 }}>
        <h1 style={{ margin: 0, font: '700 22px/1.2 var(--font-display)' }}>Bir şeyler ters gitti</h1>
        <p className="muted" style={{ margin: 0 }}>Sayfa yüklenirken beklenmeyen bir hata oluştu. Tekrar deneyin; sorun sürerse teknik ekibe bildirin.</p>
        <button className="btn btn-primary" style={{ justifySelf: 'center' }} onClick={reset}>Tekrar dene</button>
      </div>
    </main>
  );
}
