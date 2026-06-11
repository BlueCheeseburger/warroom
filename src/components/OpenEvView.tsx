import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useApp } from '../store/appStore';

// ─── URL guard ────────────────────────────────────────────────────────────────

// Credentials are only ever auto-filled on opencaselist.com (or its subdomains).
export function isOpenCaselistUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'opencaselist.com' || host.endsWith('.opencaselist.com');
  } catch {
    return false;
  }
}

// ─── Dark mode ────────────────────────────────────────────────────────────────

const DARK_CSS = `
  html { filter: invert(1) hue-rotate(180deg); }
  img, video, [style*="background-image"] { filter: invert(1) hue-rotate(180deg); }
`;

const INJECT_DARK = (css: string) => `
  (function() {
    let s = document.getElementById('__warroom_dark__');
    if (!s) { s = document.createElement('style'); s.id = '__warroom_dark__'; document.head.appendChild(s); }
    s.textContent = ${JSON.stringify(css)};
  })();
`;

// ─── Auto-fill script (MutationObserver-based, runs once per page) ────────────

function buildFillScript(username: string, password: string): string {
  return `
    (function() {
      if (window.__warroom_fill_done__) return;

      const user = ${JSON.stringify(username)};
      const pass = ${JSON.stringify(password)};
      if (!user || !pass) return;

      function fill(el, value) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(el, value); else el.value = value;
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      function tryFill() {
        const passField = document.querySelector('input[type="password"]');
        const userField = document.querySelector(
          'input[name="username"], input[id="username"], input[autocomplete="username"], input[type="email"], input[type="text"]:not([type="search"])'
        );
        if (!passField || !userField) return false;

        window.__warroom_fill_done__ = true;
        fill(userField, user);
        fill(passField, pass);
        setTimeout(() => {
          const btn = document.querySelector('button[type="submit"], input[type="submit"], form button');
          if (btn) btn.click();
          else { const f = document.querySelector('form'); if (f) f.submit(); }
        }, 200);
        return true;
      }

      // Try immediately (fields may already be in DOM)
      if (tryFill()) return;

      // Otherwise watch for the form to appear (SPA renders async)
      const obs = new MutationObserver(() => { if (tryFill()) obs.disconnect(); });
      obs.observe(document.documentElement, { childList: true, subtree: true });

      // Stop watching after 12s
      setTimeout(() => obs.disconnect(), 12000);
    })();
  `;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OpenEvView() {
  const webviewRef = useRef<HTMLElement>(null);
  const [loading, setLoading] = useState(true);
  const redirectedRef = useRef(false);
  const { theme } = useApp();

  const effectiveDark = useCallback((): boolean => {
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }, [theme]);

  const applyDark = useCallback((dark: boolean) => {
    const wv = webviewRef.current as any;
    if (!wv) return;
    try { wv.executeJavaScript(INJECT_DARK(dark ? DARK_CSS : '')).catch(() => {}); } catch {}
  }, []);

  // After a successful login, opencaselist lands on its home page ("/"), not Open Ev.
  // When we detect an authenticated session — opencaselist renders a "Logout" link only
  // when logged in — on any non-/openev page, send the webview to /openev. The positive
  // logout-link signal plus the once-guard prevent bouncing while logged out, where the
  // home page shows the login form instead.
  const enterOpenEvIfLoggedIn = useCallback(async () => {
    const wv = webviewRef.current as any;
    if (!wv || redirectedRef.current) return;
    const current = wv.getURL?.() || '';
    if (!isOpenCaselistUrl(current)) return;
    let path = '/';
    try { path = new URL(current).pathname; } catch {}
    if (path.startsWith('/openev')) return;
    try {
      const loggedIn = await wv.executeJavaScript(`!!document.querySelector('a[href*="logout" i]')`);
      if (loggedIn) {
        redirectedRef.current = true;
        wv.loadURL?.('https://opencaselist.com/openev');
      }
    } catch {}
  }, []);

  useEffect(() => {
    const wv = webviewRef.current as any;
    if (!wv) return;

    const onLoad = async () => {
      setLoading(false);
      applyDark(effectiveDark());

      if (!isOpenCaselistUrl(wv.getURL?.())) return;

      const [username, password] = await Promise.all([
        window.warroom?.secure.get('oc_username'),
        window.warroom?.secure.get('oc_password'),
      ]);

      try {
        await wv.executeJavaScript(buildFillScript(username ?? '', password ?? ''));
      } catch {}

      // If login succeeds without a navigation event we can hook, poll a few times to
      // catch the authenticated state and move to Open Ev.
      [1500, 3500, 6000].forEach((ms) => setTimeout(enterOpenEvIfLoggedIn, ms));
    };

    // Fire on both events — dom-ready catches earlier, did-finish-load is the fallback
    wv.addEventListener('dom-ready', onLoad);
    wv.addEventListener('did-finish-load', onLoad);
    // Catch the post-login navigation (full load or SPA route change) → enter Open Ev
    wv.addEventListener('did-navigate', enterOpenEvIfLoggedIn);
    wv.addEventListener('did-navigate-in-page', enterOpenEvIfLoggedIn);
    return () => {
      wv.removeEventListener('dom-ready', onLoad);
      wv.removeEventListener('did-finish-load', onLoad);
      wv.removeEventListener('did-navigate', enterOpenEvIfLoggedIn);
      wv.removeEventListener('did-navigate-in-page', enterOpenEvIfLoggedIn);
    };
  }, [applyDark, effectiveDark, enterOpenEvIfLoggedIn]);

  // Re-apply dark mode when user switches theme
  useEffect(() => { applyDark(effectiveDark()); }, [theme, applyDark, effectiveDark]);

  // React to OS dark/light toggle when theme is "system"
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme, applyDark]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-8 pt-8 pb-4 shrink-0">
        <h1 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>Open Ev</h1>
        <p className="text-xs mt-1" style={{ color: 'var(--placeholder)' }}>
          Browse open-source evidence · Signs in automatically with your Settings credentials
        </p>
      </div>
      <div className="flex-1 px-4 pb-4 min-h-0 relative">
        {loading && (
          <div
            className="absolute inset-4 flex items-center justify-center rounded-xl text-xs z-10"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: 'var(--placeholder)' }}
          >
            Loading Open Ev…
          </div>
        )}
        <div
          className="w-full h-full rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--border-subtle)' }}
        >
          <webview
            ref={webviewRef as any}
            src="https://opencaselist.com/openev"
            allowpopups="true"
            className="w-full h-full"
            style={{ display: 'flex' }}
          />
        </div>
      </div>
    </div>
  );
}
