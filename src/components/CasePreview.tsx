import React, { useEffect, useMemo, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import { CaseItem } from '../utils/caseItems';
import { useApp } from '../store/appStore';

/**
 * Google-Docs-style first-page thumbnail for a case tile.
 *
 * Two strategies, one look — every tile is the same sheet of paper so the grid
 * reads as a uniform wall of pages:
 *
 *   - speech-doc / oc-case — render the real .docx first page with docx-preview
 *     at true page size, then CSS-scale it down to the tile.
 *   - case                 — no .docx exists, so synthesize a page out of the
 *     case's own tags/cites as React.
 *
 * The docx path also backstops onto the synthesized page, so a failed render or
 * an uncached disclosure still yields paper rather than a hole in the grid.
 */

// 8.5in x 11in at 96dpi. The doc is laid out at this fixed size and scaled down,
// so the miniature's line breaks match what the real page looks like.
const PAGE_W = 816;
const PAGE_H = 1056;

const PREVIEW_CACHE_PREFIX = 'warroom-case-preview-';
const OC_CACHE_PREFIX = 'warroom-oc-docx-';

// localStorage is shared with the rest of the app; a page carrying big inline
// images isn't worth evicting real user data for.
const MAX_CACHE_CHARS = 400_000;

const DOC_FONT_STACK = "'Calibri', 'Carlito', 'Helvetica Neue', 'Arial', sans-serif";

// Paper stays paper in both themes, so the page's own colors are literal.
const PAPER = '#ffffff';
const PAPER_INK = '#1c1c1e';

// ─── Render queue ─────────────────────────────────────────────────────────────

// docx-preview unzips and builds a full DOM per doc. A 40-tile grid firing all
// of them at once locks the app for seconds. Two at a time keeps scrolling
// responsive while still filling the visible tiles quickly.
const MAX_CONCURRENT = 2;
let running = 0;
const queued: (() => void)[] = [];

function runQueued<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      running++;
      job()
        .then(resolve, reject)
        .finally(() => {
          running--;
          queued.shift()?.();
        });
    };
    if (running < MAX_CONCURRENT) start();
    else queued.push(start);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Stable, CSS-safe class per item. docx-preview scopes every rule it generates
 * (theme variables, paragraph styles) to the className it is handed — so tiles
 * sharing a className would overwrite each other's stylesheet. Deterministic so
 * a cached page still matches the styles cached alongside it.
 */
function classForKey(key: string): string {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return 'wrprev' + Math.abs(h).toString(36);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Belt-and-braces before dangerouslySetInnerHTML. Cheap, so do it on every path. */
function sanitize(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<script[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
}

function readCache(key: string): string | null {
  try { return localStorage.getItem(PREVIEW_CACHE_PREFIX + key); } catch { return null; }
}

function writeCache(key: string, html: string) {
  if (html.length > MAX_CACHE_CHARS) return;
  // Quota errors are expected once the grid is big — a missing cache entry just
  // means the tile re-renders next time.
  try { localStorage.setItem(PREVIEW_CACHE_PREFIX + key, html); } catch { /* full — fine */ }
}

/**
 * Office-font aliases, mirroring the speech-doc viewer's. Injected here too
 * because the grid can be the first thing that ever renders a docx, and shares
 * the viewer's element id so whichever mounts first wins and the other skips.
 */
function ensureDocxFonts() {
  if (document.getElementById('wr-docx-fonts')) return;
  const el = document.createElement('style');
  el.id = 'wr-docx-fonts';
  el.textContent = `
    @font-face { font-family: 'Calibri'; src: local('Calibri'), local('Carlito'), local('Helvetica Neue'), local('Arial'); }
    @font-face { font-family: 'Calibri Light'; src: local('Calibri Light'), local('Carlito'), local('Helvetica Neue'), local('Arial'); }
    @font-face { font-family: 'Calibri'; font-weight: bold; src: local('Calibri Bold'), local('Carlito Bold'), local('Helvetica Neue Bold'), local('Arial Bold'); }
    @font-face { font-family: 'Aptos'; src: local('Aptos'), local('Carlito'), local('Helvetica Neue'), local('Arial'); }
    @font-face { font-family: 'Aptos Display'; src: local('Aptos Display'), local('Carlito'), local('Helvetica Neue'), local('Arial'); }
    @font-face { font-family: 'Aptos'; font-weight: bold; src: local('Aptos Bold'), local('Carlito Bold'), local('Helvetica Neue Bold'), local('Arial Bold'); }
    @font-face { font-family: 'Cambria'; src: local('Cambria'), local('Caladea'), local('Georgia'), local('Times New Roman'); }
    @font-face { font-family: 'Cambria Math'; src: local('Cambria Math'), local('Caladea'), local('Georgia'); }
  `;
  document.head.appendChild(el);
}

/** The docx bytes behind an item, if we can get them without touching the network. */
async function loadBase64(item: CaseItem): Promise<string | null> {
  if (item.kind === 'speech-doc' && item.path) {
    try {
      const res = await window.warroom.fs.readDocxBytes(item.path);
      return res.ok && res.base64 ? res.base64 : null;
    } catch { return null; }
  }
  if (item.kind === 'oc-case' && item.ocUrl) {
    // A thumbnail never downloads. An uncached disclosure just shows the
    // synthesized page until the viewer fetches and caches it for real.
    try { return localStorage.getItem(OC_CACHE_PREFIX + item.ocUrl); } catch { return null; }
  }
  return null;
}

/** Render bytes offscreen and return page one as a self-contained html string. */
async function renderFirstPageHtml(base64: string, cls: string): Promise<string | null> {
  const bytes = base64ToBytes(base64);
  const off = document.createElement('div'); // detached: never enters the visible tree
  await renderAsync(bytes.buffer, off, undefined, {
    className: cls,
    inWrapper: false,
    ignoreWidth: false,
    ignoreHeight: false,
    breakPages: true, // makes each section a real page, so we can take only the first
    useBase64URL: true, // inline images survive being cached as a string
    experimental: true,
  });

  // docx-preview classes the page <section> with the className we passed in —
  // NOT a literal "docx" — and emits the document's stylesheet as sibling
  // <style> tags, which have to travel with the page for it to look right.
  const page = off.querySelector(`section.${cls}`) as HTMLElement | null;
  if (!page) return null;

  page.style.width = `${PAGE_W}px`;
  page.style.minHeight = `${PAGE_H}px`;
  page.style.boxSizing = 'border-box'; // width has to include Word's page margins
  page.style.margin = '0';
  page.style.background = PAPER;
  page.style.color = PAPER_INK;
  // DEBATE_DOC_STRUCTURE.md section 6: body runs inheriting the Aptos theme font
  // emit no inline font-family, so without a container default they fall through
  // to serif Times New Roman. Runs with an explicit font still win on specificity.
  page.style.fontFamily = DOC_FONT_STACK;

  // Word's built-in Heading5–9 styles default to Times New Roman, and templates
  // that only customize the shallow levels a debate doc actually uses (1–4) leave
  // that stale default on any tag that happens to nest deep enough. That font is
  // set inline, so it beats the page-level default above — force it back to
  // match SpeechDocViewer.tsx's forceHeadingFont. Regex-only (no styles.xml
  // round-trip here): it catches literal Heading1–9 style ids, which covers the
  // built-in-style case this exists for; a custom, non-"HeadingN"-named style
  // would need the full styles.xml resolution SpeechDocViewer.tsx does, not worth
  // an extra IPC call per thumbnail for what's already a live-viewer-only edge case.
  page.querySelectorAll<HTMLElement>('p').forEach((p) => {
    if (/heading[\s_-]?[1-9]/i.test(p.className)) {
      p.style.setProperty('font-family', DOC_FONT_STACK, 'important');
    }
  });

  const styles = Array.from(off.querySelectorAll(':scope > style'))
    .map((s) => s.outerHTML)
    .join('');
  return styles + page.outerHTML;
}

// ─── Component ────────────────────────────────────────────────────────────────

type Status = 'skeleton' | 'ready' | 'fallback';

export default function CasePreview({ item, width }: { item: CaseItem; width?: number }): JSX.Element {
  const db = useApp((s) => s.db);
  const outerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [tileW, setTileW] = useState(width ?? 0);
  const [html, setHtml] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('skeleton');

  const hasDocx = item.kind === 'speech-doc' || item.kind === 'oc-case';

  useEffect(() => { ensureDocxFonts(); }, []);

  // Only render a doc once its tile is actually near the viewport.
  useEffect(() => {
    const el = outerRef.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  // The tile fills its parent, so the scale factor has to come from a live
  // measurement rather than the optional `width` hint.
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const measure = () => setTileW(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!hasDocx) { setStatus('fallback'); return; }

    // Unmount-mid-render is the norm in a scrolling grid, not the edge case.
    let cancelled = false;
    setHtml(null);
    setStatus('skeleton');

    const cached = readCache(item.key);
    if (cached) { setHtml(cached); setStatus('ready'); return; }
    if (!visible) return;

    runQueued(async () => {
      const base64 = await loadBase64(item);
      if (cancelled || !base64) return null;
      return renderFirstPageHtml(base64, classForKey(item.key));
    })
      .then((result) => {
        if (cancelled) return;
        if (result) {
          setHtml(result);
          setStatus('ready');
          writeCache(item.key, result);
        } else {
          setStatus('fallback');
        }
      })
      .catch(() => { if (!cancelled) setStatus('fallback'); });

    return () => { cancelled = true; };
  }, [item.key, item.kind, item.path, item.ocUrl, visible, hasDocx]);

  const safeHtml = useMemo(() => (html ? sanitize(html) : null), [html]);

  // Enough tags to fill a page; overflow:hidden clips whatever doesn't fit.
  const synth = useMemo(() => {
    const c = db.cases?.[item.id];
    const entries: { tag: string; cite: string }[] = [];
    if (c) {
      outer: for (const bid of c.blocks ?? []) {
        const b = db.blocks?.[bid];
        if (!b) continue;
        for (const cid of b.cards ?? []) {
          const card = db.cards?.[cid];
          if (!card) continue;
          entries.push({ tag: card.tag, cite: card.cite });
          if (entries.length >= 12) break outer;
        }
      }
    }
    return { title: c?.name ?? item.name, entries };
  }, [db, item.id, item.name]);

  const scale = tileW > 0 ? tileW / PAGE_W : 0;

  return (
    <div
      ref={outerRef}
      style={{
        width: width ?? '100%',
        aspectRatio: '8.5 / 11',
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 6,
        background: PAPER,
        border: '1px solid var(--border-subtle)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
      }}
    >
      {scale > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: PAGE_W,
            height: PAGE_H,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            pointerEvents: 'none', // the tile owns the click, not the page
            userSelect: 'none',
          }}
        >
          {status === 'ready' && safeHtml ? (
            <div dangerouslySetInnerHTML={{ __html: safeHtml }} />
          ) : status === 'fallback' ? (
            <SynthPage title={synth.title} entries={synth.entries} />
          ) : (
            <SkeletonPage />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Synthesized page (block-built cases, and the docx fallback) ──────────────

function SynthPage({ title, entries }: { title: string; entries: { tag: string; cite: string }[] }) {
  return (
    <div
      style={{
        width: PAGE_W,
        height: PAGE_H,
        boxSizing: 'border-box',
        padding: '96px',
        background: PAPER,
        color: PAPER_INK,
        fontFamily: DOC_FONT_STACK,
      }}
    >
      <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 28, lineHeight: 1.25 }}>{title}</div>
      {entries.map((e, i) => (
        <div key={i} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.35 }}>{e.tag}</div>
          {e.cite && (
            <div style={{ fontSize: 15, lineHeight: 1.4, marginTop: 4, opacity: 0.75 }}>{e.cite}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

// Bar widths are fixed rather than random so a tile doesn't reshuffle on rerender.
const SKELETON_BARS = [92, 78, 85, 60, 88, 74, 81, 55, 90, 68, 83, 71, 86, 62];

function SkeletonPage() {
  return (
    <div
      className="animate-pulse"
      style={{
        width: PAGE_W,
        height: PAGE_H,
        boxSizing: 'border-box',
        padding: '96px',
        background: PAPER,
      }}
    >
      <div style={{ height: 28, width: '55%', borderRadius: 4, background: 'var(--border-subtle)', marginBottom: 32 }} />
      {SKELETON_BARS.map((w, i) => (
        <div
          key={i}
          style={{
            height: 14,
            width: `${w}%`,
            borderRadius: 3,
            background: 'var(--bg-elevated)',
            marginBottom: 14,
          }}
        />
      ))}
    </div>
  );
}
