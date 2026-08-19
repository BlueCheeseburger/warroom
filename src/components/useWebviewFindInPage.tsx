import { useState, useEffect, useCallback } from 'react';
import { matchesShortcut } from '../lib/shortcutPrefs';

// ⌘F / Ctrl+F find-in-page for an embedded <webview> (Logos, OpenEvidence,
// OpenCaselist, Google Scholar). Unlike useInPageFind.tsx's CSS Custom
// Highlight approach — which walks THIS document's DOM text nodes — a
// webview's content lives in a separate renderer process/document that the
// host page's DOM can't see at all, so matching has to go through Electron's
// native WebContents find API (webview.findInPage / found-in-page) instead.
// Exposes the exact same {open, query, idx, count, step, close} shape as
// useInPageFind so the same <FindBar> component renders both.

/**
 * `active` gates the ⌘F listener — Logos/OpenEv/Google Scholar are all kept
 * permanently mounted (just `display:none`'d) so navigating away and back
 * doesn't reload them, so without this every one of them would react to a
 * single ⌘F press at once regardless of which is actually on screen.
 */
export function useWebviewFindInPage(webviewRef: React.RefObject<any>, active: boolean) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [idx, setIdx] = useState(0);
  const [count, setCount] = useState(0);

  const run = useCallback((q: string, forward: boolean, findNext: boolean) => {
    const wv = webviewRef.current;
    if (!wv) return;
    if (!q.trim()) {
      try { wv.stopFindInPage('clearSelection'); } catch {}
      setCount(0); setIdx(0);
      return;
    }
    try { wv.findInPage(q, { forward, findNext, matchCase: false }); } catch {}
  }, [webviewRef]);

  // Debounced re-run as the query changes — a fresh search, not "find next".
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => run(query, true, false), 200);
    return () => window.clearTimeout(t);
  }, [query, open, run]);

  // Electron reports match count + which one is active via this event —
  // fires on every findInPage/findNext call, so it's the only source of
  // truth for `count`/`idx` (there's nothing to compute locally).
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    function onFound(e: any) {
      const matches = e?.result?.matches;
      const ordinal = e?.result?.activeMatchOrdinal;
      if (typeof matches === 'number') setCount(matches);
      if (typeof ordinal === 'number') setIdx(Math.max(0, ordinal - 1));
    }
    wv.addEventListener('found-in-page', onFound);
    return () => wv.removeEventListener('found-in-page', onFound);
  }, [webviewRef]);

  const step = useCallback((dir: 1 | -1) => {
    if (!query.trim()) return;
    run(query, dir === 1, true);
  }, [query, run]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setCount(0);
    setIdx(0);
    try { webviewRef.current?.stopFindInPage('clearSelection'); } catch {}
  }, [webviewRef]);

  // ⌘F / Ctrl+F opens the bar; Esc closes it. Only while this webview is the
  // one actually visible — see the `active` note above.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active) return;
      if (matchesShortcut(e, 'find-page')) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === 'Escape' && open) {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, open, close]);

  // Navigated away while the find bar was open — close it rather than leave
  // a stale find session running behind a hidden webview.
  useEffect(() => {
    if (!active && open) close();
  }, [active, open, close]);

  useEffect(() => () => { try { webviewRef.current?.stopFindInPage('clearSelection'); } catch {} }, [webviewRef]);

  return { open, setOpen, query, setQuery, idx, count, step, close };
}
