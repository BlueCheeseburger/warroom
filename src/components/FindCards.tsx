import React, { useRef, useState, useEffect } from 'react';
import { useApp } from '../store/appStore';

// CSS injected into the Logos webview to force a clean light theme
const LOGOS_LIGHT_CSS = `
  /* Strip Tailwind dark-mode classes */
  html, body {
    background: #ffffff !important;
    color: #111827 !important;
  }
  /* Override any explicit dark background utilities */
  .bg-black, .bg-gray-900, .bg-gray-800, .bg-gray-700,
  .bg-slate-900, .bg-slate-800, .bg-slate-700,
  .bg-zinc-900,  .bg-zinc-800,  .bg-zinc-700,
  .bg-neutral-900, .bg-neutral-800, .bg-neutral-700 {
    background-color: #f9fafb !important;
  }
  /* Light text that's invisible on white */
  .text-white, .text-gray-100, .text-gray-200, .text-gray-300 {
    color: #111827 !important;
  }
  /* Borders */
  .border-gray-700, .border-gray-800, .border-slate-700 {
    border-color: #e5e7eb !important;
  }
`;

export default function FindCards() {
  const webviewRef = useRef<HTMLElement>(null);
  const [loading, setLoading] = useState(true);
  const pendingSearchQuery = useApp(s => s.pendingSearchQuery);
  const setPendingSearchQuery = useApp(s => s.setPendingSearchQuery);
  const pendingSearchRef = useRef(pendingSearchQuery);

  useEffect(() => {
    if (!pendingSearchQuery) return;
    setPendingSearchQuery(''); // consume immediately
    pendingSearchRef.current = pendingSearchQuery;
    const wv = webviewRef.current as any;
    if (!wv) return;
    const inject = () => {
      if (!pendingSearchRef.current) return;
      const q = pendingSearchRef.current;
      pendingSearchRef.current = '';
      wv.executeJavaScript(`
        (function() {
          const fill = (el, v) => {
            const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (s) s.call(el, v); else el.value = v;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          };
          const input = document.querySelector('input[type="search"], input[placeholder*="earch" i], input[name="q"], input[name="search"], input[id*="search" i], input[type="text"]');
          if (input) {
            fill(input, ${JSON.stringify(q)});
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
            const form = input.closest('form');
            if (form) { try { form.requestSubmit(); } catch { form.submit(); } }
          }
        })();
      `).catch(() => {});
    };
    if (!loading) {
      inject();
    } else {
      const wv2 = webviewRef.current as any;
      if (!wv2) return;
      const onLoad = () => { inject(); wv2.removeEventListener('did-finish-load', onLoad); };
      wv2.addEventListener('did-finish-load', onLoad);
    }
  }, [pendingSearchQuery]);

  useEffect(() => {
    const wv = webviewRef.current as any;
    if (!wv) return;

    const onLoad = async () => {
      setLoading(false);
      try {
        // 1. Remove Tailwind's .dark class (handles class-based dark mode)
        // 2. Set color-scheme to light (handles system dark-mode media queries)
        // 3. Inject CSS overrides for hardcoded dark utilities
        await wv.executeJavaScript(`
          (function() {
            document.documentElement.classList.remove('dark');
            document.body.classList.remove('dark');
            document.documentElement.style.colorScheme = 'light';

            const style = document.createElement('style');
            style.textContent = ${JSON.stringify(LOGOS_LIGHT_CSS)};
            document.head.appendChild(style);
          })();
        `);
      } catch (_) {}
    };

    wv.addEventListener('did-finish-load', onLoad);
    return () => wv.removeEventListener('did-finish-load', onLoad);
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-8 pt-8 pb-4 shrink-0">
        <h1 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>Logos</h1>
        <p className="text-xs mt-1" style={{ color: 'var(--placeholder)' }}>Search the Logos evidence database</p>
      </div>
      <div className="flex-1 px-4 pb-4 min-h-0 relative">
        {loading && (
          <div
            className="absolute inset-4 flex items-center justify-center rounded-xl text-xs z-10"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: 'var(--placeholder)' }}
          >
            Loading Logos…
          </div>
        )}
        <div
          className="w-full h-full rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--border-subtle)' }}
        >
          <webview
            ref={webviewRef as any}
            src="https://logos-debate.netlify.app/"
            allowpopups={true}
            className="w-full h-full"
            style={{ display: 'flex' }}
          />
        </div>
      </div>
    </div>
  );
}
