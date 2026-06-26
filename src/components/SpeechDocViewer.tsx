import React, { useState, useRef, useEffect, useCallback } from 'react';
import { renderAsync } from 'docx-preview';
import { LoadingPanel, Spinner } from './Spinner';
import { useApp } from '../store/appStore';
import type { DebateEvent, FlowMeta } from '../store/appStore';
import SharePanel from './SharePanel';
import { POLICY_COLS, PF_PRO_FIRST_COLS, PF_CON_FIRST_COLS, NUM_ROWS } from './FlowView';
import { parseRgb, isBrightHighlight, applyDarkModeViewerFixes, removeDarkModeViewerFixes } from '../utils/docxViewerUtils';

type Step = 'idle' | 'loading' | 'viewing' | 'error';

// Reset to false on every app launch — outline auto-shows only on the first
// document opened per session, then stays in whatever state the user leaves it.
let outlineAutoShownThisSession = false;

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

// Outline / table-of-contents: stacked lines with leading bullets
function IcoOutline({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="3" cy="4" r="1" fill="currentColor" stroke="none" opacity={active ? 1 : 0.85}/>
      <path d="M6.5 4H16"/>
      <circle cx="3" cy="9" r="1" fill="currentColor" stroke="none" opacity={active ? 1 : 0.85}/>
      <path d="M6.5 9H16"/>
      <circle cx="3" cy="14" r="1" fill="currentColor" stroke="none" opacity={active ? 1 : 0.85}/>
      <path d="M6.5 14H13"/>
    </svg>
  );
}

function IcoChevUp() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10l4-4 4 4"/>
    </svg>
  );
}

// Stacked layers — controls how many heading levels the outline shows.
function IcoLayers() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2l6 3-6 3-6-3 6-3z"/>
      <path d="M2 8l6 3 6-3"/>
      <path d="M2 11l6 3 6-3" opacity="0.6"/>
    </svg>
  );
}

function IcoChevDown() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6l4 4 4-4"/>
    </svg>
  );
}

function IcoSearch({ active }: { active?: boolean }) {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={active ? 1.9 : 1.6} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="5"/>
      <path d="M11.8 11.8L15.5 15.5"/>
    </svg>
  );
}

// Reading-time tool: an hourglass.
function IcoClock({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="18" y2="3" />
      <line x1="6" y1="21" x2="18" y2="21" />
      <path d="M7 3v3.4a5 5 0 0 0 2.5 4.33L12 12l2.5-1.27A5 5 0 0 0 17 6.4V3" />
      <path d="M7 21v-3.4a5 5 0 0 1 2.5-4.33L12 12l2.5 1.27A5 5 0 0 1 17 17.6V21" />
    </svg>
  );
}

function IcoPlay() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M5 3.5l8 4.5-8 4.5z"/>
    </svg>
  );
}

function IcoPause() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <rect x="4" y="3.5" width="3" height="9" rx="1"/>
      <rect x="9" y="3.5" width="3" height="9" rx="1"/>
    </svg>
  );
}

// Credibility: a shield with a checkmark — "vetted evidence"
function IcoShield({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={active ? 1.9 : 1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 1.8l6 2.2v4.2c0 3.6-2.5 6-6 7.8-3.5-1.8-6-4.2-6-7.8V4z"/>
      <path d="M6.3 8.6L8.2 10.5 11.8 6.8"/>
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

// Send to flow — a small grid/table with an arrow pointing into it.
function IcoSendFlow({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={active ? 1.9 : 1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="8" height="14" rx="1"/>
      <path d="M13 7v6M13 7h-2M13 13h-2" opacity="0.55"/>
      <path d="M2 10h6M5.5 7L8 10l-2.5 3"/>
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

// Trap drill — a target/crosshair with a fang, for the "harder questions" gauntlet
function IcoTrap({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="5.5"/>
      <circle cx="8" cy="8" r="2.2"/>
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2"/>
    </svg>
  );
}

// Warning triangle for the short-doc notice
function IcoWarn({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2L1.5 13.5h13L8 2z"/>
      <path d="M8 6.5v3.2"/>
      <circle cx="8" cy="11.6" r="0.5" fill="currentColor" stroke="none"/>
    </svg>
  );
}

// Back arrow for leaving the trap drill
function IcoBack({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 3.5L5 8l4.5 4.5"/>
    </svg>
  );
}

// ── Focus / reading-mode helpers ─────────────────────────────────────────

type FocusType = 'highlight' | 'highlight+underline';

function applyFocusMode(container: HTMLElement, mode: FocusType) {
  const paras = Array.from(container.querySelectorAll<HTMLElement>('p'));
  // Compute the deepest heading level (= tag level in Verbatim) so we can
  // identify cite paragraphs (the one right after a tag heading). Cite paragraphs
  // must always show their leading-bold author+date span even in focus mode.
  const hlvl = (el: HTMLElement) => {
    const m = (el.className || '').match(/heading[\s_-]?([1-9])/i);
    return m ? parseInt(m[1], 10) : 0;
  };
  let maxLevel = 0;
  for (const p of paras) maxLevel = Math.max(maxLevel, hlvl(p));
  let prevWasTag = false;

  paras.forEach(para => {
    const level = hlvl(para);
    const isHeading = level > 0;
    const isCite = !isHeading && prevWasTag;
    if ((para.textContent || '').trim()) {
      prevWasTag = maxLevel > 0 && level === maxLevel;
    }

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

    // In a cite paragraph (right after a tag), the leading-bold spans are the
    // author name + date — always shown in focus mode because they are read aloud.
    let citeLeadingBold = isCite;

    // Body paragraph — hide spans that don't meet the mode criteria
    spans.forEach(span => {
      const cs  = window.getComputedStyle(span);
      const rgb = parseRgb(cs.backgroundColor);
      const highlighted = !!(rgb && isBrightHighlight(rgb));
      const underlined  = cs.textDecoration.includes('underline');
      const bold = parseInt(cs.fontWeight, 10) >= 600;

      // Once a non-bold span with real text appears, the leading-bold section ends
      if (citeLeadingBold && !bold && (span.textContent ?? '').trim()) citeLeadingBold = false;

      const keep = highlighted ||
        (mode === 'highlight+underline' && underlined) ||
        (isCite && bold && citeLeadingBold);
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

// ── Document outline (heading navigation) ──────────────────────────────────
// docx-preview renders every paragraph as <p> and tags it with a class derived
// from the paragraph's style id: `docx-render_<styleid-lowercased>`. Verbatim
// (and Word's built-in styles) use style ids Heading1…Heading9, so heading
// paragraphs carry classes like `docx-render_heading1`. We detect those, stamp
// each with a stable data-outline-id, and build a clickable outline from them.
interface OutlineItem { id: string; level: number; text: string; warn?: 'over' | 'under' }

function buildOutline(container: HTMLElement): OutlineItem[] {
  const items: OutlineItem[] = [];
  let counter = 0;
  container.querySelectorAll<HTMLElement>('p').forEach((p) => {
    const m = (p.className || '').match(/heading[\s_-]?([1-9])/i);
    if (!m) return;
    const text = (p.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return; // skip empty heading paragraphs
    const id = `wr-h-${counter++}`;
    p.dataset.outlineId = id;
    items.push({ id, level: parseInt(m[1], 10), text });
  });
  return items;
}

function OutlinePanel({ items, activeId, onPick, onClose, onStep, dismissed, onDismiss }: {
  items: OutlineItem[];
  activeId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
  onStep: (dir: 1 | -1) => void;
  dismissed: Set<string>;
  onDismiss: (text: string) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  // Keep the active heading in view within the outline list as the user scrolls.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  // Collapse level gaps: debate docs jump from H1 to H4, which would push tags far
  // right. Map the distinct levels present to consecutive depths (0, 1, 2, …).
  const depths = Array.from(new Set(items.map(i => i.level))).sort((a, b) => a - b);
  const depthOf = (lvl: number) => Math.max(0, depths.indexOf(lvl));

  // Heading-level collapse (like Verbatim's NavPaneCycle): cycle how many of the
  // distinct depth levels are shown. `visibleDepths` = N means show depths 0..N-1.
  // Long debate files clutter the outline with all four levels; collapsing to just
  // pockets/hats makes high-level navigation fast. Starts fully expanded.
  const [visibleDepths, setVisibleDepths] = useState(depths.length);
  // Reset whenever the document's heading structure changes.
  useEffect(() => { setVisibleDepths(depths.length); }, [depths.length]);
  const cycleDepths = () => setVisibleDepths(v => (v >= depths.length ? 1 : v + 1));
  const shown = items.filter(it => depthOf(it.level) < visibleDepths);

  return (
    <div
      className="shrink-0 flex flex-col h-full"
      style={{ width: 248, borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-side)' }}
    >
      <div className="flex items-center gap-1 px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span style={{ color: 'rgb(var(--ink-rgb))' }}><IcoOutline active /></span>
        <span className="text-[12.5px] font-semibold shrink-0 ml-1" style={{ color: 'rgb(var(--ink-rgb))' }}>Outline</span>
        <span className="text-[11px] shrink-0 tabular-nums ml-1.5" style={{ color: 'var(--nav-inactive-color)' }}>{shown.length}</span>
        <div className="flex-1" />
        {depths.length > 1 && (
          <button
            onClick={cycleDepths}
            className="flex items-center gap-0.5 justify-center h-7 px-1.5 rounded-md transition"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--nav-inactive-color)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            title={visibleDepths >= depths.length ? 'Showing all heading levels — click to collapse' : `Showing ${visibleDepths} of ${depths.length} levels — click to expand`}
          >
            <IcoLayers />
            <span className="text-[10px] font-semibold tabular-nums">{visibleDepths}/{depths.length}</span>
          </button>
        )}
        {items.length > 0 && (
          <>
            <button
              onClick={() => onStep(-1)}
              className="flex items-center justify-center w-7 h-7 rounded-md transition"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--nav-inactive-color)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              title="Previous heading"
            ><IcoChevUp /></button>
            <button
              onClick={() => onStep(1)}
              className="flex items-center justify-center w-7 h-7 rounded-md transition"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--nav-inactive-color)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              title="Next heading"
            ><IcoChevDown /></button>
          </>
        )}
        <IconBtn icon={<IcoClose />} label="Close outline" onClick={onClose} tooltipAlign="right" />
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin py-1.5 px-1.5">
        {items.length === 0 ? (
          <div className="px-2 py-3 text-[12px] leading-relaxed" style={{ color: 'var(--nav-inactive-color)' }}>
            No headings found in this document. Outline navigation works with docs that use Word/Verbatim heading styles (pockets, hats, blocks, tags).
          </div>
        ) : (
          shown.map((it, idx) => {
            const active = it.id === activeId;
            const depth = depthOf(it.level);
            const topLevel = depth === 0;
            return (
              <div
                key={it.id}
                className="flex items-center rounded-md transition"
                style={{
                  marginTop: topLevel && idx > 0 ? 6 : 0,
                  background: active ? 'var(--nav-active-bg)' : 'transparent',
                  borderLeft: active ? '2px solid var(--nav-active-color, #4285F4)' : '2px solid transparent',
                }}
                onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
                onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <button
                  ref={active ? activeRef : undefined}
                  onClick={() => onPick(it.id)}
                  className="flex-1 text-left text-[12px] leading-snug py-1.5 truncate min-w-0"
                  style={{
                    paddingLeft: 8 + depth * 13,
                    color: active ? 'rgb(var(--ink-rgb))' : (topLevel ? 'rgb(var(--ink-rgb))' : 'var(--nav-inactive-color)'),
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontWeight: active || topLevel ? 600 : 400,
                  }}
                  title={it.text}
                >
                  {it.text}
                </button>
                {it.warn && !dismissed.has(it.text) && (
                  <div className="shrink-0 pr-1.5">
                    <WarnBadge type={it.warn} onDismiss={() => onDismiss(it.text)} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Toolbar toggle for the outline panel — styled hover tooltip + active state.
function OutlineToggleBtn({ active, count, onClick }: {
  active: boolean; count: number; onClick: () => void;
}) {
  const [tip, setTip] = useState(false);
  return (
    <div className="relative" onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}>
      <button
        onClick={onClick}
        className="flex items-center justify-center w-9 h-9 rounded-lg transition"
        style={{
          background: active ? 'var(--nav-active-bg)' : 'transparent',
          boxShadow: active ? 'var(--nav-active-shadow)' : 'none',
          border: 'none', cursor: 'pointer',
          color: active ? 'rgb(var(--ink-rgb))' : 'var(--nav-inactive-color)',
        }}
        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <IcoOutline active={active} />
      </button>
      {tip && (
        <div className="absolute top-full mt-1.5 px-2 py-1 text-[11px] font-medium rounded-md whitespace-nowrap z-50 pointer-events-none select-none"
          style={{ left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-elevated)', color: 'rgb(var(--ink-rgb))', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}>
          {active ? 'Hide outline' : count > 0 ? `Outline · ${count} headings` : 'Outline'}
        </div>
      )}
    </div>
  );
}

// Generic toolbar toggle (icon button with active state + styled hover tooltip).
function ToolbarToggle({ active, label, icon, onClick }: {
  active: boolean; label: string; icon: React.ReactNode; onClick: () => void;
}) {
  const [tip, setTip] = useState(false);
  return (
    <div className="relative" onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}>
      <button
        onClick={onClick}
        className="flex items-center justify-center w-9 h-9 rounded-lg transition"
        style={{
          background: active ? 'var(--nav-active-bg)' : 'transparent',
          boxShadow: active ? 'var(--nav-active-shadow)' : 'none',
          border: 'none', cursor: 'pointer',
          color: active ? 'rgb(var(--ink-rgb))' : 'var(--nav-inactive-color)',
        }}
        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {icon}
      </button>
      {tip && (
        <div className="absolute top-full mt-1.5 px-2 py-1 text-[11px] font-medium rounded-md whitespace-nowrap z-50 pointer-events-none select-none"
          style={{ left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-elevated)', color: 'rgb(var(--ink-rgb))', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}>
          {label}
        </div>
      )}
    </div>
  );
}

// Labeled toolbar pill (icon + text). Used for the panel-opening AI tools so
// they read as distinct actions rather than another anonymous icon.
function ToolbarPill({ active, label, icon, onClick, title }: {
  active: boolean; label: string; icon: React.ReactNode; onClick: () => void; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      className="flex items-center gap-1.5 h-8 px-3 rounded-lg transition text-[12px] font-medium shrink-0"
      style={{
        background: active ? 'var(--nav-active-bg)' : 'transparent',
        boxShadow: active ? 'var(--nav-active-shadow)' : 'none',
        border: 'none', cursor: 'pointer',
        color: active ? 'rgb(var(--ink-rgb))' : 'var(--nav-inactive-color)',
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Focus button icon ──────────────────────────────────────────────────────

// Focus mode (hide everything but read text): an eye with a slash through it.
function IcoFocus({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.4 18.4 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <path d="M6.61 6.61A18.4 18.4 0 0 0 1 12s4 8 11 8a9.1 9.1 0 0 0 5.39-1.61" />
      <line x1="1" y1="1" x2="23" y2="23" />
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
  const [tipPos, setTipPos] = useState<{ top: number; left: number } | null>(null);
  const [dropPos, setDropPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef    = useRef<HTMLDivElement>(null);
  const toggleRef  = useRef<HTMLButtonElement>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);

  // Position the tooltip with fixed coords so it escapes the toolbar's clipping.
  function showTip() {
    if (toggleRef.current) {
      const r = toggleRef.current.getBoundingClientRect();
      setTipPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
    }
    setTip(true);
  }

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
        onMouseEnter={showTip} onMouseLeave={() => setTip(false)}>
        <button
          ref={toggleRef}
          onClick={onToggle}
          style={{ ...btnBase, width: '34px', height: '34px', color: active ? 'rgb(var(--ink-rgb))' : 'var(--nav-inactive-color)', background: active ? 'var(--nav-active-bg)' : 'transparent', boxShadow: active ? 'var(--nav-active-shadow)' : 'none' }}
          onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--nav-hover-bg)'; }}
          onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
        >
          <IcoFocus active={active} />
        </button>

        {/* Tooltip — fixed position so it isn't clipped by the toolbar */}
        {tip && tipPos && (
          <div style={{
            position: 'fixed', top: tipPos.top, left: tipPos.left, transform: 'translateX(-50%)',
            background: 'var(--bg-elevated)', color: 'rgb(var(--ink-rgb))',
            border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-elevated)',
            borderRadius: '8px', padding: '6px 10px', zIndex: 9999,
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

interface CxQuestion { id: string; question: string; answer: string; cardCite?: string }
type CxSide = 'Aff' | 'Neg' | 'General';
interface CxGroup { side: CxSide; questions: CxQuestion[] }

// Cross-ex questions and trap drills are persisted per-document so they survive
// closing/reopening the panel, navigating away, and app restarts. Cleared only on regenerate.
const cxStorageKey = (path: string) => `warroom-cx-questions-${path}`;
const cxTrapsKey   = (path: string) => `warroom-cx-traps-${path}`;
function loadCxTraps(path: string): CxTrap[] {
  if (!path) return [];
  try {
    const v = JSON.parse(localStorage.getItem(cxTrapsKey(path)) ?? '[]');
    return Array.isArray(v) ? (v as CxTrap[]) : [];
  } catch { return []; }
}
function saveCxTraps(path: string, traps: CxTrap[]) {
  if (!path) return;
  try {
    if (traps.length === 0) localStorage.removeItem(cxTrapsKey(path));
    else localStorage.setItem(cxTrapsKey(path), JSON.stringify(traps));
  } catch {}
}
function loadCxGroups(path: string): CxGroup[] {
  if (!path) return [];
  try {
    const v = JSON.parse(localStorage.getItem(cxStorageKey(path)) ?? '[]');
    if (!Array.isArray(v) || v.length === 0) return [];
    // Migration: old format was a flat array of {id, question, answer}.
    if (v[0] && typeof v[0] === 'object' && 'question' in v[0] && !('questions' in v[0])) {
      return [{ side: 'General', questions: v as CxQuestion[] }];
    }
    return (v as any[])
      .filter((g) => g && Array.isArray(g.questions) && g.questions.length > 0)
      .map((g) => ({ side: (['Aff', 'Neg', 'General'].includes(g.side) ? g.side : 'General') as CxSide, questions: (g.questions as any[]).map((q: any) => ({ id: q.id ?? crypto.randomUUID(), question: q.question, answer: q.answer, cardCite: q.cardCite })) }));
  } catch { return []; }
}
function saveCxGroups(path: string, groups: CxGroup[]) {
  if (!path) return;
  try {
    if (groups.length === 0) localStorage.removeItem(cxStorageKey(path));
    else localStorage.setItem(cxStorageKey(path), JSON.stringify(groups));
  } catch {}
}

const eventLabel = (e: DebateEvent) =>
  e === 'pf' ? 'Public Forum' : e === 'ld' ? 'Lincoln-Douglas' : 'Policy';

// Render a plain string with light emphasis. The AI is told to use plain text
// with 'single quotes' for key phrases (no markdown), which we bold here.
function emphasize(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/('(?:[^']+)')/g).map((p, i) =>
    /^'.*'$/.test(p)
      ? <strong key={`${keyPrefix}-${i}`} style={{ fontWeight: 600 }}>{p.slice(1, -1)}</strong>
      : <React.Fragment key={`${keyPrefix}-${i}`}>{p}</React.Fragment>
  );
}

// Render AI text with light emphasis. Preserves newlines so multi-sentence
// answers/feedback keep their line breaks. If `cite`/`onCiteClick` are given and
// the cite string appears in the text, that occurrence becomes a clickable link
// that jumps to the card in the document.
function CxText({ text, className, style, cite, onCiteClick }: {
  text: string; className?: string; style?: React.CSSProperties;
  cite?: string; onCiteClick?: (cite: string) => void;
}) {
  let body: React.ReactNode;
  const trimmedCite = cite?.trim();
  const idx = trimmedCite ? text.toLowerCase().indexOf(trimmedCite.toLowerCase()) : -1;
  if (trimmedCite && onCiteClick && idx !== -1) {
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + trimmedCite.length);
    const after = text.slice(idx + trimmedCite.length);
    body = (
      <>
        {emphasize(before, 'b')}
        <button
          onClick={() => onCiteClick(match)}
          className="font-semibold transition"
          style={{ color: 'var(--nav-active-color, #4285F4)', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2, font: 'inherit' }}
          title={`Jump to ${match} in the document`}
        >
          {match}
        </button>
        {emphasize(after, 'a')}
      </>
    );
  } else {
    body = emphasize(text, 't');
  }
  return (
    <span className={className} style={{ whiteSpace: 'pre-wrap', ...style }}>
      {body}
    </span>
  );
}

function CrossExPill({ q, event, side, highlightedText, fullText, onInsertMore, onScrollToCite }: {
  q: CxQuestion;
  event: DebateEvent;
  side: CxSide;
  highlightedText: string;
  fullText: string;
  onInsertMore: (after: CxQuestion, generated: CxQuestion[]) => void;
  onScrollToCite?: (cite: string) => void;
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
        basedOn: q.question,
        side,
      });
      if (!res.ok || !res.questions) throw new Error(res.error ?? 'Failed');
      onInsertMore(q, res.questions.map((x, i) => ({
        id: `${q.id}-m${Date.now()}-${i}`,
        question: x.question,
        answer: x.answer,
        cardCite: x.cardCite,
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
      <CxText
        text={q.question}
        cite={q.cardCite}
        onCiteClick={onScrollToCite}
        className="text-[13px] leading-snug font-medium block"
        style={{ color: 'rgb(var(--ink-rgb))' }}
      />

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
          className="mt-2.5 pt-2.5 text-[12px] leading-relaxed"
          style={{ color: 'rgb(var(--ink-rgb))', opacity: 0.82, borderTop: '1px solid var(--border-subtle)' }}
        >
          <CxText text={q.answer} />
        </div>
      )}

      {moreErr && (
        <div className="mt-2 text-[11px]" style={{ color: 'rgb(var(--danger-rgb))' }}>{moreErr}</div>
      )}
    </div>
  );
}

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

// ── In-doc find ────────────────────────────────────────────────────────────
// Uses the CSS Custom Highlight API so matches are painted without mutating the
// DOM (keeps focus mode, the outline ids, and dark-mode fixes intact).
const FIND_HL = 'wr-find';
const FIND_HL_ACTIVE = 'wr-find-active';
const FIND_MATCH_CAP = 5000;

function buildFindMatches(container: HTMLElement, query: string): Range[] {
  const q = query.toLowerCase();
  const out: Range[] = [];
  if (!q.trim()) return out;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(n: Node) {
      const el = (n as Text).parentElement;
      if (!el) return NodeFilter.FILTER_REJECT;
      if ((el as HTMLElement).dataset?.focusHidden) return NodeFilter.FILTER_REJECT; // skip hidden-by-focus text
      return NodeFilter.FILTER_ACCEPT;
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
      if (out.length >= FIND_MATCH_CAP) return out;
      from = i + q.length;
      i = lower.indexOf(q, from);
    }
  }
  return out;
}

function clearFindHighlights() {
  const reg = (CSS as any)?.highlights;
  if (reg) { reg.delete(FIND_HL); reg.delete(FIND_HL_ACTIVE); }
}

function paintFindHighlights(all: Range[], active: Range | null) {
  const reg = (CSS as any)?.highlights;
  const H = (window as any)?.Highlight;
  if (!reg || !H) return;
  reg.delete(FIND_HL); reg.delete(FIND_HL_ACTIVE);
  if (all.length) reg.set(FIND_HL, new H(...all));
  if (active) reg.set(FIND_HL_ACTIVE, new H(active));
}

// ── Reading time / WPM ─────────────────────────────────────────────────────
const WPM_KEY = 'warroom-reading-wpm';
function loadWpm(): number {
  const v = parseInt(localStorage.getItem(WPM_KEY) ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 200;
}
function saveWpm(v: number) {
  try { localStorage.setItem(WPM_KEY, String(v)); } catch { /* ignore */ }
}
function fmtDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

// ── "Spoken" word count (reading time) ─────────────────────────────────────
// A debater only reads aloud a fraction of a doc: headings (pockets/hats/blocks/
// tags), the highlighted/underlined card text, and the bold author+date at the
// start of each cite (the bracketed full cite is NOT read). We count exactly
// those, so the reading estimate reflects spoken words — not every word in the file.
function headingLevelOf(el: Element | null): number {
  const m = el && ((el as HTMLElement).className || '').match(/heading[\s_-]?([1-9])/i);
  return m ? parseInt(m[1], 10) : 0;
}

function isHighlightedEl(el: HTMLElement): boolean {
  const bgStr = el.dataset.origBg || window.getComputedStyle(el).backgroundColor;
  const rgb = parseRgb(bgStr);
  return !!(rgb && isBrightHighlight(rgb));
}
function isBoldEl(el: HTMLElement): boolean {
  return parseInt(window.getComputedStyle(el).fontWeight, 10) >= 600;
}

// Collect the words a debater actually reads ALOUD. That is the highlighted text
// (what Verbatim's word count measures), plus heading paragraphs (pockets/hats/
// blocks/tags) and the bold author+date at the start of each cite. We deliberately
// do NOT count plain underlined or generally-bold body text — counting those was
// inflating the estimate ~3× versus Verbatim. Returns the word count and, if
// requested, a Range per counted run (used to visually highlight what's counted).
function collectSpoken(
  host: Node,
  opts?: { range?: Range | null; wantRanges?: boolean; maxLevel?: number },
): { count: number; ranges: Range[] } {
  const root = host.nodeType === Node.ELEMENT_NODE ? (host as Element) : host.parentElement;
  if (!root) return { count: 0, ranges: [] };
  const range = opts?.range ?? null;
  const wantRanges = !!opts?.wantRanges;

  const paras = Array.from(root.querySelectorAll<HTMLElement>('p'));
  let maxLevel = opts?.maxLevel ?? 0;
  if (!maxLevel) for (const p of paras) maxLevel = Math.max(maxLevel, headingLevelOf(p));

  let count = 0;
  const ranges: Range[] = [];
  let prevWasTag = false;

  for (const p of paras) {
    if (range && !range.intersectsNode(p)) continue;
    const level = headingLevelOf(p);
    const isHeading = level > 0;
    const isCite = !isHeading && prevWasTag;
    let citeLeadingBold = isCite; // count leading bold runs (author+date) until first non-bold

    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (range && !range.intersectsNode(node)) continue;
      const full = node.nodeValue ?? '';
      let startOff = 0, endOff = full.length;
      if (range) {
        startOff = node === range.startContainer ? range.startOffset : 0;
        endOff = node === range.endContainer ? range.endOffset : full.length;
      }
      const text = full.slice(startOff, endOff);
      const hasText = !!text.trim();
      const parent = node.parentElement;
      if (!parent || parent.dataset?.focusHidden) { if (hasText) citeLeadingBold = false; continue; }

      let counted = false;
      if (isHeading) counted = true;
      else if (isHighlightedEl(parent)) counted = true;
      else if (citeLeadingBold && isBoldEl(parent)) counted = true;

      if (isCite && hasText && !isBoldEl(parent)) citeLeadingBold = false;

      if (counted && hasText) {
        count += wordCount(text);
        if (wantRanges) {
          const r = document.createRange();
          r.setStart(node, startOff);
          r.setEnd(node, endOff);
          ranges.push(r);
        }
      }
    }

    if ((p.textContent || '').trim()) prevWasTag = maxLevel > 0 && level === maxLevel;
  }
  return { count, ranges };
}

// ── Card credibility scoring ───────────────────────────────────────────────
interface CredCard { id: string; tag: string; cite: string; highlightRatio?: number; warn?: 'over' | 'under' | null }

// Dismiss highlight warnings permanently, keyed per document path.
const hlWarnDismissKey = (path: string) => `warroom-hl-warn-${path}`;
function loadDismissed(path: string): Set<string> {
  if (!path) return new Set();
  try {
    const v = JSON.parse(localStorage.getItem(hlWarnDismissKey(path)) ?? '[]');
    return new Set(Array.isArray(v) ? v : []);
  } catch { return new Set(); }
}
function saveDismissed(path: string, set: Set<string>) {
  if (!path) return;
  try { localStorage.setItem(hlWarnDismissKey(path), JSON.stringify([...set])); } catch {}
}

// For each card, compute highlighted_words / total_body_words and flag outliers.
// Cards more than 1.5σ above/below the mean are marked 'over' / 'under'.
function computeHighlightWarnings(container: HTMLElement, cards: CredCard[]): void {
  const levelOf = (p: HTMLElement) => {
    const m = (p.className || '').match(/heading[\s_-]?([1-9])/i);
    return m ? parseInt(m[1], 10) : 0;
  };
  const ratioByCard: (number | null)[] = [];
  const validRatios: number[] = [];

  for (const card of cards) {
    const tagEl = container.querySelector<HTMLElement>(`[data-cred-id="${card.id}"]`);
    if (!tagEl) { ratioByCard.push(null); continue; }
    let hlWords = 0, totalWords = 0;
    let sib = tagEl.nextElementSibling as HTMLElement | null;
    while (sib) {
      if (levelOf(sib) > 0) break;
      const walker = document.createTreeWalker(sib, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = (node.nodeValue ?? '').trim();
        if (!text) continue;
        const parent = (node as Text).parentElement;
        if (!parent) continue;
        const wc = wordCount(text);
        totalWords += wc;
        if (isHighlightedEl(parent)) hlWords += wc;
      }
      sib = sib.nextElementSibling as HTMLElement | null;
    }
    if (totalWords < 20) { ratioByCard.push(null); continue; }
    const ratio = hlWords / totalWords;
    ratioByCard.push(ratio);
    validRatios.push(ratio);
  }

  if (validRatios.length < 4) return; // too few cards for meaningful stats

  const mean = validRatios.reduce((s, v) => s + v, 0) / validRatios.length;
  const variance = validRatios.reduce((s, v) => s + (v - mean) ** 2, 0) / validRatios.length;
  const std = Math.sqrt(variance);
  const THRESHOLD = 1.5;

  for (let i = 0; i < cards.length; i++) {
    const r = ratioByCard[i];
    cards[i].highlightRatio = r ?? undefined;
    if (r === null || std < 0.05) { cards[i].warn = null; continue; }
    if (r > mean + THRESHOLD * std) cards[i].warn = 'over';
    else if (r < mean - THRESHOLD * std) cards[i].warn = 'under';
    else cards[i].warn = null;
  }
}

// Small amber warning badge with an interactive popover and permanent dismiss.
function WarnBadge({ type, onDismiss }: { type: 'over' | 'under'; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const closeTimer = useRef<number | null>(null);

  // Hover-driven: open on enter, close shortly after leaving so the pointer can
  // travel from the badge into the (fixed-positioned) tooltip to click Dismiss.
  function show() {
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 5, left: Math.min(r.left, window.innerWidth - 260) });
    }
    setOpen(true);
  }
  function scheduleClose() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 140);
  }
  useEffect(() => () => { if (closeTimer.current) window.clearTimeout(closeTimer.current); }, []);

  const msg = type === 'over'
    ? 'Over-highlighted — more text is marked than most cards in this doc. Check if you\'re reading too broadly.'
    : 'Under-highlighted — less text is marked than most cards in this doc. You may not have prepped this card.';

  return (
    <>
      <button
        ref={btnRef}
        onMouseEnter={show}
        onMouseLeave={scheduleClose}
        onClick={e => e.stopPropagation()}
        className="shrink-0 flex items-center justify-center rounded transition"
        style={{ background: 'transparent', border: 'none', cursor: 'default', color: 'rgb(217 164 6)', padding: '1px', width: 16, height: 16 }}
      >
        <IcoWarn size={11} />
      </button>
      {open && pos && (
        <div
          onMouseEnter={show}
          onMouseLeave={scheduleClose}
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, background: 'var(--bg-elevated)', border: '1px solid rgba(217,164,6,0.4)', boxShadow: 'var(--shadow-elevated)', borderRadius: '10px', padding: '10px 12px', maxWidth: '240px' }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="text-[11px] leading-relaxed mb-2.5" style={{ color: 'rgb(var(--ink-rgb))', opacity: 0.85 }}>{msg}</div>
          <button
            onClick={() => { onDismiss(); setOpen(false); }}
            className="text-[10.5px] font-medium px-2 py-1 rounded-md transition"
            style={{ background: 'transparent', color: 'var(--nav-inactive-color)', border: '1px solid var(--border-subtle)', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
          >
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
interface CardScore { score: number; verdict: string; author: number; recency: number; source: number; reason: string; press: string }

// Extract each card (tag + the cite text that follows it) from the rendered doc.
// A "card" is a tag — the deepest heading level used in the doc (Heading4 in
// Verbatim). The cite is the text of the paragraphs after the tag, up to the next
// heading, capped so we send the author/quals/date without the whole card body.
function buildCards(container: HTMLElement): CredCard[] {
  const paras = Array.from(container.querySelectorAll<HTMLElement>('p'));
  const levelOf = (p: HTMLElement) => {
    const m = (p.className || '').match(/heading[\s_-]?([1-9])/i);
    return m ? parseInt(m[1], 10) : 0;
  };
  const maxLevel = paras.reduce((mx, p) => Math.max(mx, levelOf(p)), 0);
  if (maxLevel === 0) return [];

  const cards: CredCard[] = [];
  let n = 0;
  for (const p of paras) {
    if (levelOf(p) !== maxLevel) continue;
    const tag = (p.textContent || '').replace(/\s+/g, ' ').trim();
    if (!tag) continue;
    let cite = '';
    let sib = p.nextElementSibling as HTMLElement | null;
    while (sib && wordCount(cite) < 80) {
      if (levelOf(sib) > 0) break; // next heading → end of this card's cite
      const t = (sib.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) cite = cite ? `${cite} ${t}` : t;
      sib = sib.nextElementSibling as HTMLElement | null;
    }
    // Skip headings that have no citation under them (section headers, blank tags,
    // analytics) — only real cards (tag + cite) get scored. Use wordCount so that
    // invisible characters or lone punctuation don't trick the check.
    if (wordCount(cite) === 0) continue;
    const id = `wr-cred-${n++}`;
    p.dataset.credId = id;
    cards.push({ id, tag, cite: cite.slice(0, 600) });
  }
  return cards;
}

function hashCards(cards: CredCard[]): string {
  // Hash by tag text only — cite text can vary slightly between renders due to
  // whitespace differences in the DOM, but heading text is stable.
  const s = cards.map(c => c.tag).join('§');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `${h}:${cards.length}`;
}

const credKey = (path: string) => `warroom-cred-${path}`;
function loadCred(path: string, hash: string): CardScore[] | null {
  if (!path) return null;
  try {
    const v = JSON.parse(localStorage.getItem(credKey(path)) ?? 'null');
    if (v && v.hash === hash && Array.isArray(v.scores)) return v.scores as CardScore[];
  } catch { /* ignore */ }
  return null;
}
function saveCred(path: string, hash: string, scores: CardScore[]) {
  if (!path) return;
  try { localStorage.setItem(credKey(path), JSON.stringify({ hash, scores })); } catch { /* ignore */ }
}

// Color a 0-10 score: green (strong) → blue (solid) → amber (shaky) → red (weak).
function credColor(score: number): string {
  if (score >= 8) return '34 197 94';
  if (score >= 6) return '66 133 244';
  if (score >= 4) return '217 164 6';
  return 'var(--danger-rgb)';
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] w-[52px] shrink-0" style={{ color: 'var(--nav-inactive-color)' }}>{label}</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-subtle)' }}>
        <div className="h-full rounded-full" style={{ width: `${value * 10}%`, background: `rgb(${credColor(value)})` }} />
      </div>
      <span className="text-[10px] tabular-nums w-[22px] text-right shrink-0" style={{ color: 'rgb(var(--ink-rgb))' }}>{value}</span>
    </div>
  );
}

function CredibilityPanel({ cards, scores, loading, error, onScore, onScrollToCard, onClose, dismissed, onDismiss }: {
  cards: CredCard[];
  scores: CardScore[] | null;
  loading: boolean;
  error: string;
  onScore: () => void;
  onScrollToCard: (id: string) => void;
  onClose: () => void;
  dismissed: Set<string>;
  onDismiss: (tag: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const avg = scores && scores.length
    ? Math.round((scores.reduce((s, x) => s + x.score, 0) / scores.length) * 10) / 10
    : null;

  return (
    <div className="shrink-0 flex flex-col h-full" style={{ width: 300, borderLeft: '1px solid var(--border-subtle)', background: 'var(--bg-side)' }}>
      <div className="flex items-center gap-2 px-3.5 py-2 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span style={{ color: 'rgb(var(--ink-rgb))' }}><IcoShield active /></span>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[12.5px] font-semibold leading-tight truncate" style={{ color: 'rgb(var(--ink-rgb))' }}>Card Credibility</span>
          <span className="text-[10px] leading-tight" style={{ color: 'var(--nav-inactive-color)' }}>
            {cards.length} card{cards.length === 1 ? '' : 's'}{avg !== null ? ` · avg ${avg}/10` : ''}
          </span>
        </div>
        {scores && !loading && (
          <IconBtn icon={<IcoMore />} label="Re-score all cards" onClick={onScore} />
        )}
        <IconBtn icon={<IcoClose />} label="Close" onClick={onClose} tooltipAlign="right" />
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin px-2.5 py-2.5 space-y-2">
        {error && (
          <div className="text-[12px] rounded-lg p-2.5" style={{ color: 'rgb(var(--danger-rgb))', background: 'rgba(var(--danger-rgb), 0.08)', border: '1px solid rgba(var(--danger-rgb), 0.25)' }}>
            {error}
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center gap-2 mt-8" style={{ color: 'var(--nav-inactive-color)' }}>
            <Spinner className="w-5 h-5" />
            <div className="text-[12px]">Scoring {cards.length} cards…</div>
          </div>
        )}

        {!loading && cards.length === 0 && !error && (
          <div className="px-1 py-3 text-[12px] leading-relaxed" style={{ color: 'var(--nav-inactive-color)' }}>
            No cards found. Credibility scoring works with docs that use Word/Verbatim card tags and cites.
          </div>
        )}

        {!loading && !scores && cards.length > 0 && !error && (
          <div className="px-1 py-2">
            <p className="text-[12px] leading-relaxed mb-3" style={{ color: 'var(--nav-inactive-color)' }}>
              Warroom AI will rate every card's credibility — author qualifications, recency, and source quality — in one pass, and suggest how to attack each in cross-ex.
            </p>
            <button
              onClick={onScore}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12.5px] font-semibold transition"
              style={{ background: 'var(--item-selected-bg)', color: 'var(--item-selected-text)', border: '1px solid var(--border-subtle)', cursor: 'pointer' }}
            >
              <IcoShield active /> Score {cards.length} cards
            </button>
          </div>
        )}

        {!loading && scores && cards.map((c, i) => {
          const sc = scores[i];
          if (!sc) return null;
          const open = expanded === c.id;
          return (
            <div key={c.id} className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
              <button
                onClick={() => setExpanded(open ? null : c.id)}
                className="w-full text-left p-2.5 flex items-start gap-2.5 transition"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
                onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              >
                <div
                  className="shrink-0 w-9 h-9 rounded-lg flex flex-col items-center justify-center"
                  style={{ background: `rgba(${credColor(sc.score)}, 0.15)`, border: `1px solid rgba(${credColor(sc.score)}, 0.4)` }}
                >
                  <span className="text-[14px] font-bold leading-none tabular-nums" style={{ color: `rgb(${credColor(sc.score)})` }}>{sc.score}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold mb-0.5" style={{ color: `rgb(${credColor(sc.score)})` }}>{sc.verdict}</div>
                  <div className="text-[11.5px] leading-snug" style={{ color: 'rgb(var(--ink-rgb))', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.tag}</div>
                </div>
                <span className="shrink-0 mt-1" style={{ color: 'var(--nav-inactive-color)', transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none', display: 'block' }}>
                  <IcoChevron open={open} />
                </span>
              </button>

              {open && (
                <div className="px-2.5 pb-2.5 space-y-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <div className="space-y-1 pt-2">
                    <ScoreBar label="Author" value={sc.author} />
                    <ScoreBar label="Recency" value={sc.recency} />
                    <ScoreBar label="Source" value={sc.source} />
                    {'claim' in sc && <ScoreBar label="Claim fit" value={(sc as any).claim} />}
                  </div>
                  {c.warn && !dismissed.has(c.tag) && (
                    <div className="flex items-start gap-2 rounded-lg px-2.5 py-2" style={{ background: 'rgba(217,164,6,0.08)', border: '1px solid rgba(217,164,6,0.3)' }}>
                      <span style={{ color: 'rgb(217 164 6)', marginTop: 1 }}><IcoWarn size={12} /></span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10.5px] leading-snug" style={{ color: 'rgb(var(--ink-rgb))', opacity: 0.85 }}>
                          {c.warn === 'over' ? 'Over-highlighted — more text marked than most cards in this doc.' : 'Under-highlighted — less text marked than most cards. May not be well prepped.'}
                          {c.highlightRatio !== undefined && (
                            <span style={{ opacity: 0.6 }}> ({Math.round(c.highlightRatio * 100)}% highlighted)</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => onDismiss(c.tag)}
                        className="shrink-0 text-[10px] px-1.5 py-0.5 rounded transition"
                        style={{ background: 'transparent', border: '1px solid rgba(217,164,6,0.3)', color: 'var(--nav-inactive-color)', cursor: 'pointer' }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                      >Dismiss</button>
                    </div>
                  )}
                  {sc.reason && (
                    <div className="text-[11px] leading-relaxed" style={{ color: 'rgb(var(--ink-rgb))', opacity: 0.85 }}>{sc.reason}</div>
                  )}
                  {sc.press && (
                    <div className="rounded-lg p-2 text-[11px] leading-relaxed" style={{ background: 'rgba(var(--danger-rgb), 0.08)', border: '1px solid rgba(var(--danger-rgb), 0.2)', color: 'rgb(var(--ink-rgb))' }}>
                      <span className="font-semibold" style={{ color: 'rgb(var(--danger-rgb))' }}>Press: </span>{sc.press}
                    </div>
                  )}
                  <button
                    onClick={() => onScrollToCard(c.id)}
                    className="text-[11px] font-medium px-2 py-1 rounded-md transition"
                    style={{ background: 'transparent', color: 'var(--nav-inactive-color)', border: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
                    onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    Go to card in document
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Warn when a doc is too thin to yield good cross-ex questions. Questions are built
// only from highlighted (read) text, so we check that first, then overall length.
function cxShortDocWarning(highlighted: string, full: string): string {
  const h = wordCount(highlighted);
  const f = wordCount(full);
  if (h < 120) {
    return `Very little highlighted text (~${h} words). Cross-ex questions are built only from highlighted/underlined text, so you'll likely get few or shallow questions. Highlight the cards you plan to read for better results.`;
  }
  if (f < 400) {
    const pages = Math.max(1, Math.round(f / 500));
    return `Short document (~${f} words, roughly ${pages} page${pages > 1 ? 's' : ''}). With limited content, expect only a handful of questions and less strategic depth.`;
  }
  return '';
}

interface CxTrap { setup: string; trapAnswer: string; gotcha: string; idealAnswer: string; lesson: string }
interface CxTrapResult { verdict: 'avoided' | 'fell' | 'partial'; feedback: string }

// ── Trap drill — interactive "harder questions" gauntlet ────────────────────
function TrapDrill({ event, highlighted, full, docKey, onExit }: {
  event: DebateEvent;
  highlighted: string;
  full: string;
  docKey: string;
  onExit: () => void;
}) {
  const saved = loadCxTraps(docKey);
  const [traps, setTraps] = useState<CxTrap[]>(saved);
  const [loading, setLoading] = useState(saved.length === 0);
  const [error, setError] = useState('');
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState('');
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<CxTrapResult | null>(null);

  useEffect(() => {
    if (saved.length > 0) return; // already have saved traps — skip generation
    let cancelled = false;
    (async () => {
      try {
        const res = await window.warroom.ai.crossExTraps({
          highlightedText: highlighted, fullText: full, event: event as 'policy' | 'pf' | 'ld',
        });
        if (cancelled) return;
        if (!res.ok || !res.traps?.length) throw new Error(res.error ?? 'No traps generated');
        setTraps(res.traps);
        saveCxTraps(docKey, res.traps);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load traps');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const trap = traps[idx];

  async function grade() {
    if (!trap || !answer.trim()) return;
    setGrading(true);
    try {
      const res = await window.warroom.ai.crossExGradeTrap({
        setup: trap.setup, idealAnswer: trap.idealAnswer, trapAnswer: trap.trapAnswer,
        gotcha: trap.gotcha, lesson: trap.lesson, userAnswer: answer,
        event: event as 'policy' | 'pf' | 'ld',
      });
      if (!res.ok) throw new Error(res.error ?? 'Failed to grade');
      setResult({ verdict: res.verdict ?? 'partial', feedback: res.feedback ?? '' });
    } catch (e: any) {
      setResult({ verdict: 'partial', feedback: e?.message ?? 'Could not grade that answer.' });
    } finally {
      setGrading(false);
    }
  }

  function next() {
    setResult(null);
    setAnswer('');
    setIdx(i => i + 1);
  }

  const verdictColor = (v: CxTrapResult['verdict']) =>
    v === 'avoided' ? '34 197 94' : v === 'fell' ? 'var(--danger-rgb)' : '217 164 6';
  const avoided = result?.verdict === 'avoided';

  return (
    <div className="flex flex-col h-full">
      {/* Sub-header */}
      <div className="flex items-center gap-2 px-3.5 py-2 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <IconBtn icon={<IcoBack />} label="Back to questions" onClick={onExit} tooltipAlign="left" />
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span style={{ color: 'rgb(var(--ink-rgb))' }}><IcoTrap /></span>
          <span className="text-[12.5px] font-semibold truncate" style={{ color: 'rgb(var(--ink-rgb))' }}>Trap Drill</span>
        </div>
        {traps.length > 0 && (
          <span className="text-[11px] shrink-0" style={{ color: 'var(--nav-inactive-color)' }}>Trap {Math.min(idx + 1, traps.length)} of {traps.length}</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin px-3.5 py-3">
        {loading && (
          <div className="flex flex-col items-center gap-2 mt-8" style={{ color: 'var(--nav-inactive-color)' }}>
            <Spinner className="w-5 h-5" />
            <div className="text-[12px]">Setting traps…</div>
          </div>
        )}

        {error && (
          <div className="text-[12px] rounded-lg p-2.5" style={{ color: 'rgb(var(--danger-rgb))', background: 'rgba(var(--danger-rgb), 0.08)', border: '1px solid rgba(var(--danger-rgb), 0.25)' }}>
            {error}
          </div>
        )}

        {!loading && !error && idx >= traps.length && traps.length > 0 && (
          <div className="flex flex-col items-center text-center gap-3 mt-8 px-2">
            <span style={{ color: '#22c55e' }}><IcoTrap size={22} /></span>
            <div className="text-[13px] font-semibold" style={{ color: 'rgb(var(--ink-rgb))' }}>Drill complete</div>
            <div className="text-[12px]" style={{ color: 'rgb(var(--ink-rgb))', opacity: 0.65 }}>You worked through all {traps.length} traps. Run it again for a fresh set.</div>
          </div>
        )}

        {!loading && !error && trap && idx < traps.length && (
          <div className="space-y-3">
            <div className="rounded-xl p-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
              <div className="text-[10.5px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--nav-inactive-color)' }}>Setup question</div>
              <CxText text={trap.setup} className="text-[13px] leading-snug font-medium block" style={{ color: 'rgb(var(--ink-rgb))' }} />
            </div>

            <textarea
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              disabled={!!result || grading}
              placeholder="Type how you'd answer in cross-ex…"
              rows={4}
              className="w-full rounded-lg px-3 py-2 text-[12.5px] resize-none scroll-thin"
              style={{ background: 'var(--bg-input)', color: 'rgb(var(--ink-rgb))', border: '1px solid var(--border-med)', outline: 'none', opacity: result ? 0.7 : 1 }}
            />

            {!result && (
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={grade}
                  disabled={grading || !answer.trim()}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12.5px] font-semibold transition"
                  style={{ background: 'var(--item-selected-bg)', color: 'var(--item-selected-text)', border: '1px solid var(--border-subtle)', boxShadow: '0 2px 8px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.08)', cursor: grading || !answer.trim() ? 'default' : 'pointer', opacity: grading || !answer.trim() ? 0.55 : 1 }}
                >
                  {grading ? <Spinner className="w-3.5 h-3.5" /> : <IcoTrap />}
                  {grading ? 'Checking…' : 'Check my answer'}
                </button>
                <button
                  onClick={next}
                  disabled={grading}
                  className="w-full py-1.5 rounded-lg text-[11.5px] font-medium transition"
                  style={{ background: 'transparent', color: 'var(--nav-inactive-color)', border: '1px solid var(--border-subtle)', cursor: grading ? 'default' : 'pointer', opacity: grading ? 0.4 : 1 }}
                  onMouseEnter={e => { if (!grading) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  Skip this trap
                </button>
              </div>
            )}

            {result && (
              <div className="space-y-2.5">
                <div className="rounded-xl p-3" style={{ background: `rgba(${verdictColor(result.verdict)}, 0.1)`, border: `1px solid rgba(${verdictColor(result.verdict)}, 0.3)` }}>
                  <div className="text-[12px] font-bold mb-1" style={{ color: `rgb(${verdictColor(result.verdict)})` }}>
                    {avoided ? '✓ You avoided the trap' : result.verdict === 'partial' ? '~ Partially safe' : '✗ Gotcha — you fell for it'}
                  </div>
                  <CxText text={result.feedback} className="text-[12px] leading-relaxed block" style={{ color: 'rgb(var(--ink-rgb))', opacity: 0.85 }} />
                </div>

                {trap.idealAnswer && (
                  <div className="rounded-xl p-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                    <div className="text-[10.5px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--nav-inactive-color)' }}>Ideal answer</div>
                    <CxText text={trap.idealAnswer} className="text-[12px] leading-relaxed block" style={{ color: 'rgb(var(--ink-rgb))', opacity: 0.85 }} />
                  </div>
                )}

                <button
                  onClick={next}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12.5px] font-semibold transition"
                  style={{ background: 'transparent', color: 'rgb(var(--ink-rgb))', border: '1px solid var(--border-med)', cursor: 'pointer' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  {idx + 1 < traps.length ? 'Next trap' : 'Finish drill'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CrossExPanel({ event, onClose, docKey, onScrollToCite }: {
  event: DebateEvent;
  onClose: () => void;
  docKey: string;
  onScrollToCite?: (cite: string) => void;
}) {
  const [groups, setGroups] = useState<CxGroup[]>(() => loadCxGroups(docKey));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [started, setStarted] = useState(() => loadCxGroups(docKey).length > 0);
  const [trapMode, setTrapMode] = useState(false);

  // Extracted doc text, kept in state so child pills / the trap drill re-render once
  // it's available — including for questions restored from localStorage.
  const [extracted, setExtracted] = useState<{ highlighted: string; full: string } | null>(null);
  const extractInFlight = useRef<Promise<{ highlighted: string; full: string }> | null>(null);

  useEffect(() => { saveCxGroups(docKey, groups); }, [docKey, groups]);

  async function getExtracted(): Promise<{ highlighted: string; full: string }> {
    if (extracted) return extracted;
    if (extractInFlight.current) return extractInFlight.current;
    extractInFlight.current = (async () => {
      const res = await (window.warroom as any).speechdoc.extract(docKey);
      if (!res?.ok || !res.data) throw new Error('Could not extract document text.');
      const out = { highlighted: res.data.tokenSaving ?? '', full: res.data.full ?? '' };
      setExtracted(out);
      setWarning(cxShortDocWarning(out.highlighted, out.full));
      return out;
    })();
    try { return await extractInFlight.current; }
    finally { extractInFlight.current = null; }
  }

  // Pre-extract on mount so restored questions can use "3 more like this"/traps.
  useEffect(() => { getExtracted().catch(() => {}); }, [docKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generate() {
    setLoading(true);
    setError('');
    setStarted(true);
    saveCxTraps(docKey, []); // clear saved traps so the drill regenerates for the new questions
    try {
      const { highlighted, full } = await getExtracted();
      if (!highlighted.trim()) throw new Error('No highlighted text found in this document.');
      setWarning(cxShortDocWarning(highlighted, full));
      const res = await window.warroom.ai.crossExQuestions({
        highlightedText: highlighted,
        fullText: full,
        event: event as 'policy' | 'pf' | 'ld',
      });
      if (!res.ok || !res.groups) throw new Error(res.error ?? 'Failed to generate');
      const stamp = Date.now();
      setGroups(res.groups.map((g, gi) => ({
        side: g.side,
        questions: g.questions.map((x, i) => ({
          id: `q${stamp}-${gi}-${i}`,
          question: x.question,
          answer: x.answer,
          cardCite: x.cardCite,
        })),
      })));
    } catch (e: any) {
      setError(e?.message ?? 'Failed to generate questions');
    } finally {
      setLoading(false);
    }
  }

  // Insert "3 more like this" results after the seed question, within its own group.
  function insertMore(after: CxQuestion, generated: CxQuestion[]) {
    setGroups(prev => prev.map(g => {
      const idx = g.questions.findIndex(q => q.id === after.id);
      if (idx === -1) return g;
      return { ...g, questions: [...g.questions.slice(0, idx + 1), ...generated, ...g.questions.slice(idx + 1)] };
    }));
  }

  async function openTrapDrill() {
    setError('');
    try {
      const ex = await getExtracted(); // ensure extraction is ready before entering the drill
      if (!ex.highlighted.trim()) throw new Error('No highlighted text found in this document.');
      setTrapMode(true);
    } catch (e: any) {
      setError(e?.message ?? 'Could not start trap drill');
    }
  }

  const highlighted = extracted?.highlighted ?? '';
  const full = extracted?.full ?? '';
  const totalQuestions = groups.reduce((n, g) => n + g.questions.length, 0);
  // Only label sections when there's a real Aff/Neg split to show.
  const showSideHeaders = groups.length > 1 || (groups[0] && groups[0].side !== 'General');

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

      {trapMode ? (
        <TrapDrill event={event} highlighted={highlighted} full={full} docKey={docKey} onExit={() => setTrapMode(false)} />
      ) : (
        <>
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

            {loading && totalQuestions === 0 && (
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

            {warning && totalQuestions > 0 && (
              <div className="text-[11.5px] leading-relaxed rounded-lg p-2.5 flex gap-2" style={{ color: 'rgb(217 164 6)', background: 'rgba(217, 164, 6, 0.1)', border: '1px solid rgba(217, 164, 6, 0.3)' }}>
                <span className="shrink-0 mt-0.5"><IcoWarn /></span>
                <span>{warning}</span>
              </div>
            )}

            {groups.map((g, gi) => (
              <div key={gi} className="space-y-2.5">
                {showSideHeaders && (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md"
                      style={{
                        color: g.side === 'Aff' ? 'rgb(59 130 246)' : g.side === 'Neg' ? 'rgb(239 68 68)' : 'var(--nav-inactive-color)',
                        background: g.side === 'Aff' ? 'rgba(59,130,246,0.12)' : g.side === 'Neg' ? 'rgba(239,68,68,0.12)' : 'var(--nav-hover-bg)',
                      }}>
                      {g.side === 'General' ? 'Questions' : g.side}
                    </span>
                    <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                  </div>
                )}
                {g.questions.map(q => (
                  <CrossExPill key={q.id} q={q} event={event} side={g.side} highlightedText={highlighted} fullText={full} onInsertMore={insertMore} onScrollToCite={onScrollToCite} />
                ))}
              </div>
            ))}
          </div>

          {/* Footer actions */}
          <div className="px-3.5 py-2.5 shrink-0 flex gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <button
              onClick={generate}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12.5px] font-semibold transition"
              style={{ background: 'var(--item-selected-bg)', color: 'var(--item-selected-text)', border: '1px solid var(--border-subtle)', boxShadow: '0 2px 8px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.08)', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.65 : 1 }}
            >
              {loading ? <Spinner className="w-3.5 h-3.5" /> : <IcoSparkle />}
              {loading ? 'Generating…' : started ? 'Regenerate' : 'Generate'}
            </button>
            <button
              onClick={openTrapDrill}
              disabled={loading}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-semibold transition"
              style={{ background: 'transparent', color: 'rgb(var(--ink-rgb))', border: '1px solid var(--border-med)', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.55 : 1 }}
              onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              title="Harder questions — a timed-style trap drill where you type answers and get graded"
            >
              <IcoTrap />
              Harder
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Send to Flow ────────────────────────────────────────────────────────────
// Bridge from the speech doc to a Verbatim-style flow (.xlsx) sheet, mirroring
// Verbatim's "Send To Flow" — push a selected card / heading into a flow cell.
interface StoredFlowShape {
  event?: string;
  pfOrder?: string;
  customColumns?: string[] | null;
  sheets?: { id: string; name: string; cells?: Record<string, string> }[];
}

function flowColumnsOf(data: StoredFlowShape | null | undefined): string[] {
  if (data?.customColumns?.length) return data.customColumns;
  if ((data?.event ?? 'policy') === 'pf') return data?.pfOrder === 'con-first' ? PF_CON_FIRST_COLS : PF_PRO_FIRST_COLS;
  return POLICY_COLS;
}

// The cite shorthand (author last name + date) is the leading-bold run of the
// paragraph right after a tag. Returns '' if the next block is another heading.
function citeShorthandAfter(tagEl: HTMLElement): string {
  let sib = tagEl.nextElementSibling as HTMLElement | null;
  while (sib && !(sib.textContent || '').trim()) sib = sib.nextElementSibling as HTMLElement | null;
  if (!sib) return '';
  if ((sib.className || '').match(/heading[\s_-]?[1-9]/i)) return '';
  let out = '';
  const walker = document.createTreeWalker(sib, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue ?? '';
    if (!text.trim()) { out += text; continue; }
    const parent = (node as Text).parentElement;
    if (parent && isBoldEl(parent)) out += text;
    else break; // leading-bold section (author + date) ended
  }
  return out.replace(/\s+/g, ' ').trim();
}

type FlowSendMode = 'text' | 'shorthand';

function SendToFlowPopover({ container, flows, activeHeadingId, anchorTop, onClose }: {
  container: HTMLElement | null;
  flows: FlowMeta[];
  activeHeadingId: string | null;
  anchorTop: number;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<FlowSendMode>('text');
  const [flowId, setFlowId] = useState<string>(flows[0]?.id ?? '');
  const [data, setData] = useState<StoredFlowShape | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [colIdx, setColIdx] = useState(0);
  const [content, setContent] = useState<{ text: string; source: string }>({ text: '', source: '' });
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');

  // Recompute the content to send from the current selection / active card.
  const recompute = useCallback(() => {
    if (!container) { setContent({ text: '', source: '' }); return; }
    const sel = window.getSelection();
    const hasSel = !!(sel && !sel.isCollapsed && sel.rangeCount > 0 &&
      container.contains(sel.getRangeAt(0).commonAncestorContainer));
    const tagEl = activeHeadingId ? container.querySelector<HTMLElement>(`[data-outline-id="${activeHeadingId}"]`) : null;

    if (mode === 'shorthand') {
      if (!tagEl) { setContent({ text: '', source: 'Scroll to a card first' }); return; }
      const tag = (tagEl.textContent || '').replace(/\s+/g, ' ').trim();
      const cite = citeShorthandAfter(tagEl);
      setContent({ text: cite ? `${tag} — ${cite}` : tag, source: 'Current card (tag + cite)' });
      return;
    }
    if (hasSel) { setContent({ text: sel!.toString().replace(/\s+/g, ' ').trim(), source: 'Selected text' }); return; }
    if (tagEl) { setContent({ text: (tagEl.textContent || '').replace(/\s+/g, ' ').trim(), source: 'Current heading' }); return; }
    setContent({ text: '', source: 'Select text or scroll to a card' });
  }, [container, activeHeadingId, mode]);

  // Recompute on open, on mode change, and as the user changes their selection.
  useEffect(() => {
    recompute();
    const onChange = () => recompute();
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [recompute]);

  // Load the chosen flow's sheets + columns.
  useEffect(() => {
    if (!flowId) { setData(null); return; }
    let cancelled = false;
    (async () => {
      const d = await window.warroom?.storage.read(`flow_data_${flowId}`) as StoredFlowShape | null;
      if (cancelled) return;
      setData(d ?? null);
      setSheetIdx(0);
      setColIdx(0);
    })();
    return () => { cancelled = true; };
  }, [flowId]);

  const sheets = data?.sheets ?? [];
  const columns = flowColumnsOf(data);

  async function send() {
    if (!flowId || !content.text) return;
    setStatus('sending');
    setErrMsg('');
    try {
      const key = `flow_data_${flowId}`;
      const d = (await window.warroom?.storage.read(key)) as StoredFlowShape | null;
      if (!d?.sheets?.length) throw new Error('That flow has no sheets yet — open it once first.');
      const sIdx = Math.min(sheetIdx, d.sheets.length - 1);
      const sheet = d.sheets[sIdx];
      sheet.cells = sheet.cells || {};
      // Append to the next empty row in the chosen column.
      let row = 0;
      for (; row < NUM_ROWS; row++) if (!(sheet.cells[`${row}-${colIdx}`] || '').trim()) break;
      if (row >= NUM_ROWS) throw new Error('That column is full.');
      sheet.cells[`${row}-${colIdx}`] = content.text;
      await window.warroom?.storage.write(key, d);
      // Live-refresh the flow if it's open in another view.
      window.dispatchEvent(new CustomEvent('warroom-flow-updated', { detail: { flowId } }));
      setStatus('sent');
      window.setTimeout(() => setStatus('idle'), 1800);
    } catch (e: any) {
      setStatus('error');
      setErrMsg(e?.message ?? 'Could not send to flow');
    }
  }

  const selStyle: React.CSSProperties = {
    background: 'var(--bg-input)', color: 'rgb(var(--ink-rgb))',
    border: '1px solid var(--border-med)', borderRadius: 7, padding: '4px 6px',
    fontSize: 12, outline: 'none', width: '100%',
  };

  return (
    <div
      className="absolute z-40 rounded-xl p-3 w-[280px]"
      style={{ top: anchorTop, right: 16, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <span style={{ color: 'rgb(var(--ink-rgb))' }}><IcoSendFlow active /></span>
        <span className="text-[12.5px] font-semibold flex-1" style={{ color: 'rgb(var(--ink-rgb))' }}>Send to Flow</span>
        <IconBtn icon={<IcoClose />} label="Close" onClick={onClose} tooltipAlign="right" />
      </div>

      {flows.length === 0 ? (
        <div className="text-[12px] leading-relaxed py-2" style={{ color: 'var(--nav-inactive-color)' }}>
          You don't have any flows yet. Create one in the Flows section first.
        </div>
      ) : (
        <>
          {/* Mode toggle */}
          <div className="flex gap-1 mb-2.5 p-0.5 rounded-lg" style={{ background: 'var(--bg-side)' }}>
            {([['text', 'Selection'], ['shorthand', 'Tag + cite']] as [FlowSendMode, string][]).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="flex-1 text-[11px] font-medium py-1 rounded-md transition"
                style={{ background: mode === m ? 'var(--nav-active-bg)' : 'transparent', color: mode === m ? 'rgb(var(--ink-rgb))' : 'var(--nav-inactive-color)', border: 'none', cursor: 'pointer' }}
              >{label}</button>
            ))}
          </div>

          {/* Preview */}
          <div className="rounded-lg p-2 mb-2.5" style={{ background: 'var(--bg-side)', border: '1px solid var(--border-subtle)' }}>
            <div className="text-[9.5px] uppercase tracking-wide font-semibold mb-1" style={{ color: 'var(--nav-inactive-color)' }}>{content.source || 'Nothing to send'}</div>
            <div className="text-[11.5px] leading-snug" style={{ color: 'rgb(var(--ink-rgb))', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {content.text || <span style={{ opacity: 0.5 }}>Select text in the doc, or scroll so a card tag is at the top.</span>}
            </div>
          </div>

          {/* Destination */}
          <label className="text-[10.5px] font-medium block mb-1" style={{ color: 'var(--nav-inactive-color)' }}>Flow</label>
          <select value={flowId} onChange={e => setFlowId(e.target.value)} style={{ ...selStyle, marginBottom: 8 }}>
            {flows.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>

          <div className="flex gap-2 mb-2.5">
            <div className="flex-1 min-w-0">
              <label className="text-[10.5px] font-medium block mb-1" style={{ color: 'var(--nav-inactive-color)' }}>Sheet</label>
              <select value={sheetIdx} onChange={e => setSheetIdx(parseInt(e.target.value, 10))} style={selStyle}>
                {sheets.length === 0 ? <option value={0}>—</option> : sheets.map((s, i) => <option key={s.id ?? i} value={i}>{s.name}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-0">
              <label className="text-[10.5px] font-medium block mb-1" style={{ color: 'var(--nav-inactive-color)' }}>Column</label>
              <select value={colIdx} onChange={e => setColIdx(parseInt(e.target.value, 10))} style={selStyle}>
                {columns.map((c, i) => <option key={i} value={i}>{c}</option>)}
              </select>
            </div>
          </div>

          <button
            onClick={send}
            disabled={!content.text || status === 'sending'}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-semibold transition"
            style={{ background: 'var(--item-selected-bg)', color: 'var(--item-selected-text)', border: '1px solid var(--border-subtle)', cursor: (!content.text || status === 'sending') ? 'default' : 'pointer', opacity: (!content.text || status === 'sending') ? 0.5 : 1 }}
          >
            {status === 'sent' ? '✓ Sent to flow' : status === 'sending' ? 'Sending…' : <><IcoSendFlow /> Send to next empty row</>}
          </button>

          {status === 'error' && errMsg && (
            <div className="mt-2 text-[11px]" style={{ color: 'rgb(var(--danger-rgb))' }}>{errMsg}</div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function SpeechDocViewer() {
  const { setBusy, view, setView, event, flowsIndex } = useApp();
  const [step, setStep] = useState<Step>('idle');
  const [cxOpen, setCxOpen] = useState(false);
  const [flowSendOpen, setFlowSendOpen] = useState(false);
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
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  // Find bar
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findCount, setFindCount] = useState(0);
  const [findIdx, setFindIdx] = useState(0);
  const findRangesRef = useRef<Range[]>([]);
  const findInputRef = useRef<HTMLInputElement>(null);
  // Reading time / auto-scroll
  const [readOpen, setReadOpen] = useState(false);
  const [wpm, setWpm] = useState(loadWpm);
  const [docWords, setDocWords] = useState(0);
  const [selWords, setSelWords] = useState(0);
  const [autoScroll, setAutoScroll] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  // Card credibility
  const [credOpen, setCredOpen] = useState(false);
  const [credCards, setCredCards] = useState<CredCard[]>([]);
  const [credScores, setCredScores] = useState<CardScore[] | null>(null);
  const [credLoading, setCredLoading] = useState(false);
  const [credError, setCredError] = useState('');
  const credHashRef = useRef('');
  // Highlight-outlier warning dismissals (per-doc, loaded from localStorage)
  const [dismissedWarnings, setDismissedWarnings] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollWrapRef = useRef<HTMLDivElement>(null);
  const wpmRef = useRef(wpm);
  const docWordsRef = useRef(0);
  const autoRafRef = useRef(0);
  const autoAccRef = useRef(0);
  const autoLastRef = useRef(0);
  const autoLastSetRef = useRef(0);
  useEffect(() => { wpmRef.current = wpm; }, [wpm]);
  useEffect(() => { docWordsRef.current = docWords; }, [docWords]);

  // Load per-doc dismissed highlight warnings whenever the open file changes.
  useEffect(() => { setDismissedWarnings(loadDismissed(filePath)); }, [filePath]);

  const dismissWarning = useCallback((tagText: string) => {
    setDismissedWarnings(prev => {
      const next = new Set(prev);
      next.add(tagText);
      saveDismissed(filePath, next);
      return next;
    });
  }, [filePath]);

  // Inject the find-highlight styles once.
  useEffect(() => {
    if (document.getElementById('wr-find-style')) return;
    const el = document.createElement('style');
    el.id = 'wr-find-style';
    el.textContent =
      `::highlight(${FIND_HL}){background-color:rgba(255,213,0,0.40);}` +
      `::highlight(${FIND_HL_ACTIVE}){background-color:rgba(255,138,0,0.85);color:#1c1c1e;}`;
    document.head.appendChild(el);
  }, []);

  // ── Find handlers ──────────────────────────────────────────────────────
  const scrollRangeIntoView = useCallback((range: Range) => {
    const wrap = scrollWrapRef.current;
    if (!wrap) return;
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      (range.startContainer.parentElement as HTMLElement | null)?.scrollIntoView({ block: 'center' });
      return;
    }
    const wrapRect = wrap.getBoundingClientRect();
    const target = wrap.scrollTop + (rect.top - wrapRect.top) - wrap.clientHeight / 2 + rect.height / 2;
    wrap.scrollTo({ top: Math.max(0, target), behavior: 'auto' });
  }, []);

  const setActiveMatch = useCallback((i: number) => {
    const ranges = findRangesRef.current;
    if (!ranges.length) return;
    const idx = ((i % ranges.length) + ranges.length) % ranges.length;
    setFindIdx(idx);
    paintFindHighlights(ranges, ranges[idx]);
    scrollRangeIntoView(ranges[idx]);
  }, [scrollRangeIntoView]);

  const runFind = useCallback((query: string) => {
    const cont = containerRef.current;
    if (!cont || !query.trim()) {
      findRangesRef.current = [];
      clearFindHighlights();
      setFindCount(0);
      setFindIdx(0);
      return;
    }
    const ranges = buildFindMatches(cont, query);
    findRangesRef.current = ranges;
    setFindCount(ranges.length);
    if (ranges.length) {
      paintFindHighlights(ranges, ranges[0]);
      setFindIdx(0);
      scrollRangeIntoView(ranges[0]);
    } else {
      clearFindHighlights();
      setFindIdx(0);
    }
  }, [scrollRangeIntoView]);

  // Debounce find as the query changes while the bar is open.
  useEffect(() => {
    if (!findOpen) return;
    const t = window.setTimeout(() => runFind(findQuery), 120);
    return () => window.clearTimeout(t);
  }, [findQuery, findOpen, runFind]);

  // Clear highlights when the find bar closes.
  useEffect(() => {
    if (!findOpen) clearFindHighlights();
  }, [findOpen]);

  const closeFind = useCallback(() => { setFindOpen(false); }, []);

  // ── Auto-scroll handlers ────────────────────────────────────────────────
  const stopAutoRaf = useCallback(() => {
    if (autoRafRef.current) { cancelAnimationFrame(autoRafRef.current); autoRafRef.current = 0; }
  }, []);
  const stopAuto = useCallback(() => { stopAutoRaf(); setAutoScroll(false); setAutoPaused(false); }, [stopAutoRaf]);

  const autoStep = useCallback((now: number) => {
    const wrap = scrollWrapRef.current;
    if (!wrap) { stopAuto(); return; }
    // If the user scrolled manually, resync to their position.
    if (Math.abs(wrap.scrollTop - autoLastSetRef.current) > 3) autoAccRef.current = wrap.scrollTop;
    const dt = now - autoLastRef.current;
    autoLastRef.current = now;
    const pxPerWord = wrap.scrollHeight / (docWordsRef.current || 1);
    autoAccRef.current += (wpmRef.current / 60000) * pxPerWord * dt;
    wrap.scrollTop = autoAccRef.current;
    autoLastSetRef.current = wrap.scrollTop;
    if (wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 1) { stopAuto(); return; }
    autoRafRef.current = requestAnimationFrame(autoStep);
  }, [stopAuto]);

  const startAuto = useCallback(() => {
    const wrap = scrollWrapRef.current;
    if (!wrap || !docWordsRef.current) return;
    stopAutoRaf();
    autoAccRef.current = wrap.scrollTop;
    autoLastSetRef.current = wrap.scrollTop;
    autoLastRef.current = performance.now();
    setAutoScroll(true);
    setAutoPaused(false);
    autoRafRef.current = requestAnimationFrame(autoStep);
  }, [autoStep, stopAutoRaf]);

  const pauseAuto = useCallback(() => { stopAutoRaf(); setAutoPaused(true); }, [stopAutoRaf]);
  const resumeAuto = useCallback(() => {
    autoLastRef.current = performance.now();
    setAutoPaused(false);
    autoRafRef.current = requestAnimationFrame(autoStep);
  }, [autoStep]);

  // Stop auto-scroll when the viewer unmounts.
  useEffect(() => () => stopAutoRaf(), [stopAutoRaf]);

  // Track the selected word count while the reading popover is open.
  useEffect(() => {
    if (!readOpen) return;
    let t = 0;
    const update = () => {
      const sel = window.getSelection();
      const cont = containerRef.current;
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !cont) { setSelWords(0); return; }
      const r = sel.getRangeAt(0);
      if (!cont.contains(r.commonAncestorContainer)) { setSelWords(0); return; }
      // Count only the spoken words within the selection (same rule as the doc total).
      setSelWords(collectSpoken(r.commonAncestorContainer, { range: r }).count);
    };
    const onChange = () => { window.clearTimeout(t); t = window.setTimeout(update, 150); };
    update();
    document.addEventListener('selectionchange', onChange);
    return () => { window.clearTimeout(t); document.removeEventListener('selectionchange', onChange); };
  }, [readOpen]);

  const commitWpm = useCallback((v: number) => {
    const clamped = Math.max(50, Math.min(700, Math.round(v)));
    setWpm(clamped);
    saveWpm(clamped);
  }, []);

  // Cmd/Ctrl+F opens the find bar; Esc closes it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F') && step === 'viewing') {
        e.preventDefault();
        setFindOpen(true);
        window.setTimeout(() => findInputRef.current?.focus(), 0);
      } else if (e.key === 'Escape' && findOpen) {
        setFindOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, findOpen]);

  // ── Credibility ─────────────────────────────────────────────────────────
  // When the panel opens, load any cached scores for the current cards.
  // Cards are already extracted at doc-load time (in loadFile), so we just
  // compute the hash and check the cache.
  useEffect(() => {
    if (!credOpen || step !== 'viewing') return;
    setCredError('');
    const hash = hashCards(credCards);
    credHashRef.current = hash;
    setCredScores(credCards.length ? loadCred(filePath, hash) : null);
  }, [credOpen, step, filePath, credCards]);

  const runScoreCards = useCallback(async () => {
    if (credCards.length === 0) return;
    setCredLoading(true);
    setCredError('');
    try {
      const res = await window.warroom.ai.scoreCards({
        cards: credCards.map(c => ({ tag: c.tag, cite: c.cite })),
      });
      if (!res.ok || !res.scores) throw new Error(res.error ?? 'Failed to score cards');
      setCredScores(res.scores);
      saveCred(filePath, credHashRef.current, res.scores);
    } catch (e: any) {
      setCredError(e?.message ?? 'Failed to score cards');
    } finally {
      setCredLoading(false);
    }
  }, [credCards, filePath]);

  const scrollToCard = useCallback((id: string) => {
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-cred-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'auto', block: 'start' });
    const prevBg = el.style.backgroundColor;
    const prevTrans = el.style.transition;
    el.style.transition = 'background-color 0.25s ease';
    el.style.backgroundColor = 'rgba(66, 133, 244, 0.22)';
    window.setTimeout(() => {
      el.style.backgroundColor = prevBg;
      window.setTimeout(() => { el.style.transition = prevTrans; }, 300);
    }, 650);
  }, []);

  // Smooth-scroll the document to a heading and flash it briefly.
  const scrollToHeading = useCallback((id: string) => {
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-outline-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'auto', block: 'start' });
    setActiveHeadingId(id);
    const prevBg = el.style.backgroundColor;
    const prevTrans = el.style.transition;
    el.style.transition = 'background-color 0.25s ease';
    el.style.backgroundColor = 'rgba(66, 133, 244, 0.22)';
    window.setTimeout(() => {
      el.style.backgroundColor = prevBg;
      window.setTimeout(() => { el.style.transition = prevTrans; }, 300);
    }, 650);
  }, []);

  // Step to the previous/next heading relative to the one currently in view.
  function goToHeading(dir: 1 | -1) {
    if (outline.length === 0) return;
    const i = outline.findIndex(o => o.id === activeHeadingId);
    const next = i < 0
      ? (dir === 1 ? 0 : outline.length - 1)
      : Math.min(outline.length - 1, Math.max(0, i + dir));
    scrollToHeading(outline[next].id);
  }

  // Track which heading is currently at the top of the viewport as the user scrolls.
  useEffect(() => {
    const wrap = scrollWrapRef.current;
    if (!wrap || outline.length === 0) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const cont = containerRef.current;
      if (!cont) return;
      const threshold = wrap.getBoundingClientRect().top + 90;
      const heads = cont.querySelectorAll<HTMLElement>('[data-outline-id]');
      let current: string | null = heads.length ? heads[0].dataset.outlineId! : null;
      heads.forEach((h) => {
        if (h.getBoundingClientRect().top <= threshold) current = h.dataset.outlineId!;
      });
      setActiveHeadingId((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    wrap.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => { wrap.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [outline.length]);

  const scrollToCite = useCallback((cite: string) => {
    if (!containerRef.current) return;
    // Query block-level elements so textContent combines split spans (DOCX renders
    // cites across multiple child nodes, which breaks a raw text-node walk).
    const blocks = Array.from(
      containerRef.current.querySelectorAll<HTMLElement>('p, td, li, h1, h2, h3, h4, h5, h6')
    );
    const textOf = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').toLowerCase();
    const reveal = (el: HTMLElement) => el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const raw = cite.trim();
    const lower = raw.toLowerCase();

    // 1) Exact substring (handles cites that appear verbatim).
    for (const el of blocks) {
      if (textOf(el).includes(lower)) { reveal(el); return; }
    }

    // 2) Author surname(s) + year. The AI emits "Brady 25" / "Lee and Poling 23"
    //    but the doc often reads "Brady 2025" or "Brady, J. (2025)". Match the last
    //    author word together with the year in either 2- or 4-digit form.
    const yearMatch = raw.match(/\b((?:19|20)?\d{2})\b/);
    const authors = raw
      .replace(/\b((?:19|20)?\d{2})\b/g, ' ')
      .split(/[\s,]+/)
      .filter(w => w.length > 1 && !['and', 'et', 'al', 'the'].includes(w.toLowerCase()));
    if (authors.length && yearMatch) {
      const yy = yearMatch[1].slice(-2);
      const yearForms = [yy, `20${yy}`, `19${yy}`];
      for (const el of blocks) {
        const t = textOf(el);
        const hasAuthor = authors.some(a => t.includes(a.toLowerCase()));
        const hasYear = yearForms.some(y => t.includes(y));
        if (hasAuthor && hasYear) { reveal(el); return; }
      }
      // 3) Last resort: any author surname alone (first occurrence).
      for (const el of blocks) {
        if (authors.some(a => textOf(el).includes(a.toLowerCase()))) { reveal(el); return; }
      }
    }
  }, []);

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

      // Reset find / auto-scroll / credibility state tied to the previous document.
      stopAuto();
      setFindOpen(false);
      setFindQuery('');
      findRangesRef.current = [];
      clearFindHighlights();
      setCredScores(null);
      setCredCards([]);
      setCredError('');

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

        // Build the heading outline and extract cards; compute highlight-outlier
        // warnings (over/under-highlighted cards) and cross-reference them back
        // into the outline items so the outline can show warning badges.
        const built = buildOutline(containerRef.current);
        const builtCards = buildCards(containerRef.current);
        computeHighlightWarnings(containerRef.current, builtCards);

        // Annotate outline items: card tag elements carry both data-outline-id
        // and data-cred-id, so we can map warnings across.
        const warnForOutline = new Map<string, 'over' | 'under'>();
        for (const card of builtCards) {
          if (!card.warn) continue;
          const el = containerRef.current.querySelector<HTMLElement>(`[data-cred-id="${card.id}"]`);
          const outlineId = el?.dataset.outlineId;
          if (outlineId) warnForOutline.set(outlineId, card.warn);
        }
        const annotatedOutline = built.map(item => ({
          ...item,
          warn: warnForOutline.get(item.id),
        }));

        setOutline(annotatedOutline);
        setActiveHeadingId(built[0]?.id ?? null);
        setCredCards(builtCards);

        // Auto-show the outline only on the FIRST document opened per app session.
        // After that, leave it in whatever state the user last set.
        if (!outlineAutoShownThisSession) {
          setOutlineOpen(built.length > 0);
          outlineAutoShownThisSession = true;
        }

        // Reading-time word count for the freshly loaded doc — only words that
        // are actually read aloud (headings, tags, highlighted/underlined text,
        // and the bold author+date of cites), not every word in the file.
        const words = collectSpoken(containerRef.current).count;
        setDocWords(words);
        docWordsRef.current = words;
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
    setOutline([]);
    setActiveHeadingId(null);
    stopAuto();
    setFindOpen(false);
    setFindQuery('');
    findRangesRef.current = [];
    clearFindHighlights();
    setDocWords(0);
    setCredScores(null);
    setCredCards([]);
    setCredError('');
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
      <div className="border-b border-line px-3 py-1.5 flex items-center gap-2 shrink-0">
        {/* Document tools — grouped into a segmented cluster so the compact icon
            buttons read as one intentional control, not stray unlabeled buttons. */}
        <div
          className="flex items-center gap-0.5 p-0.5 rounded-xl"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
        >
          <FocusBtn
            active={focusActive}
            type={focusType}
            onToggle={() => setFocusActive(v => !v)}
            onTypeChange={t => { setFocusType(t); setFocusActive(true); }}
          />
          <div style={{ width: 1, height: 18, background: 'var(--border-subtle)', margin: '0 2px' }} />
          <OutlineToggleBtn active={outlineOpen} count={outline.length} onClick={() => setOutlineOpen(v => !v)} />
          <ToolbarToggle
            active={findOpen}
            label="Find in document (⌘F)"
            icon={<IcoSearch active={findOpen} />}
            onClick={() => {
              setFindOpen(v => !v);
              window.setTimeout(() => findInputRef.current?.focus(), 0);
            }}
          />
          <ToolbarToggle
            active={readOpen}
            label="Reading time & auto-scroll"
            icon={<IcoClock active={readOpen} />}
            onClick={() => setReadOpen(v => { const next = !v; if (next) setFlowSendOpen(false); return next; })}
          />
          <ToolbarToggle
            active={flowSendOpen}
            label="Send selection to a flow"
            icon={<IcoSendFlow active={flowSendOpen} />}
            onClick={() => setFlowSendOpen(v => { const next = !v; if (next) setReadOpen(false); return next; })}
          />
        </div>

        <div className="flex-1" />

        {/* AI analysis tools — labeled so their purpose is obvious. */}
        <ToolbarPill
          active={credOpen}
          label="Credibility"
          title="Score card credibility"
          icon={<IcoShield active={credOpen} />}
          onClick={() => setCredOpen(v => { const next = !v; if (next) setCxOpen(false); return next; })}
        />
        <ToolbarPill
          active={cxOpen}
          label="Cross-Ex"
          title="Practice cross-examination on this doc"
          icon={<IcoCrossEx active={cxOpen} />}
          onClick={() => setCxOpen(v => { const next = !v; if (next) setCredOpen(false); return next; })}
        />

        <div style={{ width: 1, height: 20, background: 'var(--border-subtle)', margin: '0 2px' }} />

        <IconBtn
          icon={<IcoShare />}
          label="Share / Open"
          onClick={() => setShareOpen(true)}
          tooltipAlign="right"
        />
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

      {/* Find bar (top-right overlay) */}
      {findOpen && step === 'viewing' && (
        <div
          className="absolute z-40 flex items-center gap-1 rounded-lg px-2 py-1.5"
          style={{ top: 48, right: 16, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}
        >
          <span style={{ color: 'var(--nav-inactive-color)' }}><IcoSearch /></span>
          <input
            ref={findInputRef}
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); setActiveMatch(findIdx + (e.shiftKey ? -1 : 1)); }
              else if (e.key === 'Escape') { e.preventDefault(); setFindOpen(false); }
            }}
            placeholder="Find in document…"
            className="text-[12.5px] bg-transparent outline-none"
            style={{ color: 'rgb(var(--ink-rgb))', width: 200 }}
          />
          <span className="text-[11px] tabular-nums shrink-0 px-1" style={{ color: 'var(--nav-inactive-color)', minWidth: 46, textAlign: 'right' }}>
            {findQuery.trim() ? (findCount > 0 ? `${findIdx + 1}/${findCount}` : '0/0') : ''}
          </span>
          <IconBtn icon={<IcoChevUp />} label="Previous (⇧⏎)" onClick={() => setActiveMatch(findIdx - 1)} />
          <IconBtn icon={<IcoChevDown />} label="Next (⏎)" onClick={() => setActiveMatch(findIdx + 1)} />
          <IconBtn icon={<IcoClose />} label="Close (Esc)" onClick={() => setFindOpen(false)} tooltipAlign="right" />
        </div>
      )}

      {/* Reading time / auto-scroll popover (top-right) */}
      {readOpen && step === 'viewing' && (() => {
        const activeWords = selWords > 0 ? selWords : docWords;
        const estSec = wpm > 0 ? (activeWords / wpm) * 60 : 0;
        return (
          <div
            className="absolute z-40 rounded-xl p-3 w-[270px]"
            style={{ top: findOpen ? 98 : 48, right: 16, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}
          >
            <div className="flex items-center gap-2 mb-2.5">
              <span style={{ color: 'rgb(var(--ink-rgb))' }}><IcoClock active /></span>
              <span className="text-[12.5px] font-semibold flex-1" style={{ color: 'rgb(var(--ink-rgb))' }}>Reading time</span>
              <IconBtn icon={<IcoClose />} label="Close" onClick={() => setReadOpen(false)} tooltipAlign="right" />
            </div>

            <div className="rounded-lg p-2.5 mb-2.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
              <div className="flex items-baseline justify-between">
                <span className="text-[11px]" style={{ color: 'var(--nav-inactive-color)' }}>
                  {selWords > 0 ? 'Selected text' : 'Whole document'}
                </span>
                <span className="text-[11px] tabular-nums" style={{ color: 'var(--nav-inactive-color)' }}>
                  {activeWords.toLocaleString()} words
                </span>
              </div>
              <div className="text-[22px] font-semibold tabular-nums mt-0.5" style={{ color: 'rgb(var(--ink-rgb))' }}>
                {activeWords > 0 ? fmtDuration(estSec) : '—'}
              </div>
              <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--nav-inactive-color)' }}>at {wpm} wpm</div>
            </div>

            <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--nav-inactive-color)' }}>Your reading speed (wpm)</label>
            <div className="flex items-center gap-2 mb-1.5">
              <input
                type="range" min={50} max={500} step={5} value={Math.min(500, wpm)}
                onChange={(e) => commitWpm(parseInt(e.target.value, 10))}
                className="flex-1" style={{ accentColor: 'var(--nav-active-color, #4285F4)' }}
              />
              <input
                type="number" min={50} max={700} value={wpm}
                onChange={(e) => commitWpm(parseInt(e.target.value || '0', 10))}
                className="text-[12px] tabular-nums rounded-md px-1.5 py-1 w-[58px] outline-none"
                style={{ background: 'var(--bg-input)', color: 'rgb(var(--ink-rgb))', border: '1px solid var(--border-med)' }}
              />
            </div>
            <div className="flex gap-1.5 mb-2.5">
              <button
                onClick={() => commitWpm(175)}
                className="flex-1 text-[10.5px] rounded-md py-1 transition"
                style={{ background: 'transparent', color: 'var(--nav-inactive-color)', border: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                title="Lay / traditional round pace"
              >Lay ~175</button>
              <button
                onClick={() => commitWpm(300)}
                className="flex-1 text-[10.5px] rounded-md py-1 transition"
                style={{ background: 'transparent', color: 'var(--nav-inactive-color)', border: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                title="Flow round spreading pace"
              >Flow ~300</button>
            </div>
            <div className="text-[10px] leading-relaxed mb-2.5" style={{ color: 'var(--nav-inactive-color)' }}>
              Lay / traditional rounds average ~150–200 wpm. Flow rounds (spreading) average ~300–400+ wpm.
            </div>

            <button
              onClick={() => (autoScroll ? stopAuto() : startAuto())}
              disabled={docWords === 0}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-semibold transition"
              style={{ background: 'var(--item-selected-bg)', color: 'var(--item-selected-text)', border: '1px solid var(--border-subtle)', cursor: docWords === 0 ? 'default' : 'pointer', opacity: docWords === 0 ? 0.5 : 1 }}
            >
              {autoScroll ? <IcoPause /> : <IcoPlay />}
              {autoScroll ? 'Stop auto-scroll' : 'Auto-scroll at this pace'}
            </button>
          </div>
        );
      })()}

      {/* Send to Flow popover (top-right) */}
      {flowSendOpen && step === 'viewing' && (
        <SendToFlowPopover
          container={containerRef.current}
          flows={flowsIndex}
          activeHeadingId={activeHeadingId}
          anchorTop={findOpen ? 98 : 48}
          onClose={() => setFlowSendOpen(false)}
        />
      )}

      {/* Auto-scroll floating control */}
      {autoScroll && step === 'viewing' && (
        <div
          className="absolute z-40 flex items-center gap-2.5 rounded-full px-3 py-2"
          style={{ bottom: 18, left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}
        >
          <button
            onClick={() => (autoPaused ? resumeAuto() : pauseAuto())}
            className="flex items-center justify-center w-7 h-7 rounded-full transition"
            style={{ background: 'var(--nav-active-bg)', color: 'rgb(var(--ink-rgb))', border: 'none', cursor: 'pointer' }}
            title={autoPaused ? 'Resume' : 'Pause'}
          >
            {autoPaused ? <IcoPlay /> : <IcoPause />}
          </button>
          <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'rgb(var(--ink-rgb))' }}>{wpm} wpm</span>
          <input
            type="range" min={50} max={500} step={5} value={Math.min(500, wpm)}
            onChange={(e) => commitWpm(parseInt(e.target.value, 10))}
            style={{ width: 120, accentColor: 'var(--nav-active-color, #4285F4)' }}
          />
          <button
            onClick={stopAuto}
            className="flex items-center justify-center w-7 h-7 rounded-full transition"
            style={{ background: 'transparent', color: 'var(--nav-inactive-color)', border: '1px solid var(--border-subtle)', cursor: 'pointer' }}
            title="Stop"
          >
            <IcoClose />
          </button>
        </div>
      )}

      {/* Outline + document + cross-ex side panel */}
      <div className="flex-1 flex min-h-0">
        {outlineOpen && step === 'viewing' && (
          <OutlinePanel
            items={outline}
            activeId={activeHeadingId}
            onPick={scrollToHeading}
            onClose={() => setOutlineOpen(false)}
            onStep={goToHeading}
            dismissed={dismissedWarnings}
            onDismiss={dismissWarning}
          />
        )}
        <div ref={scrollWrapRef} className="flex-1 overflow-y-auto scroll-thin docx-viewer-wrap min-w-0">
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
            onClose={() => setCxOpen(false)}
            onScrollToCite={scrollToCite}
          />
        )}
        {credOpen && step === 'viewing' && (
          <CredibilityPanel
            cards={credCards}
            scores={credScores}
            loading={credLoading}
            error={credError}
            onScore={runScoreCards}
            onScrollToCard={scrollToCard}
            onClose={() => setCredOpen(false)}
            dismissed={dismissedWarnings}
            onDismiss={dismissWarning}
          />
        )}
      </div>
    </div>
  );
}
