import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useApp } from '../store/appStore';

function buildDarkCSS(): string {
  // Resolve the app's actual background color so the webview matches exactly.
  // Falls back to the known dark value if CSS variables aren't available yet.
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue('--bg-main').trim() || '#1c1c1e';
  return `
    html { filter: invert(1) hue-rotate(180deg); background: ${bg} !important; }
    img, video, [style*="background-image"] { filter: invert(1) hue-rotate(180deg); }
  `;
}

const INJECT = (css: string) => `
  (function() {
    let s = document.getElementById('__warroom_dark__');
    if (!s) {
      s = document.createElement('style');
      s.id = '__warroom_dark__';
      document.head.appendChild(s);
    }
    s.textContent = ${JSON.stringify(css)};
  })();
`;

export default function GoogleScholarView() {
  const webviewRef = useRef<HTMLElement>(null);
  const [loading, setLoading] = useState(true);
  const { theme } = useApp();
  const pendingSearchQuery = useApp(s => s.pendingSearchQuery);
  const setPendingSearchQuery = useApp(s => s.setPendingSearchQuery);

  // True if dark mode is currently active (handles system preference)
  const effectiveDark = useCallback((): boolean => {
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }, [theme]);

  // Push CSS into the webview (safe to call before page loads — fails silently)
  const applyTheme = useCallback((dark: boolean) => {
    const wv = webviewRef.current as any;
    if (!wv) return;
    try { wv.executeJavaScript(INJECT(dark ? buildDarkCSS() : '')).catch(() => {}); } catch {}
  }, []);

  // Wire up the webview load event
  useEffect(() => {
    const wv = webviewRef.current as any;
    if (!wv) return;
    const onLoad = () => { setLoading(false); applyTheme(effectiveDark()); };
    wv.addEventListener('did-finish-load', onLoad);
    return () => wv.removeEventListener('did-finish-load', onLoad);
  }, [applyTheme, effectiveDark]);

  // Re-inject whenever the user switches theme in the title bar
  useEffect(() => {
    applyTheme(effectiveDark());
  }, [theme, applyTheme, effectiveDark]);

  useEffect(() => {
    if (!pendingSearchQuery) return;
    setPendingSearchQuery('');
    const wv = webviewRef.current as any;
    if (!wv) return;
    const url = `https://scholar.google.com/scholar?q=${encodeURIComponent(pendingSearchQuery)}`;
    try { wv.loadURL(url); } catch { wv.src = url; }
  }, [pendingSearchQuery]);

  // Also react to OS-level dark/light changes when theme is "system"
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme, applyTheme]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-8 pt-8 pb-4 shrink-0">
        <h1 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>Google Scholar</h1>
        <p className="text-xs mt-1" style={{ color: 'var(--placeholder)' }}>
          Search academic papers and citations
        </p>
      </div>
      <div className="flex-1 px-4 pb-4 min-h-0 relative">
        {loading && (
          <div
            className="absolute inset-4 flex items-center justify-center rounded-xl text-xs z-10"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: 'var(--placeholder)' }}
          >
            Loading Google Scholar…
          </div>
        )}
        <div
          className="w-full h-full rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--border-subtle)' }}
        >
          <webview
            ref={webviewRef as any}
            src="https://scholar.google.com"
            allowpopups={true}
            className="w-full h-full"
            style={{ display: 'flex' }}
          />
        </div>
      </div>
    </div>
  );
}
