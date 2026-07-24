import React, { useEffect, useRef } from 'react';
import { useApp } from '../store/appStore';

// Bottom-left "X deleted" toast with a 3.5s Undo window, shown after a
// destructive action (delete case/block/card/tournament/etc — see call sites).
// Mounted once, near the root, in App.tsx — mirrors AiErrorToast.tsx's pattern
// but sits bottom-LEFT (AiErrorToast owns bottom-right) and is driven by the
// Zustand store (`pushUndoToast`/`dismissUndoToast`) rather than a DOM event,
// since every delete call site already has `useApp()` in scope.
const DISMISS_MS = 3500;

export default function UndoToast() {
  const undoToasts = useApp((s) => s.undoToasts);
  const dismissUndoToast = useApp((s) => s.dismissUndoToast);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    for (const t of undoToasts) {
      if (timers.current.has(t.id)) continue;
      timers.current.set(t.id, setTimeout(() => {
        timers.current.delete(t.id);
        dismissUndoToast(t.id);
      }, DISMISS_MS));
    }
    const live = new Set(undoToasts.map((t) => t.id));
    for (const [id, timer] of timers.current) {
      if (!live.has(id)) { clearTimeout(timer); timers.current.delete(id); }
    }
  }, [undoToasts, dismissUndoToast]);

  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t); timers.current.clear(); }, []);

  if (undoToasts.length === 0) return null;

  async function handleUndo(id: string, onUndo: () => void | Promise<void>) {
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
    dismissUndoToast(id);
    await onUndo();
  }

  return (
    <div
      style={{
        position: 'fixed', bottom: 16, left: 16,
        zIndex: 9999, display: 'flex', flexDirection: 'column-reverse', gap: 6,
        alignItems: 'flex-start', pointerEvents: 'none',
      }}
    >
      {undoToasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-med)',
            borderRadius: 8,
            padding: '8px 10px',
            minWidth: 220,
            maxWidth: 340,
            boxShadow: '0 2px 12px rgba(0,0,0,0.28)',
            display: 'flex', alignItems: 'center', gap: 10,
            fontSize: 12, lineHeight: 1.4,
            color: 'rgb(var(--ink-rgb))',
            pointerEvents: 'auto',
            opacity: 0.97,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {t.message}
          </span>
          <button
            onClick={() => handleUndo(t.id, t.onUndo)}
            className="text-accent hover:opacity-80"
            style={{
              flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
              padding: 0, fontSize: 12, fontWeight: 600,
              color: 'var(--accent, #3b82f6)',
            }}
          >
            Undo
          </button>
          <div
            key={`${t.id}-bar`}
            style={{
              position: 'absolute', left: 0, bottom: 0, height: 2,
              background: 'var(--accent, #3b82f6)', opacity: 0.5,
              animation: `warroom-undo-shrink ${DISMISS_MS}ms linear forwards`,
            }}
          />
        </div>
      ))}
      <style>{`
        @keyframes warroom-undo-shrink {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
}
