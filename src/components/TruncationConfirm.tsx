import React, { useEffect, useState } from 'react';

// Asks before an over-long input is sent to Warroom AI in shortened form.
//
// This used to happen silently: a handler did `text.slice(0, 60000)` and the
// model answered confidently on a fraction of the document. Then it warned
// AFTER the fact — better, but the call (and the money) was already spent, and
// the user was told about a decision they were never given.
//
// Now `capForPrompt` in electron/main.ts blocks on this dialog before calling
// the model. Declining aborts the call outright; the feature's own error UI
// shows "Cancelled — nothing was sent to Warroom AI."
//
// Several inputs can be over the limit in one operation (Round Analysis caps the
// flow, each uploaded doc, and the docs as a whole), so asks that arrive while
// the dialog is already open are COLLECTED into the same dialog and answered
// together — one decision, not a stack of modals.
//
// Mounted once in App.tsx, next to AiErrorToast.

interface Ask {
  id: number;
  label: string;
  kept: number;
  total: number;
}

export default function TruncationConfirm() {
  const [asks, setAsks] = useState<Ask[]>([]);

  useEffect(() => {
    const off = window.warroom.aiInput?.onTruncationAsk?.((p) => {
      setAsks((prev) => (prev.some((a) => a.id === p.id) ? prev : [...prev, p]));
    });
    return () => off?.();
  }, []);

  function answer(proceed: boolean) {
    for (const a of asks) window.warroom.aiInput?.respondTruncation?.(a.id, proceed);
    setAsks([]);
  }

  // Enter = send shortened, Escape = cancel. Matches the button order below.
  useEffect(() => {
    if (asks.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); answer(false); }
      if (e.key === 'Enter') { e.preventDefault(); answer(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (asks.length === 0) return null;

  const multiple = asks.length > 1;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={() => answer(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-med)',
          borderRadius: 10,
          maxWidth: 480, width: '100%',
          padding: '18px 20px',
          boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
          color: 'rgb(var(--ink-rgb))',
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>
          {multiple ? 'Some inputs are too long to send in full' : 'This is too long to send in full'}
        </h2>

        <p style={{ fontSize: 12, lineHeight: 1.55, margin: '0 0 12px', color: 'rgba(var(--ink-rgb), 0.7)' }}>
          Warroom AI can only take so much text at once. Sending {multiple ? 'these' : 'this'} shortened
          means the answer is based on {multiple ? 'part of each one' : 'part of it'} — usually the
          beginning — so anything later on won't be considered.
        </p>

        <div
          style={{
            border: '1px solid var(--border-subtle)', borderRadius: 7,
            padding: '8px 10px', marginBottom: 14,
            background: 'var(--bg-main)',
            maxHeight: 160, overflowY: 'auto',
          }}
        >
          {asks.map((a) => {
            const pct = a.total > 0 ? Math.round((a.kept / a.total) * 100) : 0;
            return (
              <div key={a.id} style={{ fontSize: 11.5, lineHeight: 1.6 }}>
                <strong>{a.label}</strong> — sending {a.kept.toLocaleString()} of{' '}
                {a.total.toLocaleString()} characters{' '}
                <span style={{ color: 'rgb(var(--warn-rgb))' }}>({pct}%)</span>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn text-xs" onClick={() => answer(false)} title="Cancel (Esc)">
            Cancel
          </button>
          <button className="btn-primary text-xs" onClick={() => answer(true)} title="Send shortened (Enter)">
            Send shortened anyway
          </button>
        </div>
      </div>
    </div>
  );
}
