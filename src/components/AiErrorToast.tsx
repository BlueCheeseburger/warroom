import React, { useEffect, useRef, useState } from 'react';

// Listens for the `warroom:ai-error` DOM event dispatched by preload.ts's
// wrapper around every `window.warroom.ai.*` method (see the comment there).
// That wrapper only fires once an AI call has actually exhausted its retries
// (electron/main.ts's `withDelayedRetry`: 8s, 30s, 60s — 4 attempts total) or
// thrown outright, so anything landing here is a real, final failure worth a
// toast, not a mid-flight retry. Mounted once, near the root, in App.tsx —
// every AI feature gets this for free without adding its own toast wiring.
//
// Design constraint: this can fire while the user is mid-round flowing, so it
// must never become a wall of text over the flow. It stays ONE small line by
// default (the provider's message is one click away), collapses repeats of the
// same error into a xN counter instead of stacking, and shows at most two at
// once. The full provider text is preserved verbatim — see below.
//
// The message is the EXACT error text the provider (Gemini/OpenAI/Anthropic/
// Grok) returned — see the `*HttpError` functions in main.ts, which build it
// from that provider's own error JSON (message + status/type/code), never a
// paraphrase. Expanding the toast shows it in full; the collapsed line shows
// its first sentence. This is deliberately different from the friendlier,
// humanized message a feature's own inline error UI might show via
// `humanizeGeminiError` — that's for "what should I do", this toast is for
// "what actually happened". See CLAUDE.md's "AI call retries" rule.
interface AiToast {
  id: number;
  source: string;
  message: string;
  count: number;
  /**
   * 'warning' = the call SUCCEEDED but on less input than the user supplied
   * (see `capForPrompt` in main.ts). Worth telling them before they trust the
   * answer, but it isn't a failure, so it reads differently from an error.
   */
  kind: 'error' | 'warning';
}

const MAX_TOASTS = 2;
const DISMISS_MS = 7000;

let nextId = 1;

// A one-line "what to do about it" for the handful of provider errors that have
// a specific, user-side fix. Shown UNDER the verbatim provider message, never in
// place of it (CLAUDE.md: the toast shows the exact error). Null for everything
// else — most errors have nothing actionable to add.
export function hintFor(message: string): string | null {
  const m = message.toLowerCase();
  if (m.includes('location is not supported') || (m.includes('failed_precondition') && m.includes('location')))
    return "Decided by your network's IP, not where you are — a VPN or Cloudflare WARP being on is the usual cause, even in the US. Turn it off and try again.";
  if (m.includes('api key not valid') || m.includes('api_key_invalid') || m === 'no_key' || m.includes('add your'))
    return 'Check the API key in Settings → AI.';
  if (m.includes('not found') && m.includes('model'))
    return 'Pick a different model in Settings → AI.';
  return null;
}

// First sentence / clause of a provider error, for the collapsed one-line view.
// Gemini's quota errors run several hundred characters with URLs and metric
// names; the useful part is almost always up front.
function shortMessage(msg: string): string {
  const firstLine = msg.split('\n')[0].trim();
  const m = firstLine.match(/^(.{0,110}?[.!?])(\s|$)/);
  const short = (m ? m[1] : firstLine).trim();
  return short.length > 120 ? short.slice(0, 119) + '…' : short;
}

export default function AiErrorToast() {
  const [toasts, setToasts] = useState<AiToast[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // Mirror of `toasts` so the event handler can check for a duplicate WITHOUT
  // doing side effects (arming timers) inside a setState updater — React is
  // free to re-run updaters, and a re-run would leak timers / double-count.
  const shown = useRef<AiToast[]>([]);

  useEffect(() => {
    function onAiError(e: Event) {
      const detail = (e as CustomEvent).detail as { source?: string; message?: string } | undefined;
      const message = detail?.message || 'Warroom AI ran into a problem.';
      const source = detail?.source || 'Warroom AI';

      // Same error already on screen → bump its counter and restart its timer
      // rather than stacking another copy. One flaky key or an exhausted quota
      // hit from several features reads as "×4", not four walls of text.
      const dup = shown.current.find((t) => t.message === message);
      if (dup) {
        arm(dup.id);
        setToasts((prev) => prev.map((t) => (t.id === dup.id ? { ...t, count: t.count + 1 } : t)));
        return;
      }
      const id = nextId++;
      arm(id);
      setToasts((prev) => [...prev, { id, source, message, count: 1, kind: 'error' as const }].slice(-MAX_TOASTS));
    }

    // Input had to be cut down to fit — the answer is real but partial.
    function onAiWarning(e: Event) {
      const d = (e as CustomEvent).detail as { label?: string; kept?: number; total?: number } | undefined;
      const total = d?.total ?? 0;
      const kept = d?.kept ?? 0;
      const pct = total > 0 ? Math.round((kept / total) * 100) : 0;
      const message =
        `Only the first ${kept.toLocaleString()} of ${total.toLocaleString()} characters ` +
        `(${pct}%) of ${d?.label || 'your input'} were sent to Warroom AI — it was too long to send in full, ` +
        `so this answer is based on part of it.`;
      const dup = shown.current.find((t) => t.message === message);
      if (dup) { arm(dup.id); return; }
      const id = nextId++;
      arm(id);
      setToasts((prev) => [...prev, { id, source: 'Input shortened', message, count: 1, kind: 'warning' as const }].slice(-MAX_TOASTS));
    }

    window.addEventListener('warroom:ai-error', onAiError);
    window.addEventListener('warroom:ai-warning', onAiWarning);
    return () => {
      window.removeEventListener('warroom:ai-error', onAiError);
      window.removeEventListener('warroom:ai-warning', onAiWarning);
    };
  }, []);

  useEffect(() => { shown.current = toasts; }, [toasts]);

  // Drop timers for toasts that fell off the end of the MAX_TOASTS window, so a
  // long burst can't leave orphaned timers running against ids that are gone.
  useEffect(() => {
    const live = new Set(toasts.map((t) => t.id));
    for (const [id, timer] of timers.current) {
      if (!live.has(id)) { clearTimeout(timer); timers.current.delete(id); }
    }
  }, [toasts]);

  // Clear everything on unmount.
  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t); timers.current.clear(); }, []);

  function arm(id: number) {
    const existing = timers.current.get(id);
    if (existing) clearTimeout(existing);
    timers.current.set(id, setTimeout(() => dismiss(id), DISMISS_MS));
  }

  function dismiss(id: number) {
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
    setToasts((prev) => prev.filter((t) => t.id !== id));
    setExpanded((cur) => (cur === id ? null : cur));
  }

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed', bottom: 16, right: 16,
        zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 6,
        alignItems: 'flex-end', pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => {
        const isOpen = expanded === t.id;
        const hint = t.kind === 'error' ? hintFor(t.message) : null;
        return (
          <div
            key={t.id}
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-med)',
              // Amber for "ran, but on partial input"; red for an outright failure.
              borderLeft: `2px solid ${t.kind === 'warning' ? 'rgb(var(--warn-rgb))' : 'var(--danger, #e5484d)'}`,
              borderRadius: 8,
              padding: '6px 8px 6px 10px',
              maxWidth: isOpen ? 420 : 340,
              boxShadow: '0 2px 12px rgba(0,0,0,0.28)',
              display: 'flex', alignItems: 'flex-start', gap: 8,
              fontSize: 12, lineHeight: 1.4,
              color: 'rgb(var(--ink-rgb))',
              pointerEvents: 'auto',
              opacity: 0.97,
            }}
          >
            <span
              onClick={() => setExpanded(isOpen ? null : t.id)}
              title={isOpen ? 'Show less' : t.kind === 'warning' ? 'Show what was cut' : 'Show the full error'}
              style={{ flex: 1, cursor: 'pointer', minWidth: 0 }}
            >
              <span
                style={{
                  display: 'block',
                  ...(isOpen
                    ? { maxHeight: 180, overflowY: 'auto', wordBreak: 'break-word' as const }
                    : { whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }),
                }}
              >
                {isOpen ? t.message : shortMessage(t.message)}
              </span>
              {/* The fix, when there is a specific one — under the exact error, never instead of it. */}
              {hint && (
                <span style={{ display: 'block', marginTop: 3, fontSize: 11, lineHeight: 1.35, opacity: 0.75, whiteSpace: 'normal' }}>
                  {hint}
                </span>
              )}
            </span>
            {t.count > 1 && (
              <span
                title={`${t.count} times`}
                style={{
                  flexShrink: 0, fontSize: 10, fontWeight: 600,
                  padding: '1px 5px', borderRadius: 999,
                  background: 'var(--bg-main)', color: 'var(--ink-muted, rgb(var(--ink-rgb)))',
                  opacity: 0.75,
                }}
              >×{t.count}</span>
            )}
            <button
              onClick={() => dismiss(t.id)}
              className="text-ink/40 hover:text-ink"
              style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1 }}
              aria-label="Dismiss"
            >✕</button>
          </div>
        );
      })}
    </div>
  );
}
