import React, { useRef, useEffect, useCallback } from 'react';
import { useApp } from '../store/appStore';
import { isOpenCaselistUrl } from './OpenEvView';

// ─── Dedicated hidden webviews for agent searches ─────────────────────────────
//
// These are separate from the user-facing FindCards / OpenEvView components so
// agent searches never disturb what the user is looking at.  Both webviews are
// always mounted but positioned off-screen so they have a real viewport and
// execute JS correctly.

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        allowpopups?: string;
        style?: React.CSSProperties;
        className?: string;
      };
    }
  }
}

// The same React-friendly search injection used by the user-facing views
function buildSearchInject(query: string): string {
  return `
    (function() {
      const fill = (el, v) => {
        const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (s) s.call(el, v); else el.value = v;
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const input = document.querySelector(
        'input[type="search"], input[placeholder*="earch" i], input[name="q"], ' +
        'input[name="search"], input[id*="search" i], input[class*="search" i], input[type="text"]'
      );
      if (input) {
        fill(input, ${JSON.stringify(query)});
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', keyCode: 13, bubbles: true }));
        const form = input.closest('form');
        if (form) { try { form.requestSubmit(); } catch { form.submit(); } }
      }
    })();
  `;
}

// Serialize webview access: chains calls so each waits for the previous to finish.
// This prevents parallel searches from racing each other on the same webview.
function makeSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = tail.then(fn, fn); // run regardless of previous outcome
    tail = next.then(() => {}, () => {});
    return next;
  };
}

export default function AgentSearchViews() {
  const logosRef  = useRef<HTMLElement>(null);
  const openevRef = useRef<HTMLElement>(null);
  const logosReady  = useRef(false);
  const openevReady = useRef(false);
  const { registerAgentSearch } = useApp();

  // One queue per webview — ensures sequential access even when called in parallel
  const logosQueue  = useRef(makeSerialQueue());
  const openevQueue = useRef(makeSerialQueue());

  // ── Logos ──────────────────────────────────────────────────────────────────

  const logosSearch = useCallback((query: string): Promise<string> => {
    return logosQueue.current(async () => {
      const wv = logosRef.current as any;
      if (!wv) throw new Error('Agent Logos webview not available');
      // Wait for initial page load if needed
      if (!logosReady.current) {
        await new Promise<void>((resolve) => {
          let waited = 0;
          const poll = setInterval(() => {
            waited += 200;
            if (logosReady.current || waited >= 8000) { clearInterval(poll); resolve(); }
          }, 200);
        });
      }
      // Attach did-finish-load listener BEFORE injecting the search
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => { if (!settled) { settled = true; resolve(); } };
        const onLoad = () => { wv.removeEventListener('did-finish-load', onLoad); done(); };
        wv.addEventListener('did-finish-load', onLoad);
        wv.executeJavaScript(buildSearchInject(query)).catch(() => {});
        // Fallback: SPA may not hard-navigate; resolve after 7s anyway
        setTimeout(() => { wv.removeEventListener('did-finish-load', onLoad); done(); }, 7000);
      });
      // Buffer for React/SPA content to render after the load event
      await new Promise<void>((r) => setTimeout(r, 2000));
      // Extract cards via selectors, falling back to raw innerText
      const cards = await wv.executeJavaScript(`
        (function() {
          const seen = new Set();
          const out = [];
          const selectors = [
            '[class*="card"]', '[class*="Card"]', '[class*="evidence"]', '[class*="Evidence"]',
            '[class*="result-item"]', '[class*="ResultItem"]', 'article', '[class*="CardItem"]',
            'li[class*="item"]', '[class*="EvidCard"]', '[class*="hit"]', '[class*="Hit"]',
          ];
          for (const sel of selectors) {
            try {
              document.querySelectorAll(sel).forEach(el => {
                const text = (el.innerText || '').trim();
                const key = text.slice(0, 60);
                if (text.length > 150 && !seen.has(key)) {
                  seen.add(key);
                  out.push(text.slice(0, 2500));
                }
              });
            } catch(_) {}
            if (out.length >= 5) break;
          }
          if (out.length >= 2) {
            return out.slice(0, 7).map((c, i) => '=== Card ' + (i + 1) + ' ===\\n' + c).join('\\n\\n');
          }
          return document.body.innerText.slice(0, 15000);
        })()
      `) as string;
      return cards ?? '';
    });
  }, []);

  useEffect(() => {
    const wv = logosRef.current as any;
    if (!wv) return;
    const onLoad = () => { logosReady.current = true; };
    wv.addEventListener('did-finish-load', onLoad);
    return () => wv.removeEventListener('did-finish-load', onLoad);
  }, []);

  // ── OpenEv ─────────────────────────────────────────────────────────────────

  const openevSearch = useCallback((query: string): Promise<string> => {
    return openevQueue.current(async () => {
      const wv = openevRef.current as any;
      if (!wv) throw new Error('Agent OpenEv webview not available');
      if (!openevReady.current) {
        await new Promise<void>((resolve) => {
          let waited = 0;
          const poll = setInterval(() => {
            waited += 200;
            if (openevReady.current || waited >= 8000) { clearInterval(poll); resolve(); }
          }, 200);
        });
      }
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => { if (!settled) { settled = true; resolve(); } };
        const onLoad = () => { wv.removeEventListener('did-finish-load', onLoad); done(); };
        wv.addEventListener('did-finish-load', onLoad);
        wv.executeJavaScript(buildSearchInject(query)).catch(() => {});
        setTimeout(() => { wv.removeEventListener('did-finish-load', onLoad); done(); }, 7000);
      });
      await new Promise<void>((r) => setTimeout(r, 2000));
      const text = await wv.executeJavaScript(`document.body.innerText`) as string;
      return (text ?? '').slice(0, 10000);
    });
  }, []);

  useEffect(() => {
    const wv = openevRef.current as any;
    if (!wv) return;

    const onLoad = async () => {
      openevReady.current = true;
      // Auto-login with stored OpenCaselist credentials (same flow as OpenEvView).
      // Never inject credentials unless the webview is actually on opencaselist.com —
      // a redirect to another origin must not receive the user's stored login.
      if (!isOpenCaselistUrl(wv.getURL?.())) return;
      const [username, password] = await Promise.all([
        window.warroom?.secure.get('oc_username'),
        window.warroom?.secure.get('oc_password'),
      ]);
      try {
        await wv.executeJavaScript(`
          (function() {
            const user = ${JSON.stringify(username ?? '')};
            const pass = ${JSON.stringify(password ?? '')};
            function fill(el, value) {
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
              if (setter) setter.call(el, value); else el.value = value;
              el.dispatchEvent(new Event('input',  { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const passField = document.querySelector('input[type="password"]');
            const userField = document.querySelector(
              'input[name="username"], input[id="username"], input[autocomplete="username"], input[type="email"], input[type="text"]:not([type="search"])'
            );
            if (userField && passField && user && pass) {
              fill(userField, user);
              fill(passField, pass);
              setTimeout(() => {
                const btn = document.querySelector('button[type="submit"], input[type="submit"], form button');
                if (btn) btn.click();
                else { const f = document.querySelector('form'); if (f) f.submit(); }
              }, 150);
            } else {
              const allLinks = Array.from(document.querySelectorAll('a, button, [role="button"], [class*="card"], div'));
              const el = allLinks.find(el => el.textContent?.trim().toLowerCase().includes('open evidence project'));
              if (el) el.click();
            }
          })();
        `);
      } catch (_) {}
    };

    wv.addEventListener('did-finish-load', onLoad);
    return () => wv.removeEventListener('did-finish-load', onLoad);
  }, []);

  // ── Register both search fns ───────────────────────────────────────────────

  useEffect(() => {
    registerAgentSearch('logos', logosSearch);
    registerAgentSearch('openev', openevSearch);
    return () => {
      registerAgentSearch('logos', null);
      registerAgentSearch('openev', null);
    };
  }, [registerAgentSearch, logosSearch, openevSearch]);

  // Render off-screen with real dimensions so the pages lay out normally
  return (
    <div style={{ position: 'fixed', left: -10000, top: -10000, width: 1, height: 1, overflow: 'hidden', pointerEvents: 'none' }}>
      <webview
        ref={logosRef as any}
        src="https://logos-debate.netlify.app/"
        allowpopups="true"
        style={{ width: 1280, height: 800, display: 'flex' }}
      />
      <webview
        ref={openevRef as any}
        src="https://opencaselist.com/openev"
        allowpopups="true"
        style={{ width: 1280, height: 800, display: 'flex' }}
      />
    </div>
  );
}
