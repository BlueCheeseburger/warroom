import React, { useState, useEffect, useCallback, useRef } from 'react';

// Reusable ⌘F / Ctrl+F find-in-page for a scrollable container. Matches are
// painted with the CSS Custom Highlight API (CSS.highlights + Highlight + Range)
// so the DOM is never mutated — works over arbitrary rendered content (the docs
// JSX, the markdown manual, etc.). Mirrors the speech-doc viewer's find.

const HL = 'wr-page-find';
const HL_ACTIVE = 'wr-page-find-active';
const MATCH_CAP = 5000;

function injectStyleOnce() {
  if (document.getElementById('wr-page-find-style')) return;
  const el = document.createElement('style');
  el.id = 'wr-page-find-style';
  el.textContent =
    `::highlight(${HL}) { background: rgba(250,204,21,0.32); border-radius: 2px; }` +
    `::highlight(${HL_ACTIVE}) { background: #facc15; color: #1a1a1a; }`;
  document.head.appendChild(el);
}

function buildMatches(container: HTMLElement, query: string): Range[] {
  const q = query.toLowerCase();
  const out: Range[] = [];
  if (!q.trim()) return out;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(n: Node) {
      return (n as Text).parentElement ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue ?? '';
    const lower = text.toLowerCase();
    let from = 0;
    let i = lower.indexOf(q, from);
    while (i !== -1) {
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + q.length);
      out.push(r);
      if (out.length >= MATCH_CAP) return out;
      from = i + q.length;
      i = lower.indexOf(q, from);
    }
  }
  return out;
}

function paint(all: Range[], active: Range | null) {
  const reg = (CSS as any)?.highlights;
  const H = (window as any)?.Highlight;
  if (!reg || !H) return;
  reg.delete(HL);
  reg.delete(HL_ACTIVE);
  if (all.length) reg.set(HL, new H(...all));
  if (active) reg.set(HL_ACTIVE, new H(active));
}

function clearPaint() {
  const reg = (CSS as any)?.highlights;
  if (reg) { reg.delete(HL); reg.delete(HL_ACTIVE); }
}

export function useInPageFind(containerRef: React.RefObject<HTMLElement>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [idx, setIdx] = useState(0);
  const [count, setCount] = useState(0);
  const rangesRef = useRef<Range[]>([]);

  const scrollToActive = useCallback((r: Range) => {
    const el = r.startContainer.parentElement;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  const run = useCallback((q: string) => {
    const cont = containerRef.current;
    if (!cont) return;
    const ranges = buildMatches(cont, q);
    rangesRef.current = ranges;
    setCount(ranges.length);
    setIdx(0);
    paint(ranges, ranges[0] ?? null);
    if (ranges[0]) scrollToActive(ranges[0]);
  }, [containerRef, scrollToActive]);

  // Debounced re-run as the query changes.
  useEffect(() => {
    if (!open) return;
    injectStyleOnce();
    const t = window.setTimeout(() => run(query), 120);
    return () => window.clearTimeout(t);
  }, [query, open, run]);

  const step = useCallback((dir: 1 | -1) => {
    const ranges = rangesRef.current;
    if (!ranges.length) return;
    const n = (idx + dir + ranges.length) % ranges.length;
    setIdx(n);
    paint(ranges, ranges[n]);
    scrollToActive(ranges[n]);
  }, [idx, scrollToActive]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    rangesRef.current = [];
    setCount(0);
    setIdx(0);
    clearPaint();
  }, []);

  // ⌘F / Ctrl+F opens the bar; Esc closes it. Clean up highlights on unmount.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === 'Escape' && open) {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  useEffect(() => () => clearPaint(), []);

  return { open, setOpen, query, setQuery, idx, count, step, close };
}

/** The floating find bar UI. Render it (conditionally on `open`) inside a
 *  position:relative container. Driven entirely by the hook's state. */
export function FindBar({
  query, setQuery, idx, count, step, close,
}: {
  query: string;
  setQuery: (q: string) => void;
  idx: number;
  count: number;
  step: (dir: 1 | -1) => void;
  close: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  return (
    <div
      className="absolute z-50 flex items-center gap-1.5 rounded-lg px-2 py-1.5 shadow-xl"
      style={{
        top: 12, right: 16,
        background: 'var(--bg-popover, var(--bg-elevated))',
        border: '1px solid var(--border-med)',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="var(--ink-muted)"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8.5" cy="8.5" r="5" /><path d="M12.5 12.5L17 17" />
      </svg>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
          else if (e.key === 'Escape') { e.preventDefault(); close(); }
        }}
        placeholder="Find in page…"
        style={{
          width: 160, background: 'transparent', border: 'none', outline: 'none',
          fontSize: 13, color: 'var(--ink)', fontFamily: 'inherit',
        }}
      />
      <span style={{ fontSize: 11, color: 'var(--placeholder)', minWidth: 38, textAlign: 'right' }}>
        {query.trim() ? `${count ? idx + 1 : 0}/${count}` : ''}
      </span>
      <button onClick={() => step(-1)} disabled={!count} title="Previous (Shift+Enter)"
        style={{ background: 'transparent', border: 'none', cursor: count ? 'pointer' : 'default', color: 'var(--ink-muted)', padding: 2, opacity: count ? 1 : 0.4 }}>
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 12l-5-5-5 5" /></svg>
      </button>
      <button onClick={() => step(1)} disabled={!count} title="Next (Enter)"
        style={{ background: 'transparent', border: 'none', cursor: count ? 'pointer' : 'default', color: 'var(--ink-muted)', padding: 2, opacity: count ? 1 : 0.4 }}>
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 8l5 5 5-5" /></svg>
      </button>
      <button onClick={close} title="Close (Esc)"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', padding: 2 }}>
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 2l10 10M12 2L2 12" /></svg>
      </button>
    </div>
  );
}
