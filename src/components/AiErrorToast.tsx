import React, { useEffect, useRef, useState } from 'react';

// Listens for the `warroom:ai-error` DOM event dispatched by preload.ts's
// wrapper around every `window.warroom.ai.*` method (see the comment there).
// That wrapper only fires once an AI call has actually exhausted its retries
// (electron/main.ts's `withDelayedRetry`: 8s, 30s, 60s — 4 attempts total) or
// thrown outright, so anything landing here is a real, final failure worth a
// toast, not a mid-flight retry. Mounted once, near the root, in App.tsx —
// every AI feature gets this for free without adding its own toast wiring.
interface AiToast {
  id: number;
  source: string;
  message: string;
}

let nextId = 1;

export default function AiErrorToast() {
  const [toasts, setToasts] = useState<AiToast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    function onAiError(e: Event) {
      const detail = (e as CustomEvent).detail as { source?: string; message?: string } | undefined;
      const id = nextId++;
      const toast: AiToast = { id, source: detail?.source || 'Warroom AI', message: detail?.message || 'Warroom AI ran into a problem.' };
      setToasts((prev) => [...prev, toast]);
      const timer = setTimeout(() => dismiss(id), 8000);
      timers.current.set(id, timer);
    }
    window.addEventListener('warroom:ai-error', onAiError);
    return () => window.removeEventListener('warroom:ai-error', onAiError);
  }, []);

  function dismiss(id: number) {
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
        zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8,
        alignItems: 'center', pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--danger, #e5484d)',
            borderRadius: 10, padding: '10px 14px', maxWidth: 420,
            boxShadow: '0 4px 24px rgba(0,0,0,0.22)',
            display: 'flex', alignItems: 'flex-start', gap: 10,
            fontSize: 13, color: 'rgb(var(--ink-rgb))', pointerEvents: 'auto',
          }}
        >
          <span style={{ fontSize: 15, lineHeight: 1.4 }}>⚠️</span>
          <span style={{ flex: 1, lineHeight: 1.4 }}>{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            className="text-ink/40 hover:text-ink text-sm leading-none"
            style={{ marginLeft: 4 }}
            aria-label="Dismiss"
          >✕</button>
        </div>
      ))}
    </div>
  );
}
