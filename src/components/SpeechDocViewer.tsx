import React, { useState, useRef, useEffect } from 'react';
import { renderAsync } from 'docx-preview';
import { LoadingPanel, Spinner } from './Spinner';
import { useApp } from '../store/appStore';
import type { DebateEvent } from '../store/appStore';
import SharePanel from './SharePanel';

type Step = 'idle' | 'loading' | 'viewing' | 'error';

const RECENTS_KEY = 'warroom-speech-doc-recents';

interface RecentDoc { path: string; name: string }

function getRecents(): RecentDoc[] {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]'); } catch { return []; }
}
function addRecent(path: string, name: string) {
  const next = [{ path, name }, ...getRecents().filter(r => r.path !== path)].slice(0, 8);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  window.dispatchEvent(new StorageEvent('storage', { key: RECENTS_KEY, newValue: JSON.stringify(next) }));
}

// ── Icon buttons with tooltip ──────────────────────────────────────────────

function IconBtn({ icon, label, onClick, danger, tooltipAlign = 'center' }: {
  icon: React.ReactNode; label: string; onClick: () => void;
  danger?: boolean; tooltipAlign?: 'left' | 'center' | 'right';
}) {
  const [tip, setTip] = useState(false);
  const tipStyle: React.CSSProperties =
    tooltipAlign === 'left'  ? { left: 0 } :
    tooltipAlign === 'right' ? { right: 0 } :
    { left: '50%', transform: 'translateX(-50%)' };
  return (
    <div className="relative" onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}>
      <button
        onClick={onClick}
        className="flex items-center justify-center w-9 h-9 rounded-lg transition"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: danger ? 'rgb(var(--danger-rgb))' : 'var(--nav-inactive-color)' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {icon}
      </button>
      {tip && (
        <div className="absolute top-full mt-1.5 px-2 py-1 text-[11px] font-medium rounded-md whitespace-nowrap z-50 pointer-events-none select-none"
          style={{ ...tipStyle, background: 'var(--bg-elevated)', color: 'rgb(var(--ink-rgb))', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}>
          {label}
        </div>
      )}
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────

function IcoSave() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 17V5a2 2 0 012-2h7.17L16 6.83V17a1 1 0 01-1 1H5a1 1 0 01-1-1z"/>
      <path d="M7 3v4h6V3"/>
      <rect x="6" y="11" width="8" height="5" rx="1"/>
    </svg>
  );
}

function IcoClose() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M4 4l10 10M14 4L4 14"/>
    </svg>
  );
}

function IcoShare() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M12 10a2 2 0 0 0-1.6.8L5.9 8.4A2 2 0 0 0 6 8a2 2 0 0 0-.1-.4l4.5-2.3A2 2 0 1 0 9.9 3.4L5.4 5.7A2 2 0 1 0 5.4 10.3l4.5 2.3A2 2 0 1 0 12 10z"/>
    </svg>
  );
}

// Cross-ex: two opposing speech bubbles with a question mark — "the questioning exchange"
function IcoCrossEx({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h7a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 11 10H6l-2.5 2V10A1.5 1.5 0 0 1 2.5 8.5z" opacity={active ? 1 : 0.85}/>
      <path d="M8.2 14.5h7.3a1.5 1.5 0 0 0 1.5-1.5v-2a1.5 1.5 0 0 0-1.5-1.5h-1" opacity={active ? 0.9 : 0.5}/>
      <path d="M6 6.4a1.1 1.1 0 1 1 1.6 1c-.4.25-.6.5-.6 1" />
      <circle cx="7" cy="8.7" r="0.35" fill="currentColor" stroke="none"/>
    </svg>
  );
}

// Sparkle — "generate with Warroom AI"
function IcoSparkle({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1l1.3 3.7L13 6l-3.7 1.3L8 11 6.7 7.3 3 6l3.7-1.3z"/>
      <path d="M13 10l.6 1.6L15 12l-1.4.4L13 14l-.6-1.6L11 12l1.4-.4z" opacity="0.7"/>
    </svg>
  );
}

// "Generate 3 more like this" — a plus over stacked cards
function IcoMore() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4.5" width="8" height="9.5" rx="1.4"/>
      <path d="M5 2.5h6.5A1.5 1.5 0 0 1 13 4v7" opacity="0.55"/>
      <path d="M6 8.2h2.2M7.1 7.1v2.2"/>
    </svg>
  );
}

// Chevron for the show-answers disclosure
function IcoChevron({ open }: { open: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none"
      style={{ transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }}>
      <path d="M2.5 4.5l3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ── Dark-mode viewer fixes (viewer-side only, never touches the file) ──────

function parseRgb(str: string): { r: number; g: number; b: number } | null {
  const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3] };
}

// Convert RGB to HSL, clamp lightness to targetL, return hsl() string.
// This keeps the hue vivid rather than blending to near-black via low alpha.
function dimHighlightToHsl(r: number, g: number, b: number, targetL = 26): string {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rr: h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6; break;
      case gg: h = ((bb - rr) / d + 2) / 6; break;
      default: h = ((rr - gg) / d + 4) / 6;
    }
  }
  // Use targetL for lightness, keep original saturation (min 60% so hue stays clear)
  const sFinal = Math.max(s * 100, 60);
  return `hsl(${Math.round(h * 360)}, ${Math.round(sFinal)}%, ${targetL}%)`;
}

function isBrightHighlight({ r, g, b }: { r: number; g: number; b: number }) {
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const isNearWhite = r > 230 && g > 230 && b > 230;
  const isNearBlack = r < 20 && g < 20 && b < 20;
  return luminance > 0.3 && !isNearWhite && !isNearBlack;
}

function applyDarkModeViewerFixes(container: HTMLElement) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
  let node: Node | null = walker.currentNode;
  while (node) {
    const el = node as HTMLElement;

    // Dim bright highlights — save the original color so we can restore it in light mode
    const bg = window.getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      const rgb = parseRgb(bg);
      if (rgb && isBrightHighlight(rgb)) {
        if (!el.dataset.origBg) el.dataset.origBg = bg; // save once
        el.style.setProperty('background-color', dimHighlightToHsl(rgb.r, rgb.g, rgb.b), 'important');
      }
    }

    // Make dark borders visible (e.g. the 1AC title box)
    const bc = el.style.borderColor ||
      el.style.borderTopColor || el.style.borderBottomColor ||
      el.style.borderLeftColor || el.style.borderRightColor;
    if (bc) {
      const rgb = parseRgb(bc);
      if (rgb) {
        const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
        if (luminance < 0.2) {
          const light = 'rgba(240, 240, 242, 0.7)';
          if (!el.dataset.origBorderColor) el.dataset.origBorderColor = bc;
          if (el.style.borderColor) el.style.borderColor = light;
          if (el.style.borderTopColor) el.style.borderTopColor = light;
          if (el.style.borderBottomColor) el.style.borderBottomColor = light;
          if (el.style.borderLeftColor) el.style.borderLeftColor = light;
          if (el.style.borderRightColor) el.style.borderRightColor = light;
        }
      }
    }

    node = walker.nextNode();
  }
}

function removeDarkModeViewerFixes(container: HTMLElement) {
  // Restore all elements that had their highlight/border colors overridden
  container.querySelectorAll<HTMLElement>('[data-orig-bg]').forEach(el => {
    el.style.removeProperty('background-color');
    delete el.dataset.origBg;
  });
  container.querySelectorAll<HTMLElement>('[data-orig-border-color]').forEach(el => {
    const orig = el.dataset.origBorderColor!;
    if (el.style.borderColor) el.style.borderColor = orig;
    if (el.style.borderTopColor) el.style.borderTopColor = orig;
    if (el.style.borderBottomColor) el.style.borderBottomColor = orig;
    if (el.style.borderLeftColor) el.style.borderLeftColor = orig;
    if (el.style.borderRightColor) el.style.borderRightColor = orig;
    delete el.dataset.origBorderColor;
  });
  // Also restore section backgrounds and text colors to light-mode values
  container.querySelectorAll<HTMLElement>('section.docx').forEach(s => {
    s.style.background = '#ffffff';
    s.style.color = '#1c1c1e';
  });
}

// ── Focus / reading-mode helpers ─────────────────────────────────────────

type FocusType = 'highlight' | 'highlight+underline';

function applyFocusMode(container: HTMLElement, mode: FocusType) {
  container.querySelectorAll<HTMLElement>('p').forEach(para => {
    const spans = Array.from(para.querySelectorAll<HTMLElement>('span'));
    if (spans.length === 0) return;

    // Hat / tag / cite paragraphs: every span is bold and none are highlighted.
    // These are always shown in full regardless of mode.
    const allBold = spans.every(s => parseInt(window.getComputedStyle(s).fontWeight) >= 600);
    const anyHighlight = spans.some(s => {
      const rgb = parseRgb(window.getComputedStyle(s).backgroundColor);
      return rgb && isBrightHighlight(rgb);
    });
    if (allBold && !anyHighlight) return;

    // Body paragraph — hide spans that don't meet the mode criteria
    spans.forEach(span => {
      const cs  = window.getComputedStyle(span);
      const rgb = parseRgb(cs.backgroundColor);
      const highlighted = !!(rgb && isBrightHighlight(rgb));
      const underlined  = cs.textDecoration.includes('underline');
      const keep = highlighted || (mode === 'highlight+underline' && underlined);
      if (!keep) {
        span.dataset.focusHidden = '1';
        span.style.setProperty('opacity', '0', 'important');
      }
    });
  });
}

function removeFocusMode(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('[data-focus-hidden]').forEach(span => {
    span.style.removeProperty('opacity');
    delete span.dataset.focusHidden;
  });
}

// ── Focus button icon ──────────────────────────────────────────────────────

function IcoFocus({ active }: { active: boolean }) {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="currentColor">
      <rect x="1" y="2" width="15" height="1.5" rx="0.75" opacity="0.22"/>
      <rect x="1" y="5.75" width="15" height="2.75" rx="1.375"/>
      <rect x="1" y="10.5" width="10" height="2.75" rx="1.375" opacity={active ? 1 : 0.75}/>
      <rect x="12" y="10.5" width="4" height="2.75" rx="1.375" opacity={active ? 0.6 : 0.3}/>
      <rect x="1" y="15.25" width="9" height="1.5" rx="0.75" opacity="0.22"/>
    </svg>
  );
}

// ── Split focus button: left = toggle, right = dropdown ───────────────────

function FocusBtn({ active, type, onToggle, onTypeChange }: {
  active: boolean;
  type: FocusType;
  onToggle: () => void;
  onTypeChange: (t: FocusType) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tip, setTip]   = useState(false);
  const [dropPos, setDropPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef    = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);

  // Position dropdown using fixed coords so it escapes any overflow:hidden parent
  function openDropdown() {
    if (!chevronRef.current) return;
    const r = chevronRef.current.getBoundingClientRect();
    setDropPos({ top: r.bottom + 6, left: r.left - 160 });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const btnBase: React.CSSProperties = {
    background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', borderRadius: '8px', transition: 'background 0.12s',
  };

  return (
    <div ref={wrapRef} style={{ display: 'flex', alignItems: 'center', gap: '1px' }}>
      {/* ── Main toggle ── */}
      <div style={{ position: 'relative' }}
        onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}>
        <button
          onClick={onToggle}
          style={{ ...btnBase, width: '34px', height: '34px', color: active ? 'rgb(var(--ink-rgb))' : 'var(--nav-inactive-color)', background: active ? 'var(--nav-active-bg)' : 'transparent', boxShadow: active ? 'var(--nav-active-shadow)' : 'none' }}
          onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--nav-hover-bg)'; }}
          onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
        >
          <IcoFocus active={active} />
        </button>

        {/* Tooltip */}
        {tip && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
            background: 'var(--bg-elevated)', color: 'rgb(var(--ink-rgb))',
            border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-elevated)',
            borderRadius: '8px', padding: '6px 10px', zIndex: 100,
            pointerEvents: 'none', whiteSpace: 'nowrap', fontSize: '11px', fontWeight: 500, lineHeight: '1.5',
          }}>
            <div style={{ fontWeight: 600, marginBottom: '2px' }}>Focus mode</div>
            <div style={{ opacity: 0.65 }}>Hide body text — show only card structure</div>
            <div style={{ opacity: 0.65 }}>and highlighted / underlined text.</div>
          </div>
        )}
      </div>

      {/* ── Chevron dropdown trigger ── */}
      <button
        ref={chevronRef}
        onClick={openDropdown}
        style={{ ...btnBase, width: '16px', height: '34px', color: 'var(--nav-inactive-color)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--nav-hover-bg)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
      >
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M1 2.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* ── Dropdown — fixed position to escape overflow:hidden parents ── */}
      {open && dropPos && (
        <div style={{
          position: 'fixed', top: dropPos.top, left: dropPos.left, zIndex: 9999,
          background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-elevated)', borderRadius: '10px',
          padding: '4px', minWidth: '230px',
        }}>
          {([
            ['highlight',           'Highlight only',           'Show highlighted text, card tags, cites, and hats.'],
            ['highlight+underline', 'Highlight + Underline',    'Also show underlined (cut) text runs.'],
          ] as [FocusType, string, string][]).map(([t, label, desc]) => (
            <button
              key={t}
              onClick={() => { onTypeChange(t); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '8px', width: '100%',
                padding: '7px 10px', borderRadius: '7px', border: 'none', cursor: 'pointer',
                background: type === t ? 'var(--nav-hover-bg)' : 'transparent',
                textAlign: 'left',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--nav-hover-bg)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = type === t ? 'var(--nav-hover-bg)' : 'transparent'; }}
            >
              <span style={{ marginTop: '1px', opacity: type === t ? 1 : 0, fontSize: '11px', color: 'rgb(var(--ink-rgb))' }}>✓</span>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 500, color: 'rgb(var(--ink-rgb))', whiteSpace: 'nowrap' }}>{label}</div>
                <div style={{ fontSize: '11px', opacity: 0.55, color: 'rgb(var(--ink-rgb))', marginTop: '1px', whiteSpace: 'nowrap' }}>{desc}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Cross-ex practice panel ─────────────────────────────────────────────────

interface CxQuestion { id: string; question: string; answer: string }

// Cross-ex questions are persisted per-document so they survive closing/reopening
// the panel, navigating away, reloading the doc, and app restarts. They are only
// cleared when the user regenerates them.
const cxStorageKey = (path: string) => `warroom-cx-questions-${path}`;
function loadCxQuestions(path: string): CxQuestion[] {
  if (!path) return [];
  try {
    const v = JSON.parse(localStorage.getItem(cxStorageKey(path)) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function saveCxQuestions(path: string, qs: CxQuestion[]) {
  if (!path) return;
  try {
    if (qs.length === 0) localStorage.removeItem(cxStorageKey(path));
    else localStorage.setItem(cxStorageKey(path), JSON.stringify(qs));
  } catch {}
}

const eventLabel = (e: DebateEvent) =>
  e === 'pf' ? 'Public Forum' : e === 'ld' ? 'Lincoln-Douglas' : 'Policy';

// Render text with basic bold, italic, underline (no markdown — AI uses single quotes)
function CxText({ text, className, style }: { text: string; className?: string; style?: React.CSSProperties }) {
  // Split on 'single-quoted phrases' and render them slightly emphasized
  const parts = text.split(/('(?:[^']+)')/g);
  return (
    <span className={className} style={style}>
      {parts.map((p, i) =>
        /^'.*'$/.test(p)
          ? <strong key={i} style={{ fontWeight: 600 }}>{p.slice(1, -1)}</strong>
          : p
      )}
    </span>
  );
}

function CrossExPill({ q, event, highlightedText, fullText, onInsertMore }: {
  q: CxQuestion;
  event: DebateEvent;
  highlightedText: string;
  fullText: string;
  onInsertMore: (after: CxQuestion, generated: CxQuestion[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreErr, setMoreErr] = useState('');

  async function genMore() {
    setMoreLoading(true);
    setMoreErr('');
    try {
      const res = await window.warroom.ai.crossExQuestions({
        highlightedText,
        fullText,
        event: event as 'policy' | 'pf' | 'ld',
        count: 3,
        basedOn: q.question,
      });
      if (!res.ok || !res.questions) throw new Error(res.error ?? 'Failed');
      onInsertMore(q, res.questions.map((x, i) => ({
        id: `${q.id}-m${Date.now()}-${i}`,
        question: x.question,
        answer: x.answer,
      })));
    } catch (e: any) {
      setMoreErr(e?.message ?? 'Could not generate more');
    } finally {
      setMoreLoading(false);
    }
  }

  return (
    <div
      className="rounded-xl p-3 transition"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="text-[13px] leading-snug font-medium" style={{ color: 'rgb(var(--ink-rgb))' }}>
        {q.question}
      </div>

      <div className="flex items-center gap-1.5 mt-2.5">
        {/* Show answers disclosure */}
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition"
          style={{ background: open ? 'var(--nav-active-bg)' : 'transparent', color: 'var(--nav-inactive-color)', border: '1px solid var(--border-subtle)' }}
          onMouseEnter={e => { if (!open) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
          onMouseLeave={e => { if (!open) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          <IcoChevron open={open} />
          {open ? 'Hide answer' : 'Show answer'}
        </button>

        <div className="flex-1" />

        {/* Generate 3 more like this */}
        <button
          onClick={genMore}
          disabled={moreLoading}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition"
          style={{ background: 'transparent', color: 'var(--nav-inactive-color)', border: '1px solid var(--border-subtle)', cursor: moreLoading ? 'default' : 'pointer', opacity: moreLoading ? 0.6 : 1 }}
          onMouseEnter={e => { if (!moreLoading) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          title="Generate 3 more questions like this one"
        >
          {moreLoading ? <Spinner className="w-3 h-3" /> : <IcoMore />}
          {moreLoading ? 'Generating…' : '3 more like this'}
        </button>
      </div>

      {open && (
        <div
          className="mt-2.5 pt-2.5 text-[12px] leading-relaxed whitespace-pre-wrap"
          style={{ color: 'rgb(var(--ink-rgb))', opacity: 0.82, borderTop: '1px solid var(--border-subtle)' }}
        >
          {q.answer}
        </div>
      )}

      {moreErr && (
        <div className="mt-2 text-[11px]" style={{ color: 'rgb(var(--danger-rgb))' }}>{moreErr}</div>
      )}
    </div>
  );
}

function CrossExPanel({ event, getDocText, onClose, docKey }: {
  event: DebateEvent;
  getDocText: () => string;
  onClose: () => void;
  docKey: string;
}) {
  // Restore any previously generated questions for this document.
  const [questions, setQuestions] = useState<CxQuestion[]>(() => loadCxQuestions(docKey));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(() => loadCxQuestions(docKey).length > 0);

  // Persist on every change so questions survive panel close / doc reload / restart.
  useEffect(() => { saveCxQuestions(docKey, questions); }, [docKey, questions]);

  async function generate() {
    const docText = getDocText().trim();
    if (!docText) { setError('No readable text in this document yet.'); return; }
    setLoading(true);
    setError('');
    setStarted(true);
    try {
      const res = await window.warroom.ai.crossExQuestions({
        docText,
        event: event as 'policy' | 'pf' | 'ld',
        count: 4,
      });
      if (!res.ok || !res.questions) throw new Error(res.error ?? 'Failed to generate');
      setQuestions(res.questions.map((x, i) => ({
        id: `q${Date.now()}-${i}`,
        question: x.question,
        answer: x.answer,
      })));
    } catch (e: any) {
      setError(e?.message ?? 'Failed to generate questions');
    } finally {
      setLoading(false);
    }
  }

  function insertMore(after: CxQuestion, generated: CxQuestion[]) {
    setQuestions(prev => {
      const idx = prev.findIndex(q => q.id === after.id);
      if (idx === -1) return [...prev, ...generated];
      return [...prev.slice(0, idx + 1), ...generated, ...prev.slice(idx + 1)];
    });
  }

  return (
    <div
      className="flex flex-col h-full shrink-0"
      style={{ width: '360px', borderLeft: '1px solid var(--border-subtle)', background: 'var(--bg-main)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span style={{ color: 'rgb(var(--ink-rgb))' }}><IcoCrossEx active /></span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold truncate" style={{ color: 'rgb(var(--ink-rgb))' }}>Cross-Ex Practice</div>
          <div className="text-[10.5px]" style={{ color: 'var(--nav-inactive-color)' }}>{eventLabel(event)} · Warroom AI</div>
        </div>
        <IconBtn icon={<IcoClose />} label="Close" onClick={onClose} />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto scroll-thin px-3.5 py-3 space-y-2.5">
        {!started && !loading && (
          <div className="flex flex-col items-center text-center gap-3 mt-6 px-2">
            <span style={{ color: 'var(--nav-inactive-color)' }}><IcoCrossEx /></span>
            <div className="text-[12.5px] leading-relaxed" style={{ color: 'rgb(var(--ink-rgb))', opacity: 0.7 }}>
              Generate targeted cross-examination questions for this document, with model answers you can reveal when you're ready.
            </div>
          </div>
        )}

        {loading && questions.length === 0 && (
          <div className="flex flex-col items-center gap-2 mt-8" style={{ color: 'var(--nav-inactive-color)' }}>
            <Spinner className="w-5 h-5" />
            <div className="text-[12px]">Reading the doc & writing questions…</div>
          </div>
        )}

        {error && (
          <div className="text-[12px] rounded-lg p-2.5" style={{ color: 'rgb(var(--danger-rgb))', background: 'rgba(var(--danger-rgb), 0.08)', border: '1px solid rgba(var(--danger-rgb), 0.25)' }}>
            {error}
          </div>
        )}

        {questions.map(q => (
          <CrossExPill key={q.id} q={q} event={event} onInsertMore={insertMore} />
        ))}
      </div>

      {/* Footer action */}
      <div className="px-3.5 py-2.5 shrink-0" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <button
          onClick={generate}
          disabled={loading}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12.5px] font-semibold transition"
          style={{ background: 'var(--item-selected-bg)', color: 'var(--item-selected-text)', border: '1px solid var(--border-subtle)', boxShadow: '0 2px 8px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.08)', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.65 : 1 }}
        >
          {loading ? <Spinner className="w-3.5 h-3.5" /> : <IcoSparkle />}
          {loading ? 'Generating…' : started ? 'Regenerate questions' : 'Generate questions'}
        </button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function SpeechDocViewer() {
  const { setBusy, view, setView, event } = useApp();
  const [step, setStep] = useState<Step>('idle');
  const [cxOpen, setCxOpen] = useState(false);
  const [error, setError] = useState('');
  const [filePath, setFilePath] = useState('');
  const [fileName, setFileName] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [focusActive, setFocusActive] = useState(false);
  const [focusType, setFocusType] = useState<FocusType>('highlight');
  // Refs so the loadFile closure can read latest focus state without stale capture
  const focusActiveRef = useRef(false);
  const focusTypeRef   = useRef<FocusType>('highlight');
  const [recents, setRecents] = useState<RecentDoc[]>(getRecents);
  const containerRef = useRef<HTMLDivElement>(null);

  // Re-apply / remove dark-mode fixes whenever the theme class on <html> changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (!containerRef.current) return;
      const isDark = document.documentElement.classList.contains('dark');
      if (isDark) {
        applyDarkModeViewerFixes(containerRef.current);
      } else {
        removeDarkModeViewerFixes(containerRef.current);
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Keep refs in sync (so the async loadFile closure always reads fresh values)
  useEffect(() => { focusActiveRef.current = focusActive; }, [focusActive]);
  useEffect(() => { focusTypeRef.current = focusType; },     [focusType]);

  // Apply / remove focus mode whenever it toggles or changes type
  useEffect(() => {
    if (!containerRef.current) return;
    removeFocusMode(containerRef.current);
    if (focusActive) applyFocusMode(containerRef.current, focusType);
  }, [focusActive, focusType]);

  // Auto-load if view carries a docPath (from clicking a recent in the sidebar)
  const docPath = (view as any).docPath as string | undefined;
  const loadedPath = useRef('');
  useEffect(() => {
    if (docPath && docPath !== loadedPath.current) {
      loadFile(docPath);
    } else if (view.kind === 'speech-doc' && !docPath) {
      // No specific file requested (e.g. clicked the Cases + button) — always show the drop zone.
      reset();
    }
  }, [view.kind, docPath]);

  async function loadFile(path: string) {
    if (loadedPath.current === path) return;
    loadedPath.current = path;
    const name = path.split('/').pop() ?? path;
    setFilePath(path);
    setFileName(name);
    setStep('loading');
    setError('');
    setBusy('speech-doc', 'Loading…');
    try {
      const result = await window.warroom.fs.readDocxBytes(path);
      if (!result.ok || !result.base64) throw new Error(result.error ?? 'Could not read file');
      const binary = atob(result.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      setStep('viewing');
      setTimeout(async () => {
        if (!containerRef.current) return;
        containerRef.current.innerHTML = '';
        await renderAsync(bytes.buffer, containerRef.current, undefined, {
          className: 'docx-render',
          inWrapper: false,
          ignoreWidth: true,
          ignoreHeight: false,
          breakPages: false,
          useBase64URL: true,
          experimental: true,
        });

        // Force readable background + text on every page section
        const isDark = document.documentElement.classList.contains('dark');
        // Remove any leading blank children (blank cover page present in some docx files).
        for (const child of Array.from(containerRef.current.children)) {
          const stripped = (child.textContent ?? '').replace(/[\s ​‌‍﻿]/g, '');
          if (stripped.length === 0 && !(child as HTMLElement).querySelector('img, svg')) {
            child.remove();
          } else {
            break;
          }
        }

        containerRef.current.querySelectorAll('section.docx').forEach((el) => {
          const s = el as HTMLElement;
          s.style.background = isDark ? '#2c2c2e' : '#ffffff';
          s.style.color = isDark ? '#e8e8ea' : '#1c1c1e';
          s.style.boxShadow = '0 2px 12px rgba(0,0,0,0.15)';
          s.style.borderRadius = '4px';
          s.style.marginBottom = '24px';
          s.style.padding = '48px 56px';
          s.style.maxWidth = '860px';
          s.style.marginLeft = 'auto';
          s.style.marginRight = 'auto';
        });

        if (isDark) applyDarkModeViewerFixes(containerRef.current);
        // Apply focus mode if it was already active when this doc loaded
        if (focusActiveRef.current) applyFocusMode(containerRef.current, focusTypeRef.current);
      }, 0);

      // Auto-save to recents so it appears in the sidebar
      addRecent(path, name);
      setRecents(getRecents());
    } catch (e: any) {
      setError(`Failed to open file: ${e?.message ?? 'unknown error'}`);
      setStep('error');
      loadedPath.current = '';
    } finally {
      setBusy('speech-doc', null);
    }
  }

  async function pickFile() {
    const path = await window.warroom.dialog.openFile(['docx']);
    if (!path) return;
    loadedPath.current = '';
    await loadFile(path);
  }

  async function exportDocx() {
    const res = await window.warroom.fs.readFileBytes(filePath);
    if (!res.ok || !res.base64) return;
    await window.warroom.dialog.saveBuffer(
      res.base64,
      fileName,
      [{ name: 'Word Document', extensions: ['docx'] }]
    );
  }

  function reset() {
    setStep('idle');
    setFilePath('');
    setFileName('');
    loadedPath.current = '';
    if (containerRef.current) containerRef.current.innerHTML = '';
  }

  // ── Idle: show drop zone + recents ──────────────────────────────────────

  if (step === 'idle') {
    return (
      <div className="flex flex-col h-full p-8 gap-6">
        <div
          className="flex flex-col items-center justify-center p-12 text-center border-2 border-dashed border-line rounded-sm cursor-pointer hover:border-ink/30 transition"
          onClick={pickFile}
          onDrop={(e) => { e.preventDefault(); pickFile(); }}
          onDragOver={(e) => e.preventDefault()}
        >
          <div className="text-sm font-medium text-ink/60 mb-2">Drop a speech doc here (.docx)</div>
          <div className="text-xs text-ink/40">or click to open file picker</div>
        </div>

        {recents.length > 0 && (
          <div>
            <div className="label mb-2">Recent</div>
            <div className="space-y-1">
              {recents.map((r) => (
                <button
                  key={r.path}
                  onClick={() => { loadedPath.current = ''; loadFile(r.path); }}
                  className="w-full text-left px-3 py-2 text-xs rounded-lg flex items-center gap-2 transition"
                  style={{ color: 'rgb(var(--ink-rgb))', background: 'transparent' }}
                  onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
                  onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                >
                  <IcoSave />
                  <span className="truncate">{r.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────

  if (step === 'error') {
    return (
      <div className="p-8 space-y-3 max-w-xl">
        <div className="border border-danger/30 rounded-sm bg-danger/5 p-3 text-sm text-danger">{error}</div>
        <button className="btn" onClick={reset}>Back</button>
      </div>
    );
  }

  // ── Viewing ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full relative">
      {/* Toolbar */}
      <div className="border-b border-line px-3 py-1 flex items-center gap-1 shrink-0">
        <FocusBtn
          active={focusActive}
          type={focusType}
          onToggle={() => setFocusActive(v => !v)}
          onTypeChange={t => { setFocusType(t); setFocusActive(true); }}
        />
        <div className="flex-1" />
        <div className="relative" onMouseEnter={() => {}}>
          <button
            onClick={() => setCxOpen(v => !v)}
            className="flex items-center gap-1.5 h-9 px-2.5 rounded-lg transition text-[12px] font-medium"
            style={{
              background: cxOpen ? 'var(--nav-active-bg)' : 'transparent',
              boxShadow: cxOpen ? 'var(--nav-active-shadow)' : 'none',
              border: 'none', cursor: 'pointer',
              color: cxOpen ? 'rgb(var(--ink-rgb))' : 'var(--nav-inactive-color)',
            }}
            onMouseEnter={e => { if (!cxOpen) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
            onMouseLeave={e => { if (!cxOpen) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            title="Practice cross-examination on this doc"
          >
            <IcoCrossEx active={cxOpen} />
            Cross-Ex Practice
          </button>
        </div>
        <IconBtn
          icon={<IcoShare />}
          label="Share / Open"
          onClick={() => setShareOpen(true)}
        />
        <IconBtn icon={<IcoClose />} label="Close" onClick={reset} danger />
      </div>

      {/* Share panel */}
      {shareOpen && (
        <SharePanel
          type="speech-doc"
          id={filePath}
          name={fileName}
          getData={async () => {
            const res = await window.warroom.fs.readFileBytes(filePath);
            return { filename: fileName, base64: res.base64 ?? '' };
          }}
          onClose={() => setShareOpen(false)}
          onOpenInWord={() => window.warroom.shell.openPath(filePath)}
          onExportDocx={exportDocx}
        />
      )}

      {/* Document + cross-ex side panel */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto scroll-thin docx-viewer-wrap min-w-0">
          {step === 'loading' && <LoadingPanel message="Loading document…" />}
          <div
            ref={containerRef}
            style={{ display: step === 'viewing' ? undefined : 'none' }}
          />
        </div>
        {cxOpen && step === 'viewing' && (
          <CrossExPanel
            key={filePath}
            docKey={filePath}
            event={event}
            getDocText={() => containerRef.current?.textContent ?? ''}
            onClose={() => setCxOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
