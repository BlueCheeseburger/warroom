import React, { useState, useRef, useEffect, useCallback } from 'react';
import { renderAsync } from 'docx-preview';
import { LoadingPanel, LoadingState, Spinner } from './Spinner';
import { useApp } from '../store/appStore';
import type { DebateEvent, FlowMeta } from '../store/appStore';
import SharePanel from './SharePanel';
import { POLICY_COLS, PF_PRO_FIRST_COLS, PF_CON_FIRST_COLS, NUM_ROWS } from './FlowView';
import {
  parseRgb, isBrightHighlight, applyDarkModeViewerFixes, removeDarkModeViewerFixes,
  tagHighlightElements, applyHighlightReadability, resetHighlightReadability,
  loadHighlightReadability, HIGHLIGHT_READABILITY_CHANGED,
} from '../utils/docxViewerUtils';
import HighlightReadabilityMenu, { HighlightReadabilitySlider } from './HighlightReadabilityMenu';
import { matchesShortcut } from '../lib/shortcutPrefs';
import { useCaseFolders, createFolder, moveItem, itemKeyForDoc } from '../utils/caseFolders';
import { comboKeyFor, loadComboLayout, saveComboLayout, rememberComboView } from '../utils/docComboLayout';
import TaggedInIndicator from './TaggedInIndicator';
import MentionPicker from './MentionPicker';
import type { PendingMention } from '../types';
import { useDragActive } from '../hooks/useDragActive';

type Step = 'idle' | 'loading' | 'viewing' | 'error';

const RECENTS_KEY = 'warroom-speech-doc-recents';

// Shared with the injected #wr-docx-fonts CSS block AND forceHeadingFont below —
// keep both in sync with this one definition rather than duplicating the string.
const DOC_FONT_STACK = "'Calibri', 'Carlito', 'Helvetica Neue', 'Arial', sans-serif";

interface RecentDoc { path: string; name: string; cardCount?: number; addedAt?: string }

function getRecents(): RecentDoc[] {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]'); } catch { return []; }
}
// Recents double as the sidebar's Cases list, so the cap is a real library limit,
// not just a "recently opened" convenience — keep it roomy enough that a bulk
// import of many docs doesn't silently evict earlier ones.
const RECENTS_MAX = 40;

function addRecent(path: string, name: string) {
  addRecents([{ path, name }]);
}
/**
 * Add docs to recents that aren't already there (newest-added first, stamped
 * with `addedAt`). Docs already present are left completely untouched — this
 * is called on every doc open, not just first import, so re-opening a doc must
 * never reorder or re-date it (that was the "recents == last opened" bug: the
 * list order and the folder/grid "date added" order are the same underlying
 * list, so bumping it on every open silently reshuffled the library on every
 * click).
 */
function addRecents(docs: { path: string; name: string }[]) {
  if (docs.length === 0) return;
  const existing = getRecents();
  const known = new Set(existing.map(r => r.path));
  const fresh = docs.filter(d => !known.has(d.path));
  if (fresh.length === 0) return;
  const addedAt = new Date().toISOString();
  const next = [...fresh.map(d => ({ ...d, addedAt })), ...existing].slice(0, RECENTS_MAX);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  window.dispatchEvent(new StorageEvent('storage', { key: RECENTS_KEY, newValue: JSON.stringify(next) }));
}
// ── Per-doc scroll position ─────────────────────────────────────────────────
// Reopening a doc drops you back where you left off, instead of at the top.
const SCROLL_KEY_PREFIX = 'warroom-speech-doc-scroll-';
function getSavedScroll(key: string): number | null {
  const v = parseInt(localStorage.getItem(SCROLL_KEY_PREFIX + key) ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : null;
}
function saveScroll(key: string, top: number) {
  try { localStorage.setItem(SCROLL_KEY_PREFIX + key, String(Math.round(top))); } catch { /* ignore */ }
}

function updateRecentCardCount(path: string, count: number) {
  const next = getRecents().map(r => r.path === path ? { ...r, cardCount: count } : r);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  window.dispatchEvent(new StorageEvent('storage', { key: RECENTS_KEY, newValue: JSON.stringify(next) }));
}

// Renaming only ever changes the display name in Warroom's own records (the
// recents/sidebar entry), never the file on disk — that's a filesystem
// operation the user didn't ask for and shouldn't happen silently.
function renameRecent(path: string, name: string) {
  const next = getRecents().map(r => r.path === path ? { ...r, name } : r);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  window.dispatchEvent(new StorageEvent('storage', { key: RECENTS_KEY, newValue: JSON.stringify(next) }));
}

// ── OpenCaseList-imported case docx cache ──────────────────────────────────
// Imported cases store their docx bytes (base64) in localStorage keyed by URL so
// reopening the case renders instantly without re-downloading from OpenCaseList.
// Capped per-doc to stay well within the localStorage quota; oversized docs just
// re-fetch each open (still correct, just not cached).
const OC_CACHE_PREFIX = 'warroom-oc-docx-';
const OC_CACHE_MAX = 2_500_000; // ~2.5MB of base64 per doc
function getOcCached(url: string): string | null {
  try { return localStorage.getItem(OC_CACHE_PREFIX + url); } catch { return null; }
}
function setOcCached(url: string, base64: string) {
  if (!url || base64.length > OC_CACHE_MAX) return;
  try { localStorage.setItem(OC_CACHE_PREFIX + url, base64); } catch { /* quota — skip caching */ }
}

// ── Icon buttons with tooltip ──────────────────────────────────────────────

function IconBtn({ icon, label, onClick, danger, active, tooltipAlign = 'center' }: {
  icon: React.ReactNode; label: string; onClick: () => void;
  danger?: boolean; active?: boolean; tooltipAlign?: 'left' | 'center' | 'right';
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
        className="flex items-center justify-center w-7 h-7 rounded-lg transition"
        style={{
          background: active ? 'var(--nav-active-bg)' : 'transparent',
          boxShadow: active ? 'var(--nav-active-shadow)' : 'none',
          border: 'none', cursor: 'pointer',
          color: danger ? 'rgb(var(--danger-rgb))' : active ? 'rgb(var(--ink-rgb))' : 'var(--nav-inactive-color)',
        }}
        onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
        onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
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

// Reveal-in-folder: an open folder with an arrow, for "show this file in Finder".
function IcoReveal() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 4.5a1 1 0 0 1 1-1h3l1.2 1.4h5.6a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V4.5Z"/>
      <path d="M8 6.5v3.2M8 9.7l-1.3-1.3M8 9.7l1.3-1.3"/>
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

// Add a compare pane: two side-by-side panes with a plus badge.
function IcoAddPane() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="3" width="15" height="12" rx="1.6"/>
      <path d="M9 3v12"/>
      <circle cx="13.5" cy="13.5" r="4" fill="var(--bg-elevated, #1c1c1e)" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M13.5 11.7v3.6M11.7 13.5h3.6" strokeWidth="1.3"/>
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

// A single speech bubble with a "+" — adding/viewing a comment thread.
function IcoComment({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={active ? 1.9 : 1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4.5A1.5 1.5 0 0 1 4 3h10a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 14 12H7l-3 2.7V12H4a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M9 6.3v3.4M7.3 8h3.4" opacity={active ? 1 : 0.75} />
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

/**
 * Is this element a genuine Word highlight? Checks `data-hl-kind` (stamped
 * by `tagHighlightElements` from the doc's pristine, freshly-rendered color,
 * before any color pass touches it) first — falling back to the raw
 * brightness heuristic only for elements that were never tagged (e.g. some
 * other, non-highlight bright background). This must NOT re-derive the
 * answer from the element's *current* computed background: once the
 * highlight-readability slider or dark-mode dimming has recolored it, a
 * muted/dimmed color can legitimately fail a brightness check even though
 * it's still very much a highlight — which used to make focus mode hide
 * highlighted text entirely, and undercount it for reading-time/auto-scroll.
 */
function isSpanHighlighted(el: HTMLElement): boolean {
  if (el.dataset.hlKind) return true;
  const rgb = parseRgb(window.getComputedStyle(el).backgroundColor);
  return !!(rgb && isBrightHighlight(rgb));
}

type FocusType = 'highlight' | 'highlight+underline';

function applyFocusMode(container: HTMLElement, mode: FocusType, headingClasses?: HeadingClasses) {
  const paras = Array.from(container.querySelectorAll<HTMLElement>('p'));
  // Compute the deepest heading level (= tag level in Verbatim) so we can
  // identify cite paragraphs (the one right after a tag heading). Cite paragraphs
  // must always show their leading-bold author+date span even in focus mode.
  const hlvl = (el: HTMLElement) => headingLevelOf(el, headingClasses);
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

    // Hat / tag paragraphs: every span is bold and none are highlighted. These
    // are always shown in full regardless of mode.
    const allBold = spans.every(s => parseInt(window.getComputedStyle(s).fontWeight) >= 600);
    const anyHighlight = spans.some(isSpanHighlighted);
    if (allBold && !anyHighlight) return;

    // Cite paragraphs are structural metadata (author, quals, date, publication),
    // not evidence subject to underline/highlight cutting — always shown in full,
    // regardless of bold pattern. This used to only keep the LEADING bold run
    // (the assumed author+date), hiding everything after the first non-bold span —
    // but plenty of cites don't bold the author at all, so that span never existed
    // and the entire cite silently vanished. A highlighted cite is the one
    // exception: if a debater deliberately highlighted part of it, normal
    // highlight/underline rules should govern, same as any other paragraph.
    if (isCite && !anyHighlight) return;

    // Body paragraph — hide spans that don't meet the mode criteria
    spans.forEach(span => {
      const cs  = window.getComputedStyle(span);
      const highlighted = isSpanHighlighted(span);
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

// ── Document outline (heading navigation) ──────────────────────────────────
// docx-preview renders every paragraph as <p> and tags it with a class derived
// from the paragraph's style id: `docx-render_<styleid-lowercased>`. Verbatim
// (and Word's built-in styles) use style ids Heading1…Heading9, so heading
// paragraphs carry classes like `docx-render_heading1`. We detect those, stamp
// each with a stable data-outline-id, and build a clickable outline from them.
interface OutlineItem { id: string; level: number; text: string; warn?: 'over' | 'under' }

// Heading-style map: docx-preview class suffix (escaped, lowercased style id) →
// 1-based heading level. Resolved in the main process from styles.xml so we can
// detect headings whose style ids aren't literally Heading1–9 (Google Docs
// exports, custom Verbatim templates, etc.). Consumed by headingLevelOf below.
type HeadingClasses = Map<string, number>;

function buildOutline(container: HTMLElement, headingClasses?: HeadingClasses): OutlineItem[] {
  const items: OutlineItem[] = [];
  let counter = 0;
  container.querySelectorAll<HTMLElement>('p').forEach((p) => {
    const level = headingLevelOf(p, headingClasses);
    if (!level) return;
    const text = (p.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return; // skip empty heading paragraphs
    const id = `wr-h-${counter++}`;
    p.dataset.outlineId = id;
    items.push({ id, level, text });
  });
  return items;
}

// Fallback outline for docs with NO Word/Verbatim heading styles — hand-made
// round reports and Google Docs exports that format their section headers
// manually instead of with heading styles. We detect structural headers by their
// rendered formatting: short paragraphs that are either BOXED (a paragraph border
// — pockets/speech dividers) or BOLD + CENTERED (hats/blocks). Left-aligned bold
// taglines above cards are deliberately NOT matched here — they're hard to tell
// apart from bolded body lead-ins, and the goal is a usable navigation outline of
// the big sections, not card-level detection.
function buildOutlineHeuristic(container: HTMLElement): OutlineItem[] {
  const items: OutlineItem[] = [];
  let counter = 0;
  const paras = Array.from(container.querySelectorAll<HTMLElement>('p'));
  for (const p of paras) {
    const text = (p.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (text.split(/\s+/).length > 25) continue; // section headers are short

    const cs = window.getComputedStyle(p);
    const boxed =
      (cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth || '0') > 0) ||
      (cs.borderBottomStyle !== 'none' && parseFloat(cs.borderBottomWidth || '0') > 0) ||
      (cs.borderLeftStyle !== 'none' && parseFloat(cs.borderLeftWidth || '0') > 0);
    const centered = cs.textAlign === 'center';

    // Is the paragraph predominantly bold? (Most of its visible text is bold.)
    let boldChars = 0, totalChars = 0;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const t = (node.nodeValue || '').trim();
      if (!t) continue;
      totalChars += t.length;
      const parent = node.parentElement;
      if (parent && isBoldEl(parent)) boldChars += t.length;
    }
    const bold = totalChars > 0 && boldChars / totalChars >= 0.6;

    if (!(boxed || (bold && centered))) continue;
    const id = `wr-h-${counter++}`;
    p.dataset.outlineId = id;
    items.push({ id, level: boxed ? 1 : 2, text });
  }
  return items;
}

/** A node in the tree built from the flat, document-order OutlineItem list. */
interface OutlineNode { item: OutlineItem; children: OutlineNode[] }

// Reconstructs parent/child structure from the flat heading list: each item's
// parent is the nearest PRECEDING item with a strictly smaller level, exactly
// how Word's own Navigation Pane infers nesting from heading levels alone (there
// is no explicit parent pointer in the source doc). Built from raw `level`, not
// the depth-collapsed rank below — a level skip (H1 straight to H4, common in
// debate docs) still nests correctly; the collapsed rank is a display-only
// concern for indentation and the depth-cycle cap, layered on afterward.
function buildOutlineTree(items: OutlineItem[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const item of items) {
    const node: OutlineNode = { item, children: [] };
    while (stack.length && stack[stack.length - 1].item.level >= item.level) stack.pop();
    (stack.length ? stack[stack.length - 1].children : roots).push(node);
    stack.push(node);
  }
  return roots;
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

  // Per-branch expand/collapse (Word Navigation Pane style) — independent of the
  // depth-cycle cap above: that one caps how many LEVELS show everywhere at once,
  // this one lets you fold one specific branch while leaving its siblings open.
  // Collapsed = a Set of item ids whose children are currently hidden.
  const tree = React.useMemo(() => buildOutlineTree(items), [items]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Starts fully expanded for each newly-loaded doc, matching the depth-cycle
  // reset just above (items.length changing is the same "new doc" heuristic it
  // already relies on).
  useEffect(() => { setCollapsed(new Set()); }, [items.length]);
  function toggleCollapsed(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const shownCount = React.useMemo(() => {
    let n = 0;
    const walk = (nodes: OutlineNode[]) => {
      for (const node of nodes) {
        if (depthOf(node.item.level) >= visibleDepths) continue;
        n++;
        if (!collapsed.has(node.item.id)) walk(node.children);
      }
    };
    walk(tree);
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, collapsed, visibleDepths, depths.length]);

  // depth = structural nesting (parent/child), used only to decide whether a
  // node's children are hidden by a collapsed ancestor. Indentation width and
  // the depth-cycle cap both use depthOf(item.level) instead — the level-RANK
  // depth — exactly as the old flat-list version did, so that feature's meaning
  // doesn't change; a level skip means structural depth and rank depth can differ.
  function renderNode(node: OutlineNode, depth: number, extraTopMargin = 0): React.ReactNode {
    const it = node.item;
    const rankDepth = depthOf(it.level);
    if (rankDepth >= visibleDepths) return null;
    const active = it.id === activeId;
    const topLevel = rankDepth === 0;
    // A chevron only promises something the depth-cycle cap won't immediately
    // hide again — children beyond the current cap don't count as "expandable".
    const visibleChildren = node.children.filter(c => depthOf(c.item.level) < visibleDepths);
    const hasChildren = visibleChildren.length > 0;
    const isCollapsed = collapsed.has(it.id);

    return (
      <React.Fragment key={it.id}>
        <div
          className="flex items-center rounded-md transition"
          style={{
            marginTop: extraTopMargin,
            background: active ? 'var(--nav-active-bg)' : 'transparent',
            borderLeft: active ? '2px solid var(--nav-active-color, #4285F4)' : '2px solid transparent',
          }}
          onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
          onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          {hasChildren ? (
            <span
              role="button" tabIndex={0}
              onClick={(e) => { e.stopPropagation(); toggleCollapsed(it.id); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); toggleCollapsed(it.id); } }}
              className="shrink-0 flex items-center justify-center rounded transition"
              style={{ width: 16, height: 16, marginLeft: 8 + rankDepth * 11 - 4 }}
              onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'}
              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              title={isCollapsed ? 'Expand' : 'Collapse'}
            >
              <svg width="7" height="7" viewBox="0 0 8 8" fill="none"
                className="transition-transform duration-150"
                style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', color: 'var(--nav-inactive-color)' }}>
                <path d="M2 1.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
          ) : (
            <span className="shrink-0" style={{ width: 16, marginLeft: 8 + rankDepth * 11 - 4 }} />
          )}
          <button
            ref={active ? activeRef : undefined}
            onClick={() => onPick(it.id)}
            className="flex-1 text-left text-[12px] leading-snug py-0.5 truncate min-w-0"
            style={{
              paddingLeft: 4,
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
        {hasChildren && !isCollapsed && visibleChildren.map(c => renderNode(c, depth + 1))}
      </React.Fragment>
    );
  }

  return (
    <div
      className="shrink-0 flex flex-col h-full"
      style={{ width: 'min(248px, 85vw)', maxWidth: '100%', borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-side)' }}
    >
      <div className="flex items-center gap-1 px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span style={{ color: 'rgb(var(--ink-rgb))' }}><IcoOutline active /></span>
        <span className="text-[12.5px] font-semibold shrink-0 ml-1" style={{ color: 'rgb(var(--ink-rgb))' }}>Outline</span>
        <span className="text-[11px] shrink-0 tabular-nums ml-1.5" style={{ color: 'var(--nav-inactive-color)' }}>{shownCount}</span>
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

      <div className="flex-1 overflow-y-auto scroll-thin py-1 px-1.5">
        {items.length === 0 ? (
          <div className="px-2 py-3 text-[12px] leading-relaxed" style={{ color: 'var(--nav-inactive-color)' }}>
            No headings found in this document. Outline navigation works with docs that use Word/Verbatim heading styles (pockets, hats, blocks, tags).
          </div>
        ) : (
          tree.map((root, i) => renderNode(root, 0, i > 0 ? 3 : 0))
        )}
      </div>
    </div>
  );
}

// Slim pull-tab on the left edge of a doc pane — replaces the old permanent
// sidebar-style outline button. Clicking it opens OutlinePanel as a real flex
// sibling (pushing the doc over, not covering it); the panel's own header ×
// closes it again. Only rendered while the outline is CLOSED, so this has no
// "open" state of its own — the panel is its own close affordance.
function OutlinePullTab({ count, onClick }: { count: number; onClick: () => void }) {
  const [tip, setTip] = useState(false);
  const label = count > 0 ? `Outline · ${count} headings` : 'Outline';
  return (
    <div
      className="absolute z-30 flex items-center justify-center transition"
      style={{
        left: 0, top: '50%', transform: 'translateY(-50%)',
        width: 14, height: 56, borderRadius: '0 8px 8px 0',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)', borderLeft: 'none',
        boxShadow: 'var(--shadow-elevated)', cursor: 'pointer',
      }}
      onClick={onClick}
      onMouseEnter={() => setTip(true)}
      onMouseLeave={() => setTip(false)}
      title={label}
    >
      <svg width="7" height="7" viewBox="0 0 8 8" fill="none" style={{ color: 'var(--nav-inactive-color)' }}>
        <path d="M2 1.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {tip && (
        <div className="absolute px-2 py-1 text-[11px] font-medium rounded-md whitespace-nowrap z-50 pointer-events-none select-none"
          style={{ left: 18, top: '50%', transform: 'translateY(-50%)', background: 'var(--bg-elevated)', color: 'rgb(var(--ink-rgb))', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}>
          {label}
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
        className="flex items-center justify-center w-7 h-7 rounded-lg transition"
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

// Single pill for OC-imported cases: shows "Imported from X" at rest,
// reveals "Check for changes" action on hover.
function OcSourcePill({ teamName, checking, checkResult, onCheck }: {
  teamName: string;
  checking: boolean;
  checkResult: 'changed' | 'up-to-date' | null;
  onCheck: () => void;
}) {
  const [hovered, setHovered] = React.useState(false);

  const showAction = (hovered || checkResult !== null) && !checking;
  const label = checking
    ? 'Checking…'
    : checkResult === 'changed' ? 'Updated — reloaded'
    : checkResult === 'up-to-date' ? 'Up to date'
    : `Imported from ${teamName}`;
  const actionLabel = 'Check for changes';
  const color = checkResult === 'changed' ? '#34c759' : 'var(--nav-inactive-color)';

  return (
    <button
      onClick={checking ? undefined : onCheck}
      disabled={checking}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={hovered && !checking ? 'Re-check OpenCaseList for changes to this file' : `Imported from ${teamName} on OpenCaseList`}
      className="text-[11px] shrink-0 px-1.5 py-0.5 rounded-md transition-all relative"
      style={{
        color,
        background: hovered && !checking ? 'var(--nav-hover-bg)' : 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
        cursor: checking ? 'default' : 'pointer',
        minWidth: 0,
      }}
    >
      {/* Invisible anchor keeps the button width fixed to "Imported from X" */}
      <span className="invisible whitespace-nowrap">{`Imported from ${teamName}`}</span>
      <span className="absolute inset-0 flex items-center justify-center whitespace-nowrap">
        {showAction && checkResult === null ? actionLabel : label}
      </span>
    </button>
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
      className="ai-glow-ring flex items-center gap-1.5 h-7 px-2.5 rounded-lg transition text-[12px] font-medium shrink-0"
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

// Three-dots overflow menu, opened on hover. Used in multi-pane compare view,
// where a full-width toolbar per pane doesn't fit: the reading-time, send-to-
// flow, credibility, and cross-ex controls fold in here instead. Inside the
// menu they get their labels back (there's room), so nothing becomes a
// mystery icon.
function ToolbarOverflowMenu({ items, extra }: {
  // `ai` marks a row that triggers an AI/API call — it gets a small gradient
  // dot instead of the full `.ai-glow-ring` treatment other AI buttons use.
  // The ring is built for an isolated round/pill button (it protrudes 2px
  // past its own edges via a negative inset); on rows stacked edge-to-edge
  // with zero gap, that protrusion bled into the row above/below and the
  // menu's own border, drawing what looked like a broken rectangle rather
  // than a glow. A dot carries the same blue→pink "this calls an AI" signal
  // without needing room around the element to render into.
  items: { label: string; hint?: string; icon: React.ReactNode; active: boolean; ai?: boolean; onClick: () => void }[];
  // Non-button content (the highlight-readability slider) appended below the
  // items, behind the same divider treatment the AI-tools group gets — folded
  // in here rather than its own separate "⋯" trigger, so a compact pane never
  // shows two overflow-menu buttons side by side.
  extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [tip, setTip] = useState(false);
  const closeTimer = useRef(0);
  // A small close delay keeps the menu usable while the pointer crosses the
  // gap between the button and the panel below it.
  const openNow = () => { window.clearTimeout(closeTimer.current); setOpen(true); setTip(false); };
  const closeSoon = () => { window.clearTimeout(closeTimer.current); closeTimer.current = window.setTimeout(() => setOpen(false), 160); };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const anyActive = items.some(i => i.active);
  // Blank line between the plain utilities and the AI tools — two visually
  // distinct groups (one causes an API call, one doesn't), same grouping this
  // menu replaced (a divider separated the tool cluster from the AI pills).
  const firstAiIdx = items.findIndex(i => i.ai);

  return (
    <div className="relative shrink-0" onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <button
        onClick={() => setOpen(v => !v)}
        onFocus={() => setTip(true)}
        onBlur={() => setTip(false)}
        className="flex items-center justify-center w-7 h-7 rounded-lg transition"
        style={{
          background: open || anyActive ? 'var(--nav-active-bg)' : 'transparent',
          boxShadow: anyActive ? 'var(--nav-active-shadow)' : 'none',
          border: 'none', cursor: 'pointer',
          color: open || anyActive ? 'rgb(var(--ink-rgb))' : 'var(--nav-inactive-color)',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="3" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>
      {/* Native `title` would show its own browser tooltip at the same time as
          the dropdown once open (they raced visibly), so this is a controlled
          tooltip that hides itself the moment the menu opens. */}
      {tip && !open && (
        <div className="absolute top-full mt-1.5 px-2 py-1 text-[11px] font-medium rounded-md whitespace-nowrap z-50 pointer-events-none select-none"
          style={{ right: 0, background: 'var(--bg-elevated)', color: 'rgb(var(--ink-rgb))', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}>
          More tools
        </div>
      )}
      {open && (
        <div
          className="absolute z-50 rounded-xl p-1"
          style={{
            top: 'calc(100% + 4px)', right: 0, minWidth: 190,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-elevated)',
          }}
        >
          {items.map((it, idx) => (
            <React.Fragment key={it.label}>
              {idx === firstAiIdx && idx > 0 && (
                <div style={{ height: 1, margin: '4px 6px', background: 'var(--border-subtle)' }} />
              )}
              <button
                onClick={() => { it.onClick(); setOpen(false); }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition text-left"
                style={{
                  background: it.active ? 'var(--nav-active-bg)' : 'transparent',
                  color: it.active ? 'rgb(var(--ink-rgb))' : 'var(--nav-inactive-color)',
                  border: 'none', cursor: 'pointer',
                }}
                onMouseEnter={e => { if (!it.active) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
                onMouseLeave={e => { if (!it.active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <span className="shrink-0 flex items-center justify-center w-5">{it.icon}</span>
                <span className="flex-1">{it.label}</span>
                {it.ai && (
                  <span
                    className="shrink-0 rounded-full"
                    style={{ width: 6, height: 6, background: 'linear-gradient(135deg, #3b82f6, #ec4899)' }}
                    title="Uses Warroom AI"
                  />
                )}
              </button>
            </React.Fragment>
          ))}
          {extra && (
            <>
              <div style={{ height: 1, margin: '4px 6px', background: 'var(--border-subtle)' }} />
              {extra}
            </>
          )}
        </div>
      )}
    </div>
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
          style={{ ...btnBase, width: '28px', height: '28px', color: active ? 'rgb(var(--ink-rgb))' : 'var(--nav-inactive-color)', background: active ? 'var(--nav-active-bg)' : 'transparent', boxShadow: active ? 'var(--nav-active-shadow)' : 'none' }}
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
        style={{ ...btnBase, width: '14px', height: '28px', color: 'var(--nav-inactive-color)' }}
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

// `press` — the one-line follow-up to run AFTER the opponent's answer. Kept
// separate from `answer` (which is the opponent's voice) so the UI can label it.
// Optional: questions saved before the split have it folded into `answer`.
interface CxQuestion { id: string; question: string; answer: string; press?: string; cardCite?: string }
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
      .map((g) => ({ side: (['Aff', 'Neg', 'General'].includes(g.side) ? g.side : 'General') as CxSide, questions: (g.questions as any[]).map((q: any) => ({ id: q.id ?? crypto.randomUUID(), question: q.question, answer: q.answer, press: q.press, cardCite: q.cardCite })) }));
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
        press: x.press,
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
          className="ai-glow-ring flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition"
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
          {/* The follow-up to run after their answer — labeled so it reads as your
              own next move, not part of the opponent's response. */}
          {q.press && (
            <div className="mt-2.5 rounded-lg px-2.5 py-2" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
              <div className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--nav-inactive-color)' }}>Press next</div>
              <CxText text={q.press} className="text-[12px] leading-relaxed block" style={{ color: 'rgb(var(--ink-rgb))' }} />
            </div>
          )}
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
      // Skip focus-mode-hidden text. The hidden marker sits on the span docx-preview
      // emitted, but the text node's direct parent can be a nested element inside it
      // (an <em>/<a>/etc.), so climb with closest() instead of checking only parent.
      if (el.closest('[data-focus-hidden]')) return NodeFilter.FILTER_REJECT;
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

// ── Doc comments ─────────────────────────────────────────────────────────────
// Team (or private) comments anchored to a highlighted span of doc text —
// Google-Docs style. `doc_comments` in supabase/schema.sql is the source of
// truth; a comment is anchored by (paragraph index, occurrence of its exact
// text within that paragraph) rather than any DOM id, since docx-preview
// assigns no stable per-paragraph identity across renders. Same CSS Custom
// Highlight API as in-doc find (paints without mutating the DOM), on its own
// registry name and a deliberately different color so a comment's highlight
// never reads as the document's own cyan/yellow/green evidence emphasis.
// Kill switch for the doc-comments feature's UI — every entry point (toolbar
// button, selection bubble, card-margin icon, panel, ⌘⌥M shortcut, and
// highlight painting) is gated on this. Backend, schema, IPC, state, and
// realtime sync are all still fully wired up and untouched — flipping this
// back to true is the entire re-enable.
const COMMENTS_UI_ENABLED = false;

const COMMENT_HL = 'wr-comment';

interface DocComment {
  id: string;
  team_id: string;
  doc_key: string;
  doc_name: string;
  user_id: string;
  user_name: string;
  visibility: 'team' | 'private';
  anchor_kind: 'text' | 'card';
  anchor_text: string;
  anchor_para_index: number;
  anchor_occurrence: number;
  body: string;
  parent_id: string | null;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by_name: string | null;
  created_at: string;
  updated_at: string;
}

// A comment being composed anchors either to a text selection ('text') or to
// a whole card ('card', from hovering its tag paragraph — see the margin
// comment-icon affordance). Both carry a live DOM reference plus the popover
// position and quote preview; only the anchor source differs.
type PendingCommentAnchor =
  | { kind: 'text'; range: Range; x: number; y: number; quote: string }
  | { kind: 'card'; tagEl: Element; x: number; y: number; quote: string };

/** Splits `body` on `@Name_With_Underscores` tokens that match a real team
 *  member, for rendering as a highlighted mention chip — same insertion
 *  convention Chat.tsx's composer already uses (`@${name.replace(/\s/g,'_')} `). */
function renderCommentBody(body: string, members: { display_name: string }[]): React.ReactNode[] {
  if (members.length === 0) return [body];
  const names = new Set(members.map((m) => m.display_name.replace(/\s/g, '_')));
  const parts = body.split(/(@\w+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@') && names.has(part.slice(1))) {
      return <span key={i} style={{ color: '#4285F4', fontWeight: 600 }}>{part.replace(/_/g, ' ')}</span>;
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

/** Index of the (0-based) `n`th occurrence of `needle` in `haystack`, or -1. */
function nthIndexOf(haystack: string, needle: string, n: number): number {
  if (!needle) return -1;
  let idx = -1;
  for (let i = 0; i <= n; i++) {
    idx = haystack.indexOf(needle, idx + 1);
    if (idx === -1) return -1;
  }
  return idx;
}

/** How many non-overlapping times `needle` occurs in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0, idx = -1;
  while ((idx = haystack.indexOf(needle, idx + 1)) !== -1) count++;
  return count;
}

/** Converts a flat character offset within `root`'s text content into a Range. */
function rangeFromTextOffset(root: Element, start: number, len: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let startNode: Text | null = null, startOffset = 0;
  let endNode: Text | null = null, endOffset = 0;
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const nodeLen = node.data.length;
    if (startNode === null && pos + nodeLen >= start) { startNode = node; startOffset = start - pos; }
    if (startNode !== null && pos + nodeLen >= start + len) { endNode = node; endOffset = start + len - pos; break; }
    pos += nodeLen;
  }
  if (!startNode || !endNode) return null;
  const r = document.createRange();
  r.setStart(startNode, startOffset);
  r.setEnd(endNode, endOffset);
  return r;
}

/** The flat character offset of (node, offset) within `paraEl`'s text content. */
function textOffsetWithinParagraph(paraEl: Element, node: Node, offset: number): number {
  const walker = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let n: Text | null;
  while ((n = walker.nextNode() as Text | null)) {
    if (n === node) return pos + offset;
    pos += n.data.length;
  }
  return pos;
}

/** Walks up from `node` to find which of `paras` contains it, or -1. */
function closestParagraphIndex(node: Node, paras: Element[]): number {
  let el: Element | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  while (el) {
    const idx = paras.indexOf(el);
    if (idx !== -1) return idx;
    el = el.parentElement;
  }
  return -1;
}

/**
 * A whole-card Range: from a card's tag paragraph through the last paragraph
 * of its cite, using the exact same "walk siblings until the next heading"
 * rule `buildCards`/`computeHighlightWarnings` use to define a card's extent
 * — so a card-anchored comment's highlight covers precisely the card the
 * Credibility panel would score, not an arbitrary guess at its boundaries.
 */
function cardRangeFromTagEl(tagEl: Element, headingClasses?: HeadingClasses): Range {
  let lastEl: Element = tagEl;
  let sib = tagEl.nextElementSibling;
  while (sib) {
    if (headingLevelOf(sib, headingClasses) > 0) break;
    lastEl = sib;
    sib = sib.nextElementSibling;
  }
  const r = document.createRange();
  r.setStartBefore(tagEl);
  r.setEndAfter(lastEl);
  return r;
}

/**
 * Resolves a saved comment back to a live Range in the currently-rendered doc.
 * Card-anchored comments (`anchor_kind: 'card'`) match by tag text — the same
 * identity `buildCards`/`hashCards` use for score-cache continuity, since
 * docx-preview assigns no stable per-render id — then span the whole card.
 * Text-anchored comments try the recorded paragraph index first (the fast,
 * common case where nothing has changed); falling back to a whole-document
 * search for the anchor text if that paragraph no longer contains it — e.g.
 * the underlying file was re-imported with different content. A drifted
 * anchor still lands on *a* matching occurrence rather than silently
 * vanishing.
 */
function resolveCommentAnchor(paras: Element[], c: DocComment, headingClasses?: HeadingClasses): Range | null {
  if (c.anchor_kind === 'card') {
    const tagEl = paras.find((p) => (p.textContent ?? '').replace(/\s+/g, ' ').trim() === c.anchor_text);
    return tagEl ? cardRangeFromTagEl(tagEl, headingClasses) : null;
  }
  const tryParagraph = (p: Element | undefined): Range | null => {
    if (!p) return null;
    const text = p.textContent ?? '';
    const idx = nthIndexOf(text, c.anchor_text, c.anchor_occurrence);
    if (idx === -1) return null;
    return rangeFromTextOffset(p, idx, c.anchor_text.length);
  };
  const direct = tryParagraph(paras[c.anchor_para_index]);
  if (direct) return direct;
  for (const p of paras) {
    const found = tryParagraph(p);
    if (found) return found;
  }
  return null;
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
// A paragraph's heading level (0 = not a heading). Checks the built-in
// Heading1–9 class first (fast path for standard Verbatim/Word docs), then the
// resolved style map for headings whose style ids aren't literally Heading1–9
// (Google Docs exports, custom Verbatim templates, etc. — resolved from
// styles.xml in the main process; see speechdoc:headingStyles).
function headingLevelOf(el: Element | null, headingClasses?: HeadingClasses): number {
  if (!el) return 0;
  const cls = (el as HTMLElement).className || '';
  const m = cls.match(/heading[\s_-]?([1-9])/i);
  if (m) return parseInt(m[1], 10);
  if (headingClasses && headingClasses.size) {
    for (const c of Array.from((el as HTMLElement).classList)) {
      if (c.startsWith('docx-render_')) {
        const lvl = headingClasses.get(c.slice('docx-render_'.length));
        if (lvl) return lvl;
      }
    }
  }
  return 0;
}

/**
 * Force every heading paragraph (pocket/hat/block/tag) to the doc's Calibri
 * stack, even when its resolved style carries an explicit non-Calibri font.
 *
 * This is a different problem than the theme-inheritance gap the page-level CSS
 * default (#wr-docx-fonts, section.docx-render) already handles: THAT gap is
 * runs with no resolved font at all. THIS is runs with an explicit, *wrong* one —
 * Word's built-in Heading5–9 styles ship with Times New Roman by default, and
 * templates that only ever customize the shallow levels a debate doc actually
 * uses (Heading1–4) leave that stale default sitting on any paragraph that
 * happens to nest deep enough to hit Heading5+. The result: a tag several
 * levels deep renders in Times New Roman while everything else on the page is
 * Calibri, even though nothing about the document intended a different font
 * there — by Verbatim convention every heading level is the same font. Since
 * the font is set inline (not just via a class), it beats the page-level CSS
 * default on specificity, so it has to be forced per-paragraph in JS instead.
 */
function forceHeadingFont(container: HTMLElement, headingClasses?: HeadingClasses) {
  container.querySelectorAll<HTMLElement>('p').forEach((p) => {
    if (headingLevelOf(p, headingClasses) > 0) {
      p.style.setProperty('font-family', DOC_FONT_STACK, 'important');
    }
  });
}

function isHighlightedEl(el: HTMLElement): boolean {
  return isSpanHighlighted(el);
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
  opts?: { range?: Range | null; wantRanges?: boolean; maxLevel?: number; headingClasses?: HeadingClasses },
): { count: number; ranges: Range[] } {
  const root = host.nodeType === Node.ELEMENT_NODE ? (host as Element) : host.parentElement;
  if (!root) return { count: 0, ranges: [] };
  const range = opts?.range ?? null;
  const wantRanges = !!opts?.wantRanges;
  const headingClasses = opts?.headingClasses;

  const paras = Array.from(root.querySelectorAll<HTMLElement>('p'));
  let maxLevel = opts?.maxLevel ?? 0;
  if (!maxLevel) for (const p of paras) maxLevel = Math.max(maxLevel, headingLevelOf(p, headingClasses));

  let count = 0;
  const ranges: Range[] = [];
  let prevWasTag = false;

  for (const p of paras) {
    if (range && !range.intersectsNode(p)) continue;
    const level = headingLevelOf(p, headingClasses);
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

// One paragraph's vertical extent (in the scrollable container's own
// coordinate space, i.e. comparable to `wrap.scrollTop`) plus how many spoken
// words fall in it — the input to adaptive auto-scroll pacing below.
interface SpeedSegment { top: number; bottom: number; words: number }

/**
 * Builds one SpeedSegment per paragraph from a single collectSpoken pass
 * (`wantRanges: true`), so a doc's whole pacing profile costs one DOM walk,
 * not one per paragraph. Each spoken Range is attributed to its containing
 * `<p>`; positions are measured via getBoundingClientRect deltas against
 * `wrap` rather than `offsetTop`, since a paragraph's offsetParent isn't
 * guaranteed to be `wrap` itself.
 */
function buildSpeedProfile(wrap: HTMLElement, container: HTMLElement, ranges: Range[]): SpeedSegment[] {
  const paras = Array.from(container.querySelectorAll<HTMLElement>('p'));
  if (paras.length === 0) return [];
  const wrapRect = wrap.getBoundingClientRect();
  const wordsByPara = new Map<HTMLElement, number>();
  for (const r of ranges) {
    const startEl = (r.startContainer.nodeType === Node.TEXT_NODE ? r.startContainer.parentElement : r.startContainer) as HTMLElement | null;
    const p = startEl?.closest('p') as HTMLElement | null;
    if (!p) continue;
    wordsByPara.set(p, (wordsByPara.get(p) ?? 0) + wordCount(r.toString()));
  }
  const segments: SpeedSegment[] = [];
  for (const p of paras) {
    const rect = p.getBoundingClientRect();
    const top = wrap.scrollTop + (rect.top - wrapRect.top);
    const bottom = wrap.scrollTop + (rect.bottom - wrapRect.top);
    if (bottom <= top) continue; // collapsed/hidden paragraph — no vertical extent to attribute pace to
    segments.push({ top, bottom, words: wordsByPara.get(p) ?? 0 });
  }
  return segments;
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
function computeHighlightWarnings(container: HTMLElement, cards: CredCard[], headingClasses?: HeadingClasses): void {
  const levelOf = (p: HTMLElement) => headingLevelOf(p, headingClasses);
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
function buildCards(container: HTMLElement, headingClasses?: HeadingClasses): CredCard[] {
  const paras = Array.from(container.querySelectorAll<HTMLElement>('p'));
  const levelOf = (p: HTMLElement) => headingLevelOf(p, headingClasses);
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
function loadCred(path: string, hash: string): (CardScore | null)[] | null {
  if (!path) return null;
  try {
    const v = JSON.parse(localStorage.getItem(credKey(path)) ?? 'null');
    if (v && v.hash === hash && Array.isArray(v.scores)) return v.scores as CardScore[];
  } catch { /* ignore */ }
  return null;
}
function saveCred(path: string, hash: string, scores: (CardScore | null)[]) {
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

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return day < 7 ? `${day}d ago` : new Date(iso).toLocaleDateString();
}

// Textarea with the same @-mention convention Chat.tsx's composer uses
// (restricted to team members here — a comment isn't the place to attach a
// case or a flow). Shared between the new-comment composer and every reply
// row so the picker only has to be wired up once.
function MentionableTextarea({ value, onChange, placeholder, autoFocus, onKeyDown, rows = 3 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void; rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [query, setQuery] = useState('');
  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    onChange(val);
    const cursor = e.target.selectionStart ?? val.length;
    const match = val.slice(0, cursor).match(/@(\w*)$/);
    if (match) { setShowPicker(true); setQuery(match[1]); } else { setShowPicker(false); setQuery(''); }
  }
  function handleSelect(item: PendingMention) {
    setShowPicker(false);
    const cursor = ref.current?.selectionStart ?? value.length;
    const replaced = value.slice(0, cursor).replace(/@\w*$/, `@${item.name.replace(/\s/g, '_')} `);
    onChange(replaced + value.slice(cursor));
    setTimeout(() => ref.current?.focus(), 0);
  }
  return (
    <div className="relative">
      <textarea
        ref={ref} value={value} onChange={handleChange} placeholder={placeholder}
        autoFocus={autoFocus} rows={rows}
        onKeyDown={(e) => { if (e.key === 'Escape') setShowPicker(false); onKeyDown?.(e); }}
        className="w-full resize-none rounded-md px-2 py-1.5 text-[12px] outline-none"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'rgb(var(--ink-rgb))' }}
      />
      {showPicker && <MentionPicker query={query} types={['member']} onSelect={handleSelect} onClose={() => setShowPicker(false)} />}
    </div>
  );
}

function CommentsPanel({ comments, currentUserId, teamMembers, onScrollTo, onDelete, onReply, onResolve, onClose }: {
  comments: DocComment[];
  currentUserId: string | undefined;
  teamMembers: { display_name: string }[];
  onScrollTo: (id: string) => void;
  onDelete: (id: string) => void;
  onReply: (parent: DocComment, body: string, visibility: 'team' | 'private') => Promise<void>;
  onResolve: (comment: DocComment, resolved: boolean) => void;
  onClose: () => void;
}) {
  const roots = comments.filter((c) => !c.parent_id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const repliesByParent = new Map<string, DocComment[]>();
  for (const c of comments) {
    if (!c.parent_id) continue;
    const arr = repliesByParent.get(c.parent_id) ?? [];
    arr.push(c);
    repliesByParent.set(c.parent_id, arr);
  }
  for (const arr of repliesByParent.values()) arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const open = roots.filter((c) => !c.resolved);
  const resolved = roots.filter((c) => c.resolved);
  const [showResolved, setShowResolved] = useState(false);

  return (
    <div className="shrink-0 flex flex-col h-full" style={{ width: 'min(300px, 85%)', borderLeft: '1px solid var(--border-subtle)', background: 'var(--bg-side)' }}>
      <div className="flex items-center gap-2 px-3.5 py-2 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span style={{ color: 'rgb(var(--ink-rgb))' }}><IcoComment active /></span>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[12.5px] font-semibold leading-tight truncate" style={{ color: 'rgb(var(--ink-rgb))' }}>Comments</span>
          <span className="text-[10px] leading-tight" style={{ color: 'var(--nav-inactive-color)' }}>
            {open.length} open{resolved.length ? ` · ${resolved.length} resolved` : ''}
          </span>
        </div>
        <IconBtn icon={<IcoClose />} label="Close" onClick={onClose} tooltipAlign="right" />
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin px-2.5 py-2.5 space-y-2">
        {roots.length === 0 && (
          <div className="px-1 py-3 text-[12px] leading-relaxed" style={{ color: 'var(--nav-inactive-color)' }}>
            No comments yet. Select text (or hover a card and click its margin icon) and click the comment bubble that appears to leave one.
          </div>
        )}
        {open.map((c) => (
          <CommentThread
            key={c.id} root={c} replies={repliesByParent.get(c.id) ?? []}
            currentUserId={currentUserId} teamMembers={teamMembers}
            onScrollTo={onScrollTo} onDelete={onDelete} onReply={onReply} onResolve={onResolve}
          />
        ))}
        {resolved.length > 0 && (
          <div>
            <button
              onClick={() => setShowResolved((v) => !v)}
              className="w-full flex items-center gap-1.5 px-1 py-1.5 text-[11px] font-medium"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--nav-inactive-color)' }}
            >
              <span style={{ transform: showResolved ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▸</span>
              {resolved.length} resolved
            </button>
            {showResolved && (
              <div className="space-y-2 mt-1">
                {resolved.map((c) => (
                  <CommentThread
                    key={c.id} root={c} replies={repliesByParent.get(c.id) ?? []}
                    currentUserId={currentUserId} teamMembers={teamMembers}
                    onScrollTo={onScrollTo} onDelete={onDelete} onReply={onReply} onResolve={onResolve}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CommentThread({ root, replies, currentUserId, teamMembers, onScrollTo, onDelete, onReply, onResolve }: {
  root: DocComment;
  replies: DocComment[];
  currentUserId: string | undefined;
  teamMembers: { display_name: string }[];
  onScrollTo: (id: string) => void;
  onDelete: (id: string) => void;
  onReply: (parent: DocComment, body: string, visibility: 'team' | 'private') => Promise<void>;
  onResolve: (comment: DocComment, resolved: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [posting, setPosting] = useState(false);

  async function submitReply() {
    if (!replyBody.trim() || posting) return;
    setPosting(true);
    try {
      await onReply(root, replyBody.trim(), 'team');
      setReplyBody('');
      setShowReplyBox(false);
      setExpanded(true);
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="rounded-lg overflow-hidden transition" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', opacity: root.resolved ? 0.65 : 1 }}>
      <div className="group p-2.5 cursor-pointer" onClick={() => onScrollTo(root.id)}>
        <div
          className="text-[10.5px] leading-snug mb-1.5 pl-1.5 line-clamp-2"
          style={{ color: 'var(--nav-inactive-color)', borderLeft: '2px solid rgba(147,51,234,0.5)' }}
        >
          {root.anchor_kind === 'card' ? `Card — "${root.anchor_text}"` : `"${root.anchor_text}"`}
        </div>
        <div className="flex items-start gap-1.5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[11.5px] font-semibold truncate" style={{ color: 'rgb(var(--ink-rgb))' }}>{root.user_name}</span>
              <span className="text-[10px] shrink-0" style={{ color: 'var(--nav-inactive-color)' }}>{relativeTime(root.created_at)}</span>
              {root.visibility === 'private' && (
                <span className="text-[9.5px] shrink-0 px-1 py-px rounded" style={{ color: 'var(--nav-inactive-color)', background: 'var(--bg-nest)' }} title="Only visible to you">
                  only me
                </span>
              )}
            </div>
            <div className="text-[12px] leading-snug whitespace-pre-wrap" style={{ color: 'rgb(var(--ink-rgb))' }}>{renderCommentBody(root.body, teamMembers)}</div>
            {root.resolved && root.resolved_by_name && (
              <div className="text-[10px] mt-1" style={{ color: 'var(--nav-inactive-color)' }}>Resolved by {root.resolved_by_name}</div>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
            <button
              onClick={(e) => { e.stopPropagation(); onResolve(root, !root.resolved); }}
              title={root.resolved ? 'Reopen' : 'Resolve'}
              className="flex items-center justify-center w-5 h-5 rounded"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: root.resolved ? '#34a853' : 'var(--nav-inactive-color)' }}
            >
              <svg width="12" height="12" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3.5 9.5l3.5 3.5 7-8" />
              </svg>
            </button>
            {root.user_id === currentUserId && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(root.id); }}
                title="Delete comment"
                className="flex items-center justify-center w-5 h-5 rounded"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--nav-inactive-color)' }}
              >
                <svg width="11" height="11" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M4 4l10 10M14 4L4 14" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {replies.length > 0 && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full text-left px-2.5 py-1.5 text-[11px]"
          style={{ background: 'transparent', border: 'none', borderTop: '1px solid var(--border-subtle)', cursor: 'pointer', color: 'var(--nav-inactive-color)' }}
        >
          {replies.length} repl{replies.length === 1 ? 'y' : 'ies'}
        </button>
      )}
      {expanded && replies.map((r) => (
        <div key={r.id} className="px-2.5 py-1.5 pl-5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[11px] font-semibold" style={{ color: 'rgb(var(--ink-rgb))' }}>{r.user_name}</span>
            <span className="text-[10px]" style={{ color: 'var(--nav-inactive-color)' }}>{relativeTime(r.created_at)}</span>
          </div>
          <div className="text-[11.5px] leading-snug whitespace-pre-wrap" style={{ color: 'rgb(var(--ink-rgb))' }}>{renderCommentBody(r.body, teamMembers)}</div>
        </div>
      ))}

      {showReplyBox ? (
        <div className="p-2 space-y-1.5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <MentionableTextarea
            value={replyBody} onChange={setReplyBody} placeholder="Reply…" rows={2} autoFocus
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submitReply(); }
              if (e.key === 'Escape') setShowReplyBox(false);
            }}
          />
          <div className="flex items-center justify-end gap-1.5">
            <button
              onClick={() => setShowReplyBox(false)}
              className="px-2 py-1 rounded text-[11px] font-medium"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--nav-inactive-color)' }}
            >
              Cancel
            </button>
            <button
              onClick={submitReply}
              disabled={posting || !replyBody.trim()}
              className="px-2.5 py-1 rounded text-[11px] font-semibold"
              style={{ background: '#4285F4', color: '#fff', border: 'none', cursor: posting || !replyBody.trim() ? 'default' : 'pointer', opacity: posting || !replyBody.trim() ? 0.6 : 1 }}
            >
              {posting ? 'Posting…' : 'Reply'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); setShowReplyBox(true); }}
          className="w-full text-left px-2.5 py-1.5 text-[11px]"
          style={{ background: 'transparent', border: 'none', borderTop: '1px solid var(--border-subtle)', cursor: 'pointer', color: 'var(--nav-inactive-color)' }}
        >
          Reply
        </button>
      )}
    </div>
  );
}

function CredibilityPanel({ cards, scores, loading, error, onScore, onScrollToCard, onClose, dismissed, onDismiss }: {
  cards: CredCard[];
  scores: (CardScore | null)[] | null;
  loading: boolean;
  error: string;
  onScore: () => void;
  onScrollToCard: (id: string) => void;
  onClose: () => void;
  dismissed: Set<string>;
  onDismiss: (tag: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  // Average only what was actually scored — folding nulls in as zeroes would
  // drag the whole doc's rating down for cards that were never rated at all.
  const rated = (scores ?? []).filter((x): x is CardScore => !!x);
  const avg = rated.length
    ? Math.round((rated.reduce((s, x) => s + x.score, 0) / rated.length) * 10) / 10
    : null;
  const unscored = (scores?.length ?? 0) - rated.length;

  return (
    <div className="shrink-0 flex flex-col h-full" style={{ width: 'min(300px, 85%)', borderLeft: '1px solid var(--border-subtle)', background: 'var(--bg-side)' }}>
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

        {/* A card Warroom AI skipped is left out of the list entirely rather than
            shown a made-up rating — so the count has to be stated, or the list
            silently looks like the doc simply had fewer cards. */}
        {!loading && unscored > 0 && (
          <div className="text-[11px] rounded-lg p-2.5" style={{ color: 'rgb(var(--warn-rgb))', background: 'rgba(var(--warn-rgb), 0.08)', border: '1px solid rgba(var(--warn-rgb), 0.25)' }}>
            {rated.length} of {scores?.length} cards scored — {unscored} didn't come back and{' '}
            {unscored === 1 ? 'is' : 'are'} left out rather than given a made-up rating. Re-score to try again.
          </div>
        )}

        {loading && (
          <LoadingState className="mt-8" messages={[
            `Scoring ${cards.length} cards…`,
            'Checking each source for credibility…',
            'Weighing author expertise and recency…',
            'Flagging weak or dated evidence…',
            'Finishing up…',
          ]} />
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
          <LoadingState className="mt-8" messages={[
            'Setting traps…',
            'Reading the doc for weak links…',
            'Designing questions that corner the answer…',
            'Sharpening the follow-ups…',
          ]} />
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
                  className="ai-glow-ring w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12.5px] font-semibold transition"
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
          press: x.press,
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
      style={{ width: 'min(360px, 85%)', borderLeft: '1px solid var(--border-subtle)', background: 'var(--bg-main)' }}
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
              <LoadingState className="mt-8" messages={[
                'Reading the doc & writing questions…',
                'Finding the strongest lines of attack…',
                'Drafting model answers…',
                'Polishing the question set…',
              ]} />
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
              className="ai-glow-ring flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12.5px] font-semibold transition"
              style={{ background: 'var(--item-selected-bg)', color: 'var(--item-selected-text)', border: '1px solid var(--border-subtle)', boxShadow: '0 2px 8px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.08)', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.65 : 1 }}
            >
              {loading ? <Spinner className="w-3.5 h-3.5" /> : <IcoSparkle />}
              {loading ? 'Generating…' : started ? 'Regenerate' : 'Generate'}
            </button>
            <button
              onClick={openTrapDrill}
              disabled={loading}
              className="ai-glow-ring flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-semibold transition"
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
function citeShorthandAfter(tagEl: HTMLElement, headingClasses?: HeadingClasses): string {
  let sib = tagEl.nextElementSibling as HTMLElement | null;
  while (sib && !(sib.textContent || '').trim()) sib = sib.nextElementSibling as HTMLElement | null;
  if (!sib) return '';
  if (headingLevelOf(sib, headingClasses) > 0) return '';
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

function SendToFlowPopover({ container, flows, activeHeadingId, anchorTop, onClose, headingClasses }: {
  container: HTMLElement | null;
  flows: FlowMeta[];
  activeHeadingId: string | null;
  anchorTop: number;
  onClose: () => void;
  headingClasses?: HeadingClasses;
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
      const cite = citeShorthandAfter(tagEl, headingClasses);
      setContent({ text: cite ? `${tag} — ${cite}` : tag, source: 'Current card (tag + cite)' });
      return;
    }
    if (hasSel) { setContent({ text: sel!.toString().replace(/\s+/g, ' ').trim(), source: 'Selected text' }); return; }
    if (tagEl) { setContent({ text: (tagEl.textContent || '').replace(/\s+/g, ' ').trim(), source: 'Current heading' }); return; }
    setContent({ text: '', source: 'Select text or scroll to a card' });
  }, [container, activeHeadingId, mode, headingClasses]);

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

// A pane renders one open document. Pane 0 is the "main" pane and stays
// wired to the global `view` (so every existing open-doc call site in the
// app — sidebar, Home, CasesGrid, etc. — keeps working unchanged and keeps
// OC live-case support). Panes 1 and 2 are extra compare panes opened from
// inside the viewer itself; they render a plain local file with the same
// toolbar/outline/find/focus features but no OC-case wiring.
export interface DocPaneProps {
  paneIndex?: 0 | 1 | 2;
  paneDocPath?: string;
  // An extra pane loads its file locally (drop / picker / recents click), so
  // the store would otherwise never learn which doc is actually in it — it'd
  // stay `''` ("open, nothing loaded"). That silently broke every feature keyed
  // on the *set* of open docs (per-combination layout memory, sidebar compare
  // views), since those saw only one real path. Panes report their path up here.
  onPaneDocPathChange?: (path: string) => void;
  focused?: boolean;
  onFocusPane?: () => void;
  onCloseExtraPane?: () => void;
  onAddPane?: () => void;
  canAddPane?: boolean;
  // Outline-open is controlled by the multi-pane wrapper (not local state) so
  // it can coordinate cross-pane layout (squish/space methods) and persist it
  // per doc combination. Single-pane usage still gets a sane default via the
  // fallback state below when these aren't passed.
  outlineOpen?: boolean;
  onOutlineOpenChange?: (open: boolean) => void;
  // Set while 2-3 panes are open: there isn't room for a full toolbar per pane,
  // so the reading-time, send-to-flow, Credibility and Cross-Ex controls fold
  // into a ⋯ overflow menu (keeping their labels there).
  toolbarCompact?: boolean;
}

function DocPaneViewer({
  paneIndex = 0, paneDocPath, onPaneDocPathChange, focused = true, onFocusPane, onCloseExtraPane, onAddPane, canAddPane,
  outlineOpen: outlineOpenProp, onOutlineOpenChange, toolbarCompact = false,
}: DocPaneProps) {
  const { setBusy, view, setView, event, flowsIndex, db, update, currentUser, currentTeam, teamMembers } = useApp();
  // Folder-of-docx import files every doc it finds into a new Warroom folder
  // named after the OS folder it came from — aliased to avoid colliding with
  // useApp()'s own `update` above, which mutates the db, not folder assignments.
  const { update: updateFolders } = useCaseFolders();
  const pendingFindQuery = useApp((s) => s.pendingFindQuery);
  const setPendingFindQuery = useApp((s) => s.setPendingFindQuery);
  // OpenCaseList-imported case (carries a docx via ocSource). Derived from the
  // current view + db so this single always-mounted viewer can render both
  // normal speech docs and imported cases without a second instance. Only
  // pane 0 tracks the global view — extra compare panes are plain files.
  const ocCase = paneIndex === 0 && view.kind === 'case' && db.cases[(view as any).caseId]?.ocSource
    ? db.cases[(view as any).caseId]
    : null;
  const ocCaseId = ocCase?.id;
  const ocUrl = (ocCase as any)?.ocSource?.url as string | undefined;
  const isOc = !!ocCase;
  // When opening a disclosed OC file directly (before saving), the view carries
  // an ocPreview object so we can show a "Save to Cases" action inline.
  const ocPreview = paneIndex === 0 && view.kind === 'speech-doc' ? (view as any).ocPreview as
    { url: string; teamName: string; label: string; side: string } | undefined : undefined;
  const [ocPreviewSaved, setOcPreviewSaved] = React.useState(false);
  // Double-click the doc title to rename it — updates the case name (OC cases)
  // or the recents entry's display name (plain files). Never touches the file
  // on disk; that's a filesystem operation the user didn't ask for.
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const ocBytesRef = useRef<string>(''); // base64 of the loaded OC docx, for export/share
  const [ocChecking, setOcChecking] = useState(false);
  const [ocCheckResult, setOcCheckResult] = useState<'changed' | 'up-to-date' | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const { dragActive, setDragActive, dragHandlers } = useDragActive();
  const [cxOpen, setCxOpen] = useState(false);
  const [flowSendOpen, setFlowSendOpen] = useState(false);
  const [error, setError] = useState('');
  const [filePath, setFilePath] = useState('');
  const [fileName, setFileName] = useState('');
  // A real on-disk path to reveal in Finder/Explorer: local docs and OC previews
  // (which load from a temp file) qualify; saved OC cases use a synthetic `oc:`
  // key with no local file, so they can't be revealed.
  const revealPath = !isOc && filePath && !filePath.startsWith('oc:') ? filePath : '';

  function startRenameTitle() {
    if (!fileName) return;
    setTitleDraft(fileName.replace(/\.docx$/i, ''));
    setTitleEditing(true);
    window.setTimeout(() => { titleInputRef.current?.focus(); titleInputRef.current?.select(); }, 0);
  }
  function commitRenameTitle() {
    setTitleEditing(false);
    const val = titleDraft.trim();
    if (!val) return;
    if (isOc && ocCase) {
      update((db) => ({ ...db, cases: { ...db.cases, [ocCase.id]: { ...db.cases[ocCase.id], name: val } } }));
      setFileName(val);
    } else if (filePath) {
      const withExt = /\.docx$/i.test(fileName) ? `${val.replace(/\.docx$/i, '')}.docx` : val;
      renameRecent(filePath, withExt);
      setFileName(withExt);
    }
  }
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  const [shareOpen, setShareOpen] = useState(false);
  const [focusActive, setFocusActive] = useState(false);
  const [focusType, setFocusType] = useState<FocusType>('highlight');
  // Refs so the loadFile closure can read latest focus state without stale capture
  const focusActiveRef = useRef(false);
  const focusTypeRef   = useRef<FocusType>('highlight');
  // Epoch-ms deadline until which the scroll-driven active-heading tracker defers
  // to whatever scrollToHeading last set, instead of overriding it. See scrollToHeading.
  const pinnedActiveUntilRef = useRef(0);
  // Heading-style map for the current doc, resolved from styles.xml in the main
  // process. Lets all the structural features (outline, cards, focus mode,
  // reading time, send-to-flow) detect headings even when the doc's heading style
  // ids aren't literally Heading1–9. Kept in a ref so selection/focus handlers
  // outside the load closure can read the current doc's map without re-render.
  const headingClassesRef = useRef<HeadingClasses | undefined>(undefined);
  const [recents, setRecents] = useState<RecentDoc[]>(getRecents);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [outlineOpenState, setOutlineOpenState] = useState(false);
  const outlineOpen = outlineOpenProp ?? outlineOpenState;
  const setOutlineOpen = useCallback((next: boolean | ((v: boolean) => boolean)) => {
    const resolved = typeof next === 'function' ? (next as (v: boolean) => boolean)(outlineOpen) : next;
    if (onOutlineOpenChange) onOutlineOpenChange(resolved); else setOutlineOpenState(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlineOpen, onOutlineOpenChange]);
  // Settings → "Keep speech docs light": in dark mode, render the doc page
  // itself as light "paper" while the rest of the app stays dark. Default on.
  const [docLightInDark, setDocLightInDark] = useState(
    () => localStorage.getItem('warroom-doc-light-in-dark') !== 'false'
  );
  useEffect(() => {
    const onChange = (e: Event) => {
      const v = (e as CustomEvent).detail?.docLightInDark;
      if (typeof v === 'boolean') setDocLightInDark(v);
    };
    window.addEventListener('warroom-doc-light-changed', onChange);
    return () => window.removeEventListener('warroom-doc-light-changed', onChange);
  }, []);
  // Highlight readability slider (⋯ menu) — how much to soften Word's raw
  // highlighter colors on a light-rendered page. Read once here; the live
  // theme-sync effect below (which already depends on docLightInDark) also
  // depends on this, so any change re-applies to the open doc immediately.
  const [highlightReadability, setHighlightReadability] = useState(() => loadHighlightReadability());
  useEffect(() => {
    const onChange = (e: Event) => {
      const v = (e as CustomEvent).detail;
      if (typeof v === 'number') setHighlightReadability(v);
    };
    window.addEventListener(HIGHLIGHT_READABILITY_CHANGED, onChange);
    return () => window.removeEventListener(HIGHLIGHT_READABILITY_CHANGED, onChange);
  }, []);
  // Settings → "Speech doc margins": how much of the doc's real Word page
  // margins to keep (0 = edge-to-edge, 100 = full original margin). Default
  // 50 — cut noticeably, but not stripped bare, out of the box.
  const [docMarginPct, setDocMarginPct] = useState(() => {
    const v = parseInt(localStorage.getItem('warroom-doc-margin-pct') ?? '50', 10);
    return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 50;
  });
  useEffect(() => {
    const onChange = (e: Event) => {
      const v = (e as CustomEvent).detail?.pct;
      if (typeof v === 'number') setDocMarginPct(v);
    };
    window.addEventListener('warroom-doc-margin-changed', onChange);
    return () => window.removeEventListener('warroom-doc-margin-changed', onChange);
  }, []);
  // Re-scale an already-open doc's margins live when the setting changes,
  // without needing to reopen it. Reads from the data-orig-p{l,r} attributes
  // stamped at render time (see applyRender) so repeated changes always scale
  // from the doc's true authored margin, never from an already-shrunk value.
  useEffect(() => {
    const cont = containerRef.current;
    if (!cont) return;
    for (const page of Array.from(cont.children) as HTMLElement[]) {
      const pl = parseFloat(page.dataset.origPl ?? '');
      const pr = parseFloat(page.dataset.origPr ?? '');
      if (Number.isFinite(pl)) page.style.paddingLeft = `${pl * (docMarginPct / 100)}px`;
      if (Number.isFinite(pr)) page.style.paddingRight = `${pr * (docMarginPct / 100)}px`;
    }
  }, [docMarginPct]);
  // Settings → "Speech doc text size": a plain CSS zoom on the render
  // container, so it scales text, cards and everything else together —
  // safe to reapply any time since it isn't destructive like margin padding.
  const [docZoomPct, setDocZoomPct] = useState(() => {
    const v = parseInt(localStorage.getItem('warroom-doc-zoom-pct') ?? '100', 10);
    return Number.isFinite(v) ? Math.min(150, Math.max(80, v)) : 100;
  });
  useEffect(() => {
    const onChange = (e: Event) => {
      const v = (e as CustomEvent).detail?.pct;
      if (typeof v === 'number') setDocZoomPct(v);
    };
    window.addEventListener('warroom-doc-zoom-changed', onChange);
    return () => window.removeEventListener('warroom-doc-zoom-changed', onChange);
  }, []);
  useEffect(() => {
    if (containerRef.current) (containerRef.current.style as any).zoom = docZoomPct / 100;
  }, [docZoomPct]);
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
  // A slot is null when Warroom AI didn't return a score for that card. It is
  // deliberately NOT zero — a fabricated "0 / Weak" is indistinguishable from a
  // real bottom rating, which is exactly how this used to mislead.
  const [credScores, setCredScores] = useState<(CardScore | null)[] | null>(null);
  const [credLoading, setCredLoading] = useState(false);
  const [credError, setCredError] = useState('');
  const credHashRef = useRef('');
  // Doc comments (Google-Docs style, team-visible by default). One combined
  // on/off: the single Comments toolbar button both opens the sidebar and
  // shows every highlight (closing it hides both), matching how the button
  // itself is described — there's no separate "hide highlights only" state.
  const [comments, setComments] = useState<DocComment[]>([]);
  const [commentsVisible, setCommentsVisible] = useState(
    () => localStorage.getItem('warroom-doc-comments-visible') !== 'false'
  );
  const [pendingComment, setPendingComment] = useState<PendingCommentAnchor | null>(null);
  const [hoveredCardTag, setHoveredCardTag] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [composerVisibility, setComposerVisibility] = useState<'team' | 'private'>('team');
  const [composerBody, setComposerBody] = useState('');
  const [composerPosting, setComposerPosting] = useState(false);
  const commentRangesRef = useRef<Map<string, Range>>(new Map());
  function toggleCommentsVisible() {
    setCommentsVisible(v => {
      const next = !v;
      try { localStorage.setItem('warroom-doc-comments-visible', String(next)); } catch { /* ignore */ }
      if (!next) setPendingComment(null); // closing cancels any open composer too
      return next;
    });
  }
  // Highlight-outlier warning dismissals (per-doc, loaded from localStorage)
  const [dismissedWarnings, setDismissedWarnings] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollWrapRef = useRef<HTMLDivElement>(null);
  // Set right before applyRender() is called (loadFile / loadOcCase), to whatever
  // key that doc is addressed by in scroll storage. A ref, not state — read from
  // a scroll listener and from inside applyRender's own closure without waiting
  // on a re-render.
  const viewingScrollKeyRef = useRef<string | null>(null);
  const wpmRef = useRef(wpm);
  const docWordsRef = useRef(0);
  const autoRafRef = useRef(0);
  const autoAccRef = useRef(0);
  const autoLastRef = useRef(0);
  const autoLastSetRef = useRef(0);
  // Per-paragraph "spoken words per pixel" profile for adaptive auto-scroll
  // pace — built once per doc load (see applyRender), read every frame in
  // autoStep. smoothedPxPerWordRef carries the exponentially-smoothed speed
  // across frames so pace changes ease in/out at paragraph boundaries instead
  // of visibly stepping.
  const speedProfileRef = useRef<SpeedSegment[]>([]);
  const smoothedPxPerWordRef = useRef(0);
  // Settings → "Adaptive reading pace": on (default) varies auto-scroll speed
  // with how much spoken (highlighted/underlined) content is actually in view
  // — slower through dense cards, faster through sparse context — instead of
  // one constant speed for the whole doc. Off falls back to the flat rate.
  const [docAdaptivePace, setDocAdaptivePaceState] = useState(
    () => localStorage.getItem('warroom-doc-adaptive-pace') !== 'false'
  );
  const docAdaptivePaceRef = useRef(docAdaptivePace);
  useEffect(() => {
    const onChange = (e: Event) => {
      const v = (e as CustomEvent).detail?.adaptivePace;
      if (typeof v === 'boolean') setDocAdaptivePaceState(v);
    };
    window.addEventListener('warroom-doc-adaptive-pace-changed', onChange);
    return () => window.removeEventListener('warroom-doc-adaptive-pace-changed', onChange);
  }, []);
  useEffect(() => { docAdaptivePaceRef.current = docAdaptivePace; }, [docAdaptivePace]);
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

  // Office-font substitution. macOS ships no Calibri, so docx-preview's inline
  // `font-family: Calibri` falls back to the browser default serif (Times New
  // Roman-like) — wrong for the vast majority of debate docs, which are Calibri.
  // These @font-face aliases redefine the Office families to resolve to the first
  // available local font: real Calibri if Office is installed, else the metric-
  // compatible Carlito, else a clean system sans-serif. Serif Office fonts keep a
  // serif fallback. Injected once, globally (covers every docx the app renders).
  useEffect(() => {
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

      /* Default font for theme-inherited runs.
         Modern debate docs routinely leave the latin font UNSET on body runs: the run
         carries only w:rFonts w:cs="Calibri" (complex-script) and inherits its real
         font from docDefaults -> w:asciiTheme="minorHAnsi" -> the THEME font (Aptos).
         docx-preview does not resolve theme fonts, so those runs emit no font-family
         at all and fall through to Chromium's default serif — which is why a doc could
         render sans-serif headings but Times New Roman body text despite declaring one
         font throughout. Aliasing 'Aptos' cannot fix it, because that string is never
         emitted. Setting the page default here does: runs with no font inherit the sans
         stack, while runs that DO resolve a font (Calibri headings, a genuinely
         Times-New-Roman body) keep it — docx-preview styles those per-element, which
         beats this selector. Class must match renderAsync's className option. */
      section.docx-render {
        font-family: ${DOC_FONT_STACK};
      }
    `;
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

  // Global search → open this doc with the matched term: auto-open the find bar,
  // prefill it, and jump to the first hit once the document has rendered.
  useEffect(() => {
    if (!pendingFindQuery || step !== 'viewing') return;
    const q = pendingFindQuery;
    setPendingFindQuery('');
    setFindOpen(true);
    setFindQuery(q);
    // Let docx-preview finish painting before searching for ranges.
    const t = window.setTimeout(() => runFind(q), 250);
    return () => window.clearTimeout(t);
  }, [pendingFindQuery, step, runFind, setPendingFindQuery]);

  const closeFind = useCallback(() => { setFindOpen(false); }, []);

  // ── Auto-scroll handlers ────────────────────────────────────────────────
  const stopAutoRaf = useCallback(() => {
    if (autoRafRef.current) { cancelAnimationFrame(autoRafRef.current); autoRafRef.current = 0; }
  }, []);
  const stopAuto = useCallback(() => { stopAutoRaf(); setAutoScroll(false); setAutoPaused(false); }, [stopAutoRaf]);

  // How far the flat rate can be scaled by local content density before
  // clamping — wide enough that dense cards and sparse context visibly move
  // at different speeds, narrow enough that it never reads as erratic.
  const ADAPTIVE_MIN_MULT = 0.35;
  const ADAPTIVE_MAX_MULT = 3;
  // Time constant for easing pace changes in/out at paragraph boundaries,
  // so density shifts read as a gradient rather than a visible speed step.
  const ADAPTIVE_SMOOTH_TAU_MS = 500;

  const autoStep = useCallback((now: number) => {
    const wrap = scrollWrapRef.current;
    if (!wrap) { stopAuto(); return; }
    // If the user scrolled manually, resync to their position.
    if (Math.abs(wrap.scrollTop - autoLastSetRef.current) > 3) autoAccRef.current = wrap.scrollTop;
    const dt = now - autoLastRef.current;
    autoLastRef.current = now;
    const globalPxPerWord = wrap.scrollHeight / (docWordsRef.current || 1);
    let pxPerWord = globalPxPerWord;
    const profile = speedProfileRef.current;
    if (docAdaptivePaceRef.current && profile.length > 0) {
      // A bit ahead of the very top edge — roughly where the eye is actually
      // reading, not the sliver of text just now scrolling into view.
      const y = autoAccRef.current + wrap.clientHeight * 0.35;
      const seg = profile.find(s => y >= s.top && y < s.bottom) ?? profile[profile.length - 1];
      const segHeight = Math.max(1, seg.bottom - seg.top);
      const targetPxPerWord = seg.words > 0 ? segHeight / seg.words : globalPxPerWord * ADAPTIVE_MAX_MULT;
      const clamped = Math.min(globalPxPerWord * ADAPTIVE_MAX_MULT, Math.max(globalPxPerWord * ADAPTIVE_MIN_MULT, targetPxPerWord));
      const smoothFactor = 1 - Math.exp(-dt / ADAPTIVE_SMOOTH_TAU_MS);
      smoothedPxPerWordRef.current = smoothedPxPerWordRef.current > 0
        ? smoothedPxPerWordRef.current + (clamped - smoothedPxPerWordRef.current) * smoothFactor
        : clamped;
      pxPerWord = smoothedPxPerWordRef.current;
    }
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
    smoothedPxPerWordRef.current = 0; // fresh smoothing ramp each time playback (re)starts
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

  // Remember scroll position per doc. Debounced writes on scroll; the matching
  // restore happens once inside applyRender, after the doc has actually painted.
  useEffect(() => {
    const wrap = scrollWrapRef.current;
    if (!wrap) return;
    let t = 0;
    const onScroll = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const key = viewingScrollKeyRef.current;
        if (key) saveScroll(key, wrap.scrollTop);
      }, 200);
    };
    wrap.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.clearTimeout(t); wrap.removeEventListener('scroll', onScroll); };
  }, []);

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
      setSelWords(collectSpoken(r.commonAncestorContainer, { range: r, headingClasses: headingClassesRef.current }).count);
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

  // Cmd/Ctrl+F opens the find bar; Esc closes it. Only the focused pane
  // responds — with 2-3 panes mounted at once, only one should react per keypress.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!focused) return;
      if (step === 'viewing' && matchesShortcut(e, 'find-page')) {
        e.preventDefault();
        setFindOpen(true);
        window.setTimeout(() => findInputRef.current?.focus(), 0);
      } else if (e.key === 'Escape' && findOpen) {
        setFindOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, findOpen, focused]);

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

  // ── Section select (Cmd/Ctrl+click headings) ────────────────────────────
  // Cmd/Ctrl+click on a heading toggles that whole section — the heading plus
  // everything under it, up to the next heading of the same (or shallower)
  // level — into a selection. Multiple headings can be Cmd+clicked to build up
  // a multi-section selection (Chromium's Selection API only supports a single
  // Range, so the extra sections are tracked here and painted with a CSS class;
  // a copy-event handler below writes ALL selected sections to the clipboard).
  const sectionSelRef = useRef<HTMLElement[]>([]);

  const sectionEls = useCallback((heading: HTMLElement): HTMLElement[] => {
    const headingClasses = headingClassesRef.current;
    const level = headingLevelOf(heading, headingClasses);
    const els: HTMLElement[] = [heading];
    for (let sib = heading.nextElementSibling; sib; sib = sib.nextElementSibling) {
      const lvl = headingLevelOf(sib, headingClasses);
      if (lvl > 0 && lvl <= level) break;
      els.push(sib as HTMLElement);
    }
    return els;
  }, []);

  const paintSectionSel = useCallback(() => {
    const cont = containerRef.current;
    if (!cont) return;
    cont.querySelectorAll('.wr-section-sel').forEach(el => el.classList.remove('wr-section-sel'));
    for (const h of sectionSelRef.current) {
      for (const el of sectionEls(h)) el.classList.add('wr-section-sel');
    }
  }, [sectionEls]);

  const clearSectionSel = useCallback(() => {
    if (!sectionSelRef.current.length) return;
    sectionSelRef.current = [];
    paintSectionSel();
  }, [paintSectionSel]);

  const onDocClick = useCallback((e: React.MouseEvent) => {
    const cont = containerRef.current;
    if (!cont) return;
    if (!(e.metaKey || e.ctrlKey)) { clearSectionSel(); return; }
    const p = (e.target as HTMLElement).closest('p');
    if (!p || !cont.contains(p)) return;
    if (headingLevelOf(p, headingClassesRef.current) <= 0) return;
    e.preventDefault();
    const heading = p as HTMLElement;
    const cur = sectionSelRef.current;
    sectionSelRef.current = cur.includes(heading)
      ? cur.filter(h => h !== heading)
      : [...cur, heading];
    paintSectionSel();
    // Keep a native selection over the last-clicked section too: it makes ⌘C
    // fire a copy event even in contexts that skip it for empty selections, and
    // doubles as the anchor for the selection word-count bubble.
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      if (sectionSelRef.current.length) {
        const anchor = sectionSelRef.current[sectionSelRef.current.length - 1];
        const els = sectionEls(anchor);
        const range = document.createRange();
        range.setStartBefore(els[0]);
        range.setEndAfter(els[els.length - 1]);
        sel.addRange(range);
      }
    }
  }, [clearSectionSel, paintSectionSel, sectionEls]);

  // Copy interception: while a section selection is active, ⌘C copies every
  // selected section (in document order), not just the one native Range.
  useEffect(() => {
    function onCopy(e: ClipboardEvent) {
      const heads = sectionSelRef.current;
      if (!heads.length || !e.clipboardData) return;
      const ordered = [...heads].sort((a, b) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      const html: string[] = [];
      const text: string[] = [];
      for (const h of ordered) {
        for (const el of sectionEls(h)) {
          html.push(el.outerHTML);
          text.push(el.innerText);
        }
      }
      e.clipboardData.setData('text/html', html.join(''));
      e.clipboardData.setData('text/plain', text.join('\n'));
      e.preventDefault();
    }
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, [sectionEls]);

  // Esc clears the section selection.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') clearSectionSel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSectionSel]);

  // ── Right-click → Copy card ─────────────────────────────────────────────
  // Right-clicking anywhere inside a card (tag, cite, or body) offers a one-
  // click "Copy card" that grabs the whole card without needing a selection.
  const [cardMenu, setCardMenu] = useState<{ x: number; y: number; els: HTMLElement[] } | null>(null);

  const onDocContextMenu = useCallback((e: React.MouseEvent) => {
    const cont = containerRef.current;
    if (!cont) return;
    const p = (e.target as HTMLElement).closest('p');
    if (!p || !cont.contains(p)) return;
    const hc = headingClassesRef.current;
    // The tag is the deepest heading level present in the doc (Verbatim rule).
    let maxLevel = 0;
    for (const q of Array.from(cont.querySelectorAll('p'))) {
      maxLevel = Math.max(maxLevel, headingLevelOf(q, hc));
    }
    if (!maxLevel) return;
    // Walk back from the clicked paragraph to its tag heading. Hitting a
    // shallower heading first means the click wasn't inside a card.
    let tag: HTMLElement | null = null;
    for (let el: Element | null = p; el; el = el.previousElementSibling) {
      const lvl = headingLevelOf(el, hc);
      if (lvl === maxLevel) { tag = el as HTMLElement; break; }
      if (lvl > 0 && el !== p) return;
    }
    if (!tag) return;
    const els: HTMLElement[] = [tag];
    for (let sib = tag.nextElementSibling; sib; sib = sib.nextElementSibling) {
      if (headingLevelOf(sib, hc) > 0) break;
      els.push(sib as HTMLElement);
    }
    if (els.length < 2) return; // bare label tag — no cite/body to copy
    e.preventDefault();
    setCardMenu({ x: e.clientX, y: e.clientY, els });
  }, []);

  const copyCardEls = useCallback(async (els: HTMLElement[]) => {
    const html = els.map(el => el.outerHTML).join('');
    const text = els.map(el => el.innerText).join('\n');
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
    } catch {
      try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    }
  }, []);

  // Dismiss the card menu on any click, Esc, or scroll.
  useEffect(() => {
    if (!cardMenu) return;
    const close = () => setCardMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', close);
    };
  }, [cardMenu]);

  // ── Selection word-count bubble ─────────────────────────────────────────
  // While text is selected in the doc, float a small pill near the end of the
  // selection showing the spoken word count (same rule as the reading timer).
  const [selBubble, setSelBubble] = useState<{ x: number; y: number; count: number; range: Range } | null>(null);
  useEffect(() => {
    if (step !== 'viewing') { setSelBubble(null); return; }
    let t = 0;
    const update = () => {
      const sel = window.getSelection();
      const cont = containerRef.current;
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !cont) { setSelBubble(null); return; }
      const r = sel.getRangeAt(0);
      if (!cont.contains(r.commonAncestorContainer)) { setSelBubble(null); return; }
      const count = collectSpoken(r.commonAncestorContainer, { range: r, headingClasses: headingClassesRef.current }).count;
      if (!count) { setSelBubble(null); return; }
      const rects = r.getClientRects();
      const last = rects.length ? rects[rects.length - 1] : r.getBoundingClientRect();
      // Cloned: the live Range mutates/collapses as the selection changes, but
      // the comment composer needs a snapshot of exactly what was selected at
      // the moment "Add comment" is clicked, which can be well after this fires.
      setSelBubble({ x: last.right, y: last.bottom, count, range: r.cloneRange() });
    };
    const onChange = () => { window.clearTimeout(t); t = window.setTimeout(update, 180); };
    // Hide on scroll — the viewport-anchored position goes stale immediately.
    const onScroll = () => setSelBubble(null);
    document.addEventListener('selectionchange', onChange);
    const wrap = scrollWrapRef.current;
    wrap?.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('selectionchange', onChange);
      wrap?.removeEventListener('scroll', onScroll);
    };
  }, [step]);

  // ── Doc comments ──────────────────────────────────────────────────────────
  // filePath doubles as this doc's comment key: it's the real path for a
  // plain file, or the synthetic `oc:<url>` loadOcCase already uses — either
  // way it's the same identity the rest of this component treats as "which
  // doc is this."
  const docKey = filePath;

  // Fetch comments whenever the open doc or team changes. No team, no comments
  // feature — it's fundamentally a team surface, so the toolbar toggle and
  // selection popover are hidden entirely rather than shown disabled.
  useEffect(() => {
    // Clear synchronously on every docKey change (not just when there's no
    // team) — otherwise, for the brief window between this doc's DOM already
    // being rendered and the fetch below resolving, the anchor-resolving
    // effect would try to place the PREVIOUS doc's comments into the new
    // doc's text.
    setComments([]);
    if (!docKey || !currentTeam) return;
    let cancelled = false;
    (async () => {
      const res = await window.warroom.docComments.get(currentTeam.id, docKey);
      if (!cancelled && res.ok) setComments(res.data ?? []);
    })();
    return () => { cancelled = true; };
  }, [docKey, currentTeam?.id]);

  // Live updates from teammates — see the subscribe effect in the wrapper
  // (SpeechDocViewer's default export) for why this listens on a window event
  // instead of subscribing itself.
  useEffect(() => {
    function onChange(e: Event) {
      const { eventType, row } = (e as CustomEvent).detail ?? {};
      if (!row || row.doc_key !== docKey) return;
      setComments((prev) => {
        if (eventType === 'DELETE') return prev.filter((c) => c.id !== row.id);
        if (eventType === 'INSERT') return prev.some((c) => c.id === row.id) ? prev : [...prev, row];
        return prev.map((c) => (c.id === row.id ? row : c)); // UPDATE
      });
    }
    window.addEventListener('warroom-doc-comment-change', onChange);
    return () => window.removeEventListener('warroom-doc-comment-change', onChange);
  }, [docKey]);

  // Resolve every comment to a live Range and paint the highlight registry.
  // Re-runs whenever comments change, the doc (re)renders, or visibility toggles.
  useEffect(() => {
    const cont = containerRef.current;
    const reg = (CSS as any)?.highlights;
    const H = (window as any)?.Highlight;
    if (step !== 'viewing' || !cont || !reg || !H) return;
    const paras = Array.from(cont.querySelectorAll('p'));
    // Ranges are kept for every top-level comment (resolved or not) so
    // clicking any comment row — including a resolved one — can still scroll
    // to it; only unresolved ones are actually painted into the highlight
    // registry below. Replies have no anchor of their own (see scrollToComment).
    const ranges = new Map<string, Range>();
    for (const c of comments) {
      if (c.parent_id) continue;
      const r = resolveCommentAnchor(paras, c, headingClassesRef.current);
      if (r) ranges.set(c.id, r);
    }
    commentRangesRef.current = ranges;
    if (COMMENTS_UI_ENABLED && commentsVisible) {
      const painted = comments
        .filter((c) => !c.parent_id && !c.resolved)
        .map((c) => ranges.get(c.id))
        .filter((r): r is Range => !!r);
      if (painted.length) reg.set(COMMENT_HL, new H(...painted));
      else reg.delete(COMMENT_HL);
    } else {
      reg.delete(COMMENT_HL);
    }
  }, [comments, step, commentsVisible]);

  // Inject the comment-highlight style once — a light, deliberately distinct
  // wash so it never reads as one of the document's own cyan/yellow/green
  // evidence highlights (see DEBATE_DOC_STRUCTURE.md).
  useEffect(() => {
    if (document.getElementById('wr-comment-style')) return;
    const el = document.createElement('style');
    el.id = 'wr-comment-style';
    el.textContent = `::highlight(${COMMENT_HL}){background-color:rgba(147,51,234,0.14);}`;
    document.head.appendChild(el);
  }, []);

  // ⌘⌥M (Ctrl+Alt+M on Windows) — Google Docs' own "insert comment" shortcut
  // — opens the comment composer on the current text selection. Only fires
  // with a live, non-collapsed selection, same as clicking the floating
  // comment bubble; a bare keypress with nothing selected does nothing.
  // Only the focused pane responds, same as ⌘F — with 2-3 panes mounted,
  // only one should react.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!focused || !COMMENTS_UI_ENABLED) return;
      if (step === 'viewing' && matchesShortcut(e, 'doc-insert-comment')) {
        if (!currentTeam || !selBubble) return;
        e.preventDefault();
        if (!commentsVisible) {
          setCommentsVisible(true);
          try { localStorage.setItem('warroom-doc-comments-visible', 'true'); } catch { /* ignore */ }
        }
        openComposerFromSelection();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focused, step, currentTeam, selBubble, commentsVisible]);

  const scrollToComment = useCallback((id: string) => {
    // A reply has no anchor of its own — it scrolls to whatever its
    // top-level parent is anchored to, same as clicking anywhere in a
    // Google Docs thread jumps to the thread's one highlighted span.
    const target = comments.find((c) => c.id === id);
    const anchorId = target?.parent_id ?? id;
    const r = commentRangesRef.current.get(anchorId);
    if (!r) return;
    const el = (r.startContainer.nodeType === Node.TEXT_NODE ? r.startContainer.parentElement : (r.startContainer as Element)) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: 'auto', block: 'center' });
    const prevBg = el.style.backgroundColor;
    const prevTrans = el.style.transition;
    el.style.transition = 'background-color 0.25s ease';
    el.style.backgroundColor = 'rgba(147, 51, 234, 0.35)';
    window.setTimeout(() => {
      el.style.backgroundColor = prevBg;
      window.setTimeout(() => { el.style.transition = prevTrans; }, 300);
    }, 650);
  }, [comments]);

  // Reveals a small margin comment-icon whenever the pointer is over a card's
  // tag paragraph (`[data-cred-id]`, set by buildCards on every doc load,
  // Credibility panel open or not) — the intuitive entry point for "comment
  // on this whole card" that needs no manual selection first. A short delay
  // before clearing lets the pointer travel from the tag to the floating
  // button itself without the button vanishing first (same gap problem the
  // ⋯ overflow menu solves the same way).
  const cardHoverTimeoutRef = useRef<number | null>(null);
  function cancelCardHoverClear() {
    if (cardHoverTimeoutRef.current) { window.clearTimeout(cardHoverTimeoutRef.current); cardHoverTimeoutRef.current = null; }
  }
  function clearCardHoverSoon() {
    cancelCardHoverClear();
    cardHoverTimeoutRef.current = window.setTimeout(() => setHoveredCardTag(null), 200);
  }
  useEffect(() => {
    const cont = containerRef.current;
    if (!COMMENTS_UI_ENABLED || !cont || step !== 'viewing' || !currentTeam || !commentsVisible) { setHoveredCardTag(null); return; }
    function onOver(e: MouseEvent) {
      const target = (e.target as Element)?.closest?.('[data-cred-id]');
      if (!target) return;
      cancelCardHoverClear();
      setHoveredCardTag({ id: target.getAttribute('data-cred-id')!, rect: target.getBoundingClientRect() });
    }
    cont.addEventListener('mouseover', onOver);
    cont.addEventListener('mouseout', clearCardHoverSoon);
    return () => {
      cont.removeEventListener('mouseover', onOver);
      cont.removeEventListener('mouseout', clearCardHoverSoon);
      cancelCardHoverClear();
    };
  }, [step, currentTeam, commentsVisible]);

  function openComposerFromSelection() {
    if (!selBubble) return;
    setPendingComment({ kind: 'text', range: selBubble.range, x: selBubble.x, y: selBubble.y, quote: selBubble.range.toString() });
    setComposerVisibility('team');
    setComposerBody('');
    setSelBubble(null);
  }

  // Entry point for "comment on a whole card" — no selection required. The
  // margin icon that appears on hovering a card's tag paragraph calls this
  // directly with that paragraph element; the composer then anchors to the
  // whole card (tag through cite end) instead of a text range.
  function openComposerFromCard(tagEl: Element) {
    const quote = (tagEl.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!quote) return;
    const rect = tagEl.getBoundingClientRect();
    setPendingComment({ kind: 'card', tagEl, x: rect.right, y: rect.top, quote });
    setComposerVisibility('team');
    setComposerBody('');
    setHoveredCardTag(null);
  }

  async function postComment() {
    const cont = containerRef.current;
    if (!pendingComment || !currentTeam || !currentUser || !composerBody.trim() || !cont) return;
    setComposerPosting(true);
    try {
      const paras = Array.from(cont.querySelectorAll('p'));
      let anchorKind: 'text' | 'card';
      let anchorText: string;
      let anchorParaIndex: number;
      let anchorOccurrence: number;
      if (pendingComment.kind === 'card') {
        anchorKind = 'card';
        anchorText = pendingComment.quote;
        anchorParaIndex = paras.indexOf(pendingComment.tagEl as HTMLParagraphElement);
        anchorOccurrence = 0;
      } else {
        anchorKind = 'text';
        const { range, quote } = pendingComment;
        const paraIndex = closestParagraphIndex(range.startContainer, paras);
        if (paraIndex === -1) return;
        const paraEl = paras[paraIndex];
        const paraText = paraEl.textContent ?? '';
        const startOffset = textOffsetWithinParagraph(paraEl, range.startContainer, range.startOffset);
        anchorText = quote;
        anchorParaIndex = paraIndex;
        anchorOccurrence = countOccurrences(paraText.slice(0, startOffset), quote);
      }
      const res = await window.warroom.docComments.add({
        teamId: currentTeam.id, docKey, docName: fileName,
        userId: currentUser.id, userName: currentUser.displayName,
        visibility: composerVisibility, anchorKind, anchorText,
        anchorParaIndex, anchorOccurrence, body: composerBody.trim(),
      });
      if (res.ok && res.data) setComments((prev) => [...prev, res.data]);
      setPendingComment(null);
      setComposerBody('');
    } finally {
      setComposerPosting(false);
    }
  }

  async function postReply(parent: DocComment, body: string, visibility: 'team' | 'private') {
    if (!currentTeam || !currentUser) return;
    const res = await window.warroom.docComments.add({
      teamId: currentTeam.id, docKey, docName: fileName,
      userId: currentUser.id, userName: currentUser.displayName,
      visibility, anchorKind: parent.anchor_kind, anchorText: parent.anchor_text,
      anchorParaIndex: parent.anchor_para_index, anchorOccurrence: parent.anchor_occurrence,
      body, parentId: parent.id,
    });
    if (res.ok && res.data) setComments((prev) => [...prev, res.data]);
  }

  // Any team member can resolve/reopen a thread, not just its author — see
  // resolve_doc_comment in supabase/schema.sql, called instead of a plain row
  // update since RLS only lets the author update a comment's own row.
  async function resolveComment(comment: DocComment, resolved: boolean) {
    if (!currentUser) return;
    setComments((prev) => prev.map((c) => (c.id === comment.id
      ? { ...c, resolved, resolved_at: resolved ? new Date().toISOString() : null, resolved_by_name: resolved ? currentUser.displayName : null }
      : c)));
    await window.warroom.docComments.resolve(comment.id, resolved, currentUser.displayName);
  }

  async function deleteComment(id: string) {
    setComments((prev) => prev.filter((c) => c.id !== id && c.parent_id !== id)); // optimistic — cascades to replies too
    await window.warroom.docComments.delete(id);
  }

  // Smooth-scroll the document to a heading and flash it briefly.
  const scrollToHeading = useCallback((id: string) => {
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-outline-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'auto', block: 'start' });
    setActiveHeadingId(id);
    // Pin the clicked heading as active for a moment. scrollIntoView fires a real
    // scroll event, which re-runs the scroll-driven "active heading" tracker below
    // — and short/bare headings (an organizational tag with no body under it, e.g.
    // "Case" immediately followed by "Procedurals") land within that tracker's 90px
    // detection window right alongside the NEXT heading down. Without this pin, the
    // tracker's "last heading within the window wins" rule silently overrides the
    // just-clicked heading with its neighbor a frame later — the reported "flashes
    // then jumps to the next heading down" bug.
    pinnedActiveUntilRef.current = Date.now() + 500;
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
      if (Date.now() < pinnedActiveUntilRef.current) return; // a click just set this — don't fight it
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

  // Re-apply / remove dark-mode fixes whenever the theme class on <html>
  // changes, OR the "keep speech docs light" setting is toggled — a doc kept
  // light in a dark app never gets the dimmed-highlight / lightened-border
  // treatment, same as if the whole app were in light mode.
  useEffect(() => {
    const sync = () => {
      if (!containerRef.current) return;
      const isDark = document.documentElement.classList.contains('dark') && !docLightInDark;
      if (isDark) {
        // Reset to Word's true raw color FIRST — applyDarkModeViewerFixes
        // computes its dim from whatever's currently on screen, so it must
        // never see an already-softened color as its starting point.
        resetHighlightReadability(containerRef.current);
        applyDarkModeViewerFixes(containerRef.current);
      } else {
        removeDarkModeViewerFixes(containerRef.current);
        applyHighlightReadability(containerRef.current, highlightReadability);
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [docLightInDark, highlightReadability]);

  // Keep refs in sync (so the async loadFile closure always reads fresh values)
  useEffect(() => { focusActiveRef.current = focusActive; }, [focusActive]);
  useEffect(() => { focusTypeRef.current = focusType; },     [focusType]);

  // Apply / remove focus mode whenever it toggles or changes type
  useEffect(() => {
    if (!containerRef.current) return;
    removeFocusMode(containerRef.current);
    if (focusActive) applyFocusMode(containerRef.current, focusType, headingClassesRef.current);
  }, [focusActive, focusType]);

  // Auto-load: a docPath (clicking a recent), an OC-imported case (carries a
  // docx via ocSource), or nothing (show the drop zone). Pane 0 reads from the
  // global view; extra compare panes (1/2) read from their own prop instead.
  const docPath = paneIndex === 0 ? ((view as any).docPath as string | undefined) : paneDocPath;
  const loadedPath = useRef('');
  useEffect(() => {
    if (ocCase) {
      loadOcCase(ocCase);
    } else if (docPath && docPath !== loadedPath.current) {
      loadFile(docPath);
    } else if (!docPath && (paneIndex !== 0 || view.kind === 'speech-doc')) {
      // No specific file requested (e.g. clicked the Cases + button, or an
      // extra pane was just cleared) — always show the drop zone.
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.kind, docPath, ocCaseId, ocUrl, paneIndex]);

  // Reset the preview-save confirmation when the viewed file changes.
  React.useEffect(() => { setOcPreviewSaved(false); }, [docPath, ocCaseId]);

  // Reset per-document transient state (find / auto-scroll / credibility).
  function resetDocState() {
    stopAuto();
    // Settings → "Start docs in Focus mode" — read live so a mid-session
    // change takes effect on the next doc opened, not just after a reload.
    if (localStorage.getItem('warroom-doc-start-focus') === 'true') setFocusActive(true);
    setFindOpen(false);
    setFindQuery('');
    findRangesRef.current = [];
    clearFindHighlights();
    setCredScores(null);
    setCredCards([]);
    setCredError('');
    // Clear outline/cards/word-count up front so a slow or failing render never
    // leaves the previous doc's headings on screen (the new doc's outline is
    // rebuilt once render completes below).
    setOutline([]);
    setActiveHeadingId(null);
    setDocWords(0);
    headingClassesRef.current = undefined;
    // A pending composer's Range is anchored into the doc about to be replaced —
    // meaningless (and possibly detached) once that DOM is torn down.
    setPendingComment(null);
  }

  // Render already-decoded docx bytes: paint the container, then build the
  // outline, cards, highlight warnings, and reading-time word count. Shared by
  // file loads and OC-case loads. `base64` (when provided) is sent to the main
  // process to resolve the doc's heading styles from styles.xml.
  function applyRender(bytes: Uint8Array, base64?: string) {
    setStep('viewing');
    // Clear stale structure immediately (covers callers that skip resetDocState,
    // e.g. checkOcChanges) so the outline never lingers from the previous doc.
    setOutline([]);
    setActiveHeadingId(null);
    headingClassesRef.current = undefined;
    setTimeout(async () => {
      try {
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

        // Remove any leading blank children (blank cover page present in some docx files).
        for (const child of Array.from(containerRef.current.children)) {
          const stripped = (child.textContent ?? '').replace(/[\s ​‌‍﻿]/g, '');
          if (stripped.length === 0 && !(child as HTMLElement).querySelector('img, svg')) {
            child.remove();
          } else {
            break;
          }
        }

        // NOTE: there used to be a `section.docx` loop here painting page
        // background/text/shadow/padding/max-width. It never ran: renderAsync is
        // called with className 'docx-render', so the pages are section.docx-render
        // and the selector matched nothing. Rather than "fix" the selector, it's
        // gone — page colour belongs to the `html.dark .docx-viewer-wrap` rule in
        // index.css, which re-evaluates on theme toggle, whereas these inline
        // colours were computed once at render and would have stranded an open doc
        // in the old theme. Page geometry is docx-preview's, from the real Word
        // page margins. A centred page-card look would be a deliberate CSS change.

        // Debate docs are read on screen, not printed — the real Word page's
        // left/right margins (often a full inch) just waste width, especially
        // with 2-3 panes open side by side. Stamp the true authored margin
        // onto each page (data-orig-p{l,r}) before scaling it down per the
        // Settings → "Speech doc margins" percentage, so later changes to
        // that setting (see the docMarginPct effect above) can always scale
        // from the real value instead of an already-shrunk one. Top/bottom
        // untouched.
        for (const page of Array.from(containerRef.current.children) as HTMLElement[]) {
          const pl = parseFloat(page.style.paddingLeft);
          const pr = parseFloat(page.style.paddingRight);
          if (Number.isFinite(pl)) { page.dataset.origPl = String(pl); page.style.paddingLeft = `${pl * (docMarginPct / 100)}px`; }
          if (Number.isFinite(pr)) { page.dataset.origPr = String(pr); page.style.paddingRight = `${pr * (docMarginPct / 100)}px`; }
        }
        // Tag every genuinely-highlighted element from its pristine, freshly-
        // rendered color BEFORE any color pass (dark-mode dim or readability
        // soften) touches it — every downstream consumer that needs to know
        // "is this a highlight" (focus mode, reading-time word counting) reads
        // this tag instead of re-inspecting computed background color, which
        // stops being reliable once that color has been recolored.
        tagHighlightElements(containerRef.current);
        const isDark = document.documentElement.classList.contains('dark') && !docLightInDark;
        if (isDark) {
          applyDarkModeViewerFixes(containerRef.current);
        } else {
          applyHighlightReadability(containerRef.current, highlightReadability);
        }

        // Resolve which paragraph styles are headings from styles.xml (handles
        // docs whose headings aren't literally Heading1–9). Falls back to the
        // built-in heading classes if the lookup fails or returns nothing.
        let headingClasses: HeadingClasses | undefined;
        if (base64) {
          try {
            const res = await (window.warroom as any).speechdoc.headingStyles(base64);
            if (res?.ok && res.data && typeof res.data === 'object') {
              const entries = Object.entries(res.data as Record<string, number>);
              if (entries.length) headingClasses = new Map(entries);
            }
          } catch { /* fall back to built-in heading detection */ }
        }
        headingClassesRef.current = headingClasses;
        forceHeadingFont(containerRef.current, headingClasses);

        // Apply focus mode if it was already active when this doc loaded
        if (focusActiveRef.current) applyFocusMode(containerRef.current, focusTypeRef.current, headingClasses);

        // Build the heading outline and extract cards; compute highlight-outlier
        // warnings (over/under-highlighted cards) and cross-reference them back
        // into the outline items so the outline can show warning badges.
        // If the doc has no Word/Verbatim heading styles, fall back to detecting
        // section headers by their formatting (boxed / bold-centered) so the
        // outline still works for hand-made round reports and Google Docs exports.
        let built = buildOutline(containerRef.current, headingClasses);
        if (built.length === 0) built = buildOutlineHeuristic(containerRef.current);
        const builtCards = buildCards(containerRef.current, headingClasses);
        computeHighlightWarnings(containerRef.current, builtCards, headingClasses);

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
        if (filePath) updateRecentCardCount(filePath, builtCards.length);

        // Settings → "Always open the outline": on shows it for every doc
        // opened, off leaves it closed every time. Read live (not cached) so
        // a mid-session Settings change takes effect on the next doc opened.
        setOutlineOpen(localStorage.getItem('warroom-doc-auto-outline') === 'true' && built.length > 0);

        // Reading-time word count for the freshly loaded doc — only words that
        // are actually read aloud (headings, tags, highlighted/underlined text,
        // and the bold author+date of cites), not every word in the file.
        // wantRanges also feeds the adaptive-auto-scroll pacing profile below,
        // off the exact same pass rather than walking the doc a second time.
        const spoken = collectSpoken(containerRef.current, { headingClasses, wantRanges: true });
        setDocWords(spoken.count);
        docWordsRef.current = spoken.count;
        speedProfileRef.current = scrollWrapRef.current
          ? buildSpeedProfile(scrollWrapRef.current, containerRef.current, spoken.ranges)
          : [];

        // Restore this doc's last scroll position, now that it's actually painted.
        const restoreKey = viewingScrollKeyRef.current;
        if (restoreKey && scrollWrapRef.current) {
          const saved = getSavedScroll(restoreKey);
          if (saved) scrollWrapRef.current.scrollTop = saved;
        }
      } catch (err) {
        console.error('Failed to render speech doc:', err);
        setError('Could not display this document.');
        setStep('error');
      }
    }, 0);
  }

  async function loadFile(path: string) {
    if (loadedPath.current === path) return;
    loadedPath.current = path;
    const name = path.split(/[/\\]/).pop() ?? path;
    setFilePath(path);
    setFileName(name);
    // Tell the wrapper which doc actually landed in this pane. Safe to call
    // before the render finishes: the auto-load effect compares against
    // loadedPath (already set above), so the resulting prop change is a no-op
    // rather than a reload loop.
    onPaneDocPathChange?.(path);
    setStep('loading');
    setError('');
    setBusy('speech-doc', 'Loading…');
    try {
      const result = await window.warroom.fs.readDocxBytes(path);
      if (!result.ok || !result.base64) throw new Error(result.error ?? 'Could not read file');
      const binary = atob(result.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      resetDocState();
      viewingScrollKeyRef.current = path;
      applyRender(bytes, result.base64);

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

  // Load an OpenCaseList-imported case: render its docx from the localStorage
  // cache when present (no network), else download once via OpenCaseList, cache
  // the bytes, then render. Keyed in localStorage on the source URL.
  async function loadOcCase(oc: any) {
    const url: string = oc.ocSource.url;
    const key = `oc:${url}`;
    if (loadedPath.current === key) return;
    loadedPath.current = key;
    setFilePath(key); // synthetic key — drives per-doc cx / credibility / dismissals
    setFileName(oc.name);
    setStep('loading');
    setError('');
    setBusy('speech-doc', 'Loading…');
    try {
      let base64 = getOcCached(url);
      if (!base64) {
        const fetchRes = await window.warroom.opencaselist.fetchFileToTemp(url);
        if (!fetchRes.ok) throw new Error(fetchRes.error ?? 'Could not download file.');
        const readRes = await window.warroom.fs.readFileBytes(fetchRes.tempPath);
        if (!readRes.ok || !readRes.base64) throw new Error(readRes.error ?? 'Could not read file.');
        base64 = readRes.base64;
        setOcCached(url, base64);
      }
      ocBytesRef.current = base64;
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      resetDocState();
      setOcCheckResult(null);
      viewingScrollKeyRef.current = key;
      applyRender(bytes, base64);
    } catch (e: any) {
      setError(`Failed to open imported case: ${e?.message ?? 'unknown error'}`);
      setStep('error');
      loadedPath.current = '';
    } finally {
      setBusy('speech-doc', null);
    }
  }

  // Re-fetch an OC case from OpenCaseList (bypassing the cache) and reload it if
  // the file changed since import. Refreshes the cached bytes + stored byteLen.
  async function checkOcChanges() {
    if (!ocCase) return;
    const url: string = (ocCase as any).ocSource.url;
    setOcChecking(true);
    setOcCheckResult(null);
    try {
      const fetchRes = await window.warroom.opencaselist.fetchFileToTemp(url);
      if (!fetchRes.ok) throw new Error(fetchRes.error ?? 'fetch failed');
      const readRes = await window.warroom.fs.readFileBytes(fetchRes.tempPath);
      if (!readRes.ok || !readRes.base64) throw new Error('read failed');
      const newLen = atob(readRes.base64).length;
      const prevLen = (ocCase as any).ocSource.byteLen as number | undefined;
      const changed = prevLen !== undefined && newLen !== prevLen;
      setOcCached(url, readRes.base64);
      setOcCheckResult(changed ? 'changed' : 'up-to-date');
      if (changed) {
        ocBytesRef.current = readRes.base64;
        await update((d) => ({
          ...d,
          cases: { ...d.cases, [ocCase.id]: { ...d.cases[ocCase.id], ocSource: { ...(ocCase as any).ocSource, byteLen: newLen } } },
        }));
        const binary = atob(readRes.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        applyRender(bytes, readRes.base64);
      }
    } catch {
      setOcCheckResult(null);
    } finally {
      setOcChecking(false);
    }
  }

  async function pickFile() {
    const paths = await window.warroom.dialog.openFiles(['docx']);
    if (!paths || paths.length === 0) return;
    await importDocs(paths);
  }

  /**
   * Import every .docx found (recursively) inside a folder the user picks, filed
   * into a brand-new Warroom folder named after that OS folder. `folderName` isn't
   * guaranteed unique among existing folders — that's fine, folders here are just
   * labels (see caseFolders.ts), so a duplicate name is harmless, not a conflict.
   */
  async function pickFolder() {
    const res = await window.warroom.dialog.openFolderOfDocx(['docx']);
    if (!res) return; // user canceled
    if (res.paths.length === 0) {
      setError(`No .docx files found in "${res.folderName}".`);
      setStep('error');
      return;
    }
    const docs = res.paths.map(p => ({ path: p, name: p.split(/[/\\]/).pop() ?? p }));
    addRecents(docs);
    setRecents(getRecents());
    updateFolders((data) => {
      const withFolder = createFolder(data, res.folderName, null);
      const newFolder = withFolder.folders[withFolder.folders.length - 1];
      return docs.reduce((d, doc) => moveItem(d, itemKeyForDoc(doc.path), newFolder.id), withFolder);
    });
    loadedPath.current = '';
    await loadFile(docs[0].path);
  }

  /**
   * Import one or more speech docs: every doc is saved to recents immediately (so
   * the whole batch shows up in the sidebar under Cases at once), then the first
   * one is opened. Saving before loading means a doc that fails to render still
   * lands in the sidebar rather than vanishing.
   */
  async function importDocs(paths: string[]) {
    const docs = paths.map(p => ({ path: p, name: p.split(/[/\\]/).pop() ?? p }));
    addRecents(docs);
    setRecents(getRecents());
    loadedPath.current = '';
    await loadFile(docs[0].path);
  }

  async function exportDocx() {
    const base64 = isOc ? ocBytesRef.current : (await window.warroom.fs.readFileBytes(filePath)).base64;
    if (!base64) return;
    const outName = /\.docx$/i.test(fileName) ? fileName : `${fileName}.docx`;
    await window.warroom.dialog.saveBuffer(
      base64,
      outName,
      [{ name: 'Word Document', extensions: ['docx'] }]
    );
  }

  function reset() {
    setStep('idle');
    setFilePath('');
    setFileName('');
    loadedPath.current = '';
    viewingScrollKeyRef.current = null;
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
      <div className="flex flex-col h-full p-3 gap-4 relative" onMouseDownCapture={onFocusPane}>
        {canAddPane && onAddPane && (
          <button
            className="absolute top-2 right-9 flex items-center justify-center w-6 h-6 rounded-md transition z-10"
            style={{ color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            title="Compare with another document"
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            onClick={onAddPane}
          >
            <IcoAddPane />
          </button>
        )}
        {paneIndex !== 0 && onCloseExtraPane && (
          <button
            className="absolute top-2 right-2 flex items-center justify-center w-6 h-6 rounded-md transition z-10"
            style={{ color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            title="Close this pane"
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            onClick={onCloseExtraPane}
          >
            <IcoClose />
          </button>
        )}
        <div
          className="flex flex-col items-center justify-center p-6 text-center border-2 rounded-sm cursor-pointer transition"
          style={{
            borderStyle: 'dashed',
            borderColor: dragActive ? 'var(--accent)' : 'var(--border-med)',
            background: dragActive ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
          }}
          onClick={pickFile}
          {...dragHandlers}
          onDrop={async (e) => {
            e.preventDefault();
            setDragActive(false);
            const files = Array.from(e.dataTransfer.files);
            if (files.length === 0) return;
            const paths = await window.warroom.dialog.resolveDroppedFiles(files, ['docx']);
            if (paths.length > 0) { importDocs(paths); return; }
            setError('Those files could not be opened — speech docs must be .docx.');
            setStep('error');
          }}
        >
          <div className="text-sm font-medium text-ink/60 mb-2">
            {dragActive ? 'Drop to add' : 'Drop speech docs here (.docx)'}
          </div>
          <div className="text-xs text-ink/40">drop several at once, or click to open file picker</div>
          <button
            onClick={(e) => { e.stopPropagation(); pickFolder(); }}
            className="mt-3 text-xs underline text-ink/50 hover:text-ink/80 transition"
          >
            or import a whole folder of speech docs
          </button>
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
    <div
      className="flex flex-col h-full relative"
      /* No borderLeft here: the multi-pane wrapper renders a real divider
         element between panes, so a border too would draw a double line. */
      onMouseDownCapture={onFocusPane}
    >
      {/* Toolbar */}
      {/* NOTE: no `overflow-hidden` here — the toolbar buttons' hover tooltips are
          absolutely positioned *below* the bar, so clipping this row silently
          swallows every tooltip in the pane. Toolbar contents are kept from
          overflowing by shrinking instead: the title flexes with min-w-0, and in
          multi-pane the analysis tools collapse into the ⋯ overflow menu. */}
      <div className="border-b border-line px-2 py-0.5 flex items-center gap-1.5 shrink-0">
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
          <ToolbarToggle
            active={findOpen}
            label="Find in document (⌘F)"
            icon={<IcoSearch active={findOpen} />}
            onClick={() => {
              setFindOpen(v => !v);
              window.setTimeout(() => findInputRef.current?.focus(), 0);
            }}
          />
          {!toolbarCompact && (
            <>
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
            </>
          )}
          {canAddPane && onAddPane && (
            <>
              <div style={{ width: 1, height: 18, background: 'var(--border-subtle)', margin: '0 2px' }} />
              <ToolbarToggle
                active={false}
                label="Compare with another document"
                icon={<IcoAddPane />}
                onClick={onAddPane}
              />
            </>
          )}
        </div>

        {/* Document title (+ import provenance) — sits between the tool cluster
            and the AI tools so the open case / speech doc is always identified. */}
        <div className="group flex-1 flex items-center gap-2 min-w-0 px-2.5 overflow-visible">
          {titleEditing ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={commitRenameTitle}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitRenameTitle(); }
                else if (e.key === 'Escape') { e.preventDefault(); setTitleEditing(false); }
              }}
              className="text-[13px] font-semibold min-w-0 outline-none rounded px-1 -mx-1"
              style={{ color: 'rgb(var(--ink-rgb))', background: 'var(--bg-input)', border: '1px solid var(--accent, #4285F4)', width: 200 }}
            />
          ) : (
            <span
              className="text-[13px] font-semibold shrink whitespace-nowrap relative z-10 cursor-text"
              title="Double-click to rename"
              onDoubleClick={startRenameTitle}
              style={{
                color: 'rgb(var(--ink-rgb))',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%',
                transition: 'max-width 0.15s ease, overflow 0s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.overflow = 'visible';
                (e.currentTarget as HTMLElement).style.maxWidth = 'none';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.overflow = 'hidden';
                (e.currentTarget as HTMLElement).style.maxWidth = '100%';
              }}
            >
              {fileName.replace(/\.docx$/i, '')}
            </span>
          )}
          {paneIndex !== 0 && onCloseExtraPane && (
            <button
              className="shrink-0 flex items-center justify-center w-6 h-6 rounded-md transition"
              style={{ color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none', cursor: 'pointer' }}
              title="Close this pane"
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              onClick={onCloseExtraPane}
            >
              <IcoClose />
            </button>
          )}
          {revealPath && (
            <button
              className="shrink-0 flex items-center justify-center w-6 h-6 rounded-md opacity-0 group-hover:opacity-100 transition"
              style={{ color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none', cursor: 'pointer' }}
              title={`Reveal in ${isMac ? 'Finder' : 'File Explorer'}`}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              onClick={async () => {
                const res = await (window.warroom as any).shell.showItemInFolder(revealPath);
                if (res && res.ok === false && res.error) alert(res.error);
              }}
            >
              <IcoReveal />
            </button>
          )}
          {isOc && ocCase && (
            <OcSourcePill
              teamName={(ocCase as any).ocSource.teamName}
              checking={ocChecking}
              checkResult={ocCheckResult}
              onCheck={checkOcChanges}
            />
          )}
          {isOc && ocCase ? (
            <TaggedInIndicator
              type="case"
              localRefId={ocCase.id}
              matchKey="url"
              matchValue={(ocCase as any).ocSource.url}
            />
          ) : (
            filePath && <TaggedInIndicator type="speechdoc" localRefId={filePath} />
          )}
          {ocPreview && (
            <button
              className="text-[11px] shrink-0 px-2 py-0.5 rounded-md transition-all whitespace-nowrap"
              style={{
                color: ocPreviewSaved ? '#34c759' : 'var(--accent)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                cursor: ocPreviewSaved ? 'default' : 'pointer',
              }}
              disabled={ocPreviewSaved}
              title={ocPreviewSaved ? 'Saved to your Cases' : `Save this case to your sidebar`}
              onClick={async () => {
                if (ocPreviewSaved) return;
                const caseSide = ocPreview.side === 'Aff' ? 'aff' : 'neg';
                const caseName = `${ocPreview.teamName} – ${ocPreview.label}`;
                const id = crypto.randomUUID();
                let byteLen: number | undefined;
                try {
                  const readRes = await window.warroom.fs.readFileBytes(filePath);
                  if (readRes.ok && readRes.base64) {
                    byteLen = atob(readRes.base64).length;
                    if (readRes.base64.length <= 2_500_000) {
                      localStorage.setItem('warroom-oc-docx-' + ocPreview.url, readRes.base64);
                    }
                  }
                } catch { /* quota */ }
                await update((db) => ({
                  ...db,
                  cases: {
                    ...db.cases,
                    [id]: { id, name: caseName, side: caseSide as any, blocks: [], ocSource: { teamName: ocPreview.teamName, label: ocPreview.label, url: ocPreview.url, importedAt: new Date().toISOString(), byteLen } },
                  },
                }));
                setOcPreviewSaved(true);
                setTimeout(() => setView({ kind: 'case', caseId: id }), 600);
              }}
            >
              {ocPreviewSaved ? 'Saved!' : `+ Save to Cases`}
            </button>
          )}
        </div>

        {/* AI analysis tools — labeled so their purpose is obvious. In multi-pane
            compare view there's no room for two labelled pills per pane, so
            these fold into the ⋯ menu (with their labels intact) alongside the
            reading-time and send-to-flow tools. */}
        {toolbarCompact ? (
          <ToolbarOverflowMenu
            items={[
              {
                label: 'Reading time',
                hint: 'Reading time & auto-scroll',
                icon: <IcoClock active={readOpen} />,
                active: readOpen,
                onClick: () => setReadOpen(v => { const next = !v; if (next) setFlowSendOpen(false); return next; }),
              },
              {
                label: 'Send to flow',
                hint: 'Send selection to a flow',
                icon: <IcoSendFlow active={flowSendOpen} />,
                active: flowSendOpen,
                onClick: () => setFlowSendOpen(v => { const next = !v; if (next) setReadOpen(false); return next; }),
              },
              {
                label: 'Credibility',
                hint: 'Score card credibility',
                icon: <IcoShield active={credOpen} />,
                active: credOpen,
                ai: true,
                onClick: () => setCredOpen(v => { const next = !v; if (next) setCxOpen(false); return next; }),
              },
              {
                label: 'Cross-Ex',
                hint: 'Practice cross-examination on this doc',
                icon: <IcoCrossEx active={cxOpen} />,
                active: cxOpen,
                ai: true,
                onClick: () => setCxOpen(v => { const next = !v; if (next) setCredOpen(false); return next; }),
              },
            ]}
            extra={<HighlightReadabilitySlider />}
          />
        ) : (
          <>
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
          </>
        )}

        {COMMENTS_UI_ENABLED && currentTeam && (
          <IconBtn
            icon={<IcoComment active={commentsVisible} />}
            label={comments.length ? `Comments (${comments.length}) · ⌘⌥M` : 'Comments · ⌘⌥M'}
            active={commentsVisible}
            onClick={toggleCommentsVisible}
          />
        )}

        {!toolbarCompact && <HighlightReadabilityMenu />}

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
            // OC cases have no local file — share the cached docx bytes directly.
            const base64 = isOc ? ocBytesRef.current : (await window.warroom.fs.readFileBytes(filePath)).base64;
            return { filename: /\.docx$/i.test(fileName) ? fileName : `${fileName}.docx`, base64: base64 ?? '' };
          }}
          onClose={() => setShareOpen(false)}
          onOpenInWord={isOc ? undefined : () => window.warroom.shell.openPath(filePath)}
          onExportDocx={exportDocx}
        />
      )}

      {/* New-comment composer — floats near the selection that triggered it. */}
      {pendingComment && (
        <div
          className="fixed z-50 rounded-xl p-3"
          style={{
            left: Math.max(12, pendingComment.x - 260), top: pendingComment.y + 12, width: 280,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-elevated)',
          }}
        >
          <div
            className="text-[11px] leading-snug mb-2 pl-2 line-clamp-3"
            style={{ color: 'var(--nav-inactive-color)', borderLeft: '2px solid rgba(147,51,234,0.5)' }}
          >
            {pendingComment.kind === 'card' ? `Card — "${pendingComment.quote}"` : `"${pendingComment.quote}"`}
          </div>
          <div className="mb-2">
            <MentionableTextarea
              value={composerBody}
              onChange={setComposerBody}
              placeholder="Comment…"
              rows={3}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); setPendingComment(null); }
                else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); postComment(); }
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex rounded-lg p-0.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
              {([
                { value: 'team' as const, label: 'Team', title: 'Visible to your whole team (default)' },
                { value: 'private' as const, label: 'Only me', title: 'Visible only to you' },
              ]).map((o) => (
                <button
                  key={o.value}
                  onClick={() => setComposerVisibility(o.value)}
                  title={o.title}
                  className="px-2 py-1 rounded-md text-[11px] font-semibold transition"
                  style={{
                    background: composerVisibility === o.value ? 'var(--bg-card)' : 'transparent',
                    color: composerVisibility === o.value ? 'rgb(var(--ink-rgb))' : 'var(--nav-inactive-color)',
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPendingComment(null)}
                title="Cancel (Esc)"
                className="text-[11.5px] font-medium px-2 py-1 rounded-md transition"
                style={{ color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={postComment}
                disabled={!composerBody.trim() || composerPosting}
                title="Post comment (⌘Enter)"
                className="text-[11.5px] font-semibold px-2.5 py-1 rounded-md transition"
                style={{
                  color: '#fff', background: 'var(--accent, #4285F4)', border: 'none',
                  cursor: composerBody.trim() ? 'pointer' : 'default',
                  opacity: composerBody.trim() && !composerPosting ? 1 : 0.5,
                }}
              >
                Post
              </button>
            </div>
          </div>
        </div>
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
          headingClasses={headingClassesRef.current}
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

      {/* Outline pull-tab + document + cross-ex side panel. overflow-hidden keeps
          the fixed-ish-width side panels (outline overlay, cross-ex, credibility)
          from visually spilling into a neighboring pane when this pane is
          narrower than the panel's preferred width. */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        {step === 'viewing' && !outlineOpen && (
          <OutlinePullTab count={outline.length} onClick={() => setOutlineOpen(true)} />
        )}
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
        <div
          ref={scrollWrapRef}
          className={`flex-1 overflow-y-auto scroll-thin docx-viewer-wrap min-w-0 relative${docLightInDark ? ' docx-force-light' : ''}`}
        >
          {step === 'loading' && <LoadingPanel message="Loading document…" />}
          <div
            ref={containerRef}
            onClick={onDocClick}
            onContextMenu={onDocContextMenu}
            style={{ display: step === 'viewing' ? undefined : 'none' }}
          />
          {cardMenu && (
            <div
              className="fixed z-50 rounded-lg shadow-lg py-1 text-[13px]"
              style={{
                left: cardMenu.x, top: cardMenu.y,
                background: 'var(--panel-bg, #1f1f1f)', border: '1px solid var(--panel-border, rgba(255,255,255,0.1))',
                minWidth: 140,
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-[var(--nav-hover-bg)]"
                onClick={() => { copyCardEls(cardMenu.els); setCardMenu(null); }}
              >
                Copy card
              </button>
            </div>
          )}
          {selBubble && (
            <div
              className="fixed z-40 pointer-events-none px-1.5 py-0.5 rounded text-[11px] font-medium"
              style={{
                left: selBubble.x + 6, top: selBubble.y + 6,
                background: 'rgba(66, 133, 244, 0.92)', color: '#fff',
              }}
            >
              {selBubble.count} word{selBubble.count === 1 ? '' : 's'}
            </div>
          )}
          {COMMENTS_UI_ENABLED && selBubble && currentTeam && commentsVisible && (
            <button
              className="fixed z-40 flex items-center justify-center rounded-full transition"
              style={{
                left: selBubble.x + 6, top: selBubble.y + 26, width: 24, height: 24,
                background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                boxShadow: 'var(--shadow-elevated)', color: 'var(--nav-inactive-color)', cursor: 'pointer',
              }}
              title="Add comment"
              onMouseDown={(e) => e.preventDefault()} // don't let the click itself collapse the selection
              onClick={openComposerFromSelection}
            >
              <IcoComment />
            </button>
          )}
          {COMMENTS_UI_ENABLED && hoveredCardTag && currentTeam && commentsVisible && (
            <button
              className="fixed z-40 flex items-center justify-center rounded-full transition"
              style={{
                left: hoveredCardTag.rect.right + 6, top: hoveredCardTag.rect.top - 2, width: 22, height: 22,
                background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                boxShadow: 'var(--shadow-elevated)', color: 'var(--nav-inactive-color)', cursor: 'pointer',
              }}
              title="Comment on this card"
              onMouseEnter={cancelCardHoverClear}
              onMouseLeave={clearCardHoverSoon}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const el = containerRef.current?.querySelector(`[data-cred-id="${hoveredCardTag.id}"]`);
                if (el) openComposerFromCard(el);
              }}
            >
              <IcoComment />
            </button>
          )}
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
        {COMMENTS_UI_ENABLED && commentsVisible && step === 'viewing' && (
          <CommentsPanel
            comments={comments}
            currentUserId={currentUser?.id}
            teamMembers={teamMembers}
            onScrollTo={scrollToComment}
            onDelete={deleteComment}
            onReply={postReply}
            onResolve={resolveComment}
            onClose={toggleCommentsVisible}
          />
        )}
      </div>
    </div>
  );
}

// ── Multi-pane wrapper ──────────────────────────────────────────────────────
// Lets up to three speech docs sit side by side for comparison. Pane 0 is the
// "main" doc, driven by the app's global view (unchanged behavior — every
// existing open-doc call site in the app targets pane 0). Panes 1 and 2 are
// opened from a "compare doc" button in any pane's toolbar and load whatever
// file the user drops/browses into them, independent of the main doc.
//
// Pane widths and per-pane outline-open state live here (not inside each
// DocPaneViewer) so this wrapper can coordinate cross-pane layout and persist
// both — plus a sidebar-expanded override — keyed to the exact, ordered set
// of doc paths currently open (see utils/docComboLayout.ts). A different
// combination of docs, or the same docs in different panes, starts fresh.

const OUTLINE_SPACE_PX = 248; // matches OutlinePanel's own width
// In 'space' mode, how much of the viewport is left showing the pane *before*
// the generous pair — so the row reads as "scrolled", not "one pane crushed".
const SPACE_PEEK_FRACTION = 0.15;
// Divider width, drag-enabled vs not. Kept as constants because the auto-scroll
// offset math has to add up the same widths the row actually renders.
const DIVIDER_PX = 5;
const DIVIDER_LOCKED_PX = 1;
// Drag a divider within this many px of an exact 50/50 split between its two
// panes and it snaps there — a small magnetic zone around dead center.
const DIVIDER_SNAP_PX = 10;

/**
 * Pixel width for every open pane, given which (if any) pane has its outline
 * open and which layout method is active. Each pane's outline still renders
 * *inside* that pane at its own left edge (DocPaneViewer is unchanged) — this
 * function's job is just to make sure that pane's box is wide enough (and its
 * neighbor's narrow enough / wide enough) that the outline visually lands in
 * the right place relative to the other panes.
 */
function computePaneWidthsPx(
  n: number,
  paneOutlineOpen: boolean[],
  paneWeights: number[],
  layoutMethod: 'squish' | 'space',
  rowWidthPx: number,
): number[] {
  if (n <= 0 || rowWidthPx <= 0) return Array(n).fill(0);
  const weights = paneWeights.slice(0, n);
  const totalWeight = weights.reduce((a, b) => a + b, 0) || n;
  const base = weights.map((w) => (w / totalWeight) * rowWidthPx);

  const activeIdx = paneOutlineOpen.findIndex((v, i) => i < n && v);
  if (activeIdx === -1 || n === 1) return base;

  if (layoutMethod === 'squish') {
    // Borrow the outline's width from one neighbor (left, or right for the
    // leftmost pane) — total stays within the viewport, no scrolling. The
    // active pane's own reading width is unaffected; the neighbor absorbs it.
    const neighbor = activeIdx > 0 ? activeIdx - 1 : activeIdx + 1;
    const steal = Math.min(OUTLINE_SPACE_PX, Math.max(0, base[neighbor] - 120));
    const widths = [...base];
    widths[neighbor] -= steal;
    widths[activeIdx] += steal;
    return widths;
  }

  // 'space': the active pane and its "partner" — the next pane if one exists,
  // else the previous one — plus the outline column together fill ~85% of the
  // viewport, with the remaining ~15% left as a peek of whatever pane sits
  // before them.
  //
  // Every OTHER pane keeps its natural width, untouched. They go out of view by
  // being *scrolled past*, not by being squeezed: the row's total width now
  // exceeds the viewport, `overflow-x-auto` makes that scrollable, and the
  // effect below scrolls the pair into place. Crushing them to a sliver instead
  // (what this used to do) read as "the app broke my first doc" — and a pane a
  // few dozen pixels wide can't render its own toolbar sanely either.
  const partnerIdx = activeIdx < n - 1 ? activeIdx + 1 : activeIdx - 1;
  const peek = SPACE_PEEK_FRACTION * rowWidthPx;
  const readingShare = Math.max(160, (rowWidthPx - OUTLINE_SPACE_PX - peek) / 2);
  return base.map((w, i) => {
    if (i === activeIdx) return readingShare + OUTLINE_SPACE_PX;
    if (i === partnerIdx) return readingShare;
    return w;
  });
}

export default function SpeechDocViewer() {
  const view = useApp((s) => s.view);
  const extraDocPanes = useApp((s) => s.extraDocPanes);
  const setExtraDocPane = useApp((s) => s.setExtraDocPane);
  const setMainDocPath = useApp((s) => s.setMainDocPath);
  const focusedPane = useApp((s) => s.focusedPane);
  const setFocusedPane = useApp((s) => s.setFocusedPane);
  const currentTeam = useApp((s) => s.currentTeam);
  const forceChatOpen = useApp((s) => s.forceChatOpen);
  const forceGeminiOpen = useApp((s) => s.forceGeminiOpen);

  // One realtime subscription for doc comments, owned here rather than by each
  // pane: up to 3 DocPaneViewer instances can be mounted at once, and main.ts
  // keeps only a single active Supabase channel per `docComments:subscribe`
  // call — if each pane subscribed independently, whichever unmounted first
  // would call `unsubscribe` and kill live updates for every other open pane.
  // This wrapper is the one instance that always exists, so it's the one safe
  // owner. Panes never call subscribe/unsubscribe themselves; they just listen
  // for the window event this re-broadcasts and filter by their own doc_key.
  useEffect(() => {
    if (!currentTeam) return;
    window.warroom.docComments.subscribe(currentTeam.id);
    const off = window.warroom.docComments.onChange((p) => {
      window.dispatchEvent(new CustomEvent('warroom-doc-comment-change', { detail: p }));
    });
    return () => { off(); window.warroom.docComments.unsubscribe(); };
  }, [currentTeam?.id]);

  const pane0Path = view.kind === 'speech-doc' ? (view as any).docPath as string | undefined : undefined;
  // "+ compare doc" opens an empty pane awaiting a drop — that's ephemeral UI
  // state, not a real pane's content, so it's tracked purely locally here
  // rather than written into extraDocPanes (the persisted, session-restored
  // store). Writing it there used to leave a phantom empty third pane behind
  // any time the app restarted before a file actually landed in it — the
  // store had no way to tell "pending, about to be filled" apart from "a
  // real, saved pane" once it was serialized. Cleared the moment either a
  // real file is dropped into it (below) or the pane's own × is clicked.
  const [pendingEmptySlot, setPendingEmptySlot] = useState<0 | 1 | null>(null);
  useEffect(() => {
    if (pendingEmptySlot !== null && extraDocPanes[pendingEmptySlot] !== undefined) setPendingEmptySlot(null);
  }, [extraDocPanes, pendingEmptySlot]);
  const pendingSlotOpen = pendingEmptySlot !== null && extraDocPanes[pendingEmptySlot] === undefined;
  const openExtraCount = extraDocPanes.filter((p) => p !== undefined).length + (pendingSlotOpen ? 1 : 0);
  const openPaneCount = 1 + openExtraCount;
  const canAddPane = openExtraCount < 2;
  const addPane = () => {
    const slot: 0 | 1 = extraDocPanes[0] === undefined ? 0 : 1;
    setPendingEmptySlot(slot);
    setFocusedPane((slot + 1) as 1 | 2);
  };

  // Settings → outline layout method ('space' default). Read live so a
  // mid-session Settings change applies on the next outline toggle.
  const [layoutMethod, setLayoutMethod] = useState<'squish' | 'space'>(
    () => (localStorage.getItem('warroom-doc-outline-layout') === 'squish' ? 'squish' : 'space')
  );
  useEffect(() => {
    const onChange = (e: Event) => {
      const v = (e as CustomEvent).detail?.method;
      if (v === 'squish' || v === 'space') setLayoutMethod(v);
    };
    window.addEventListener('warroom-doc-outline-layout-changed', onChange);
    return () => window.removeEventListener('warroom-doc-outline-layout-changed', onChange);
  }, []);

  // Identity for the currently-open combination of docs, in pane order.
  // null (fewer than 2 resolved panes, or pane 0 is an OC case rather than a
  // plain file) means "don't persist" — see comboKeyFor.
  const panePaths = [pane0Path, extraDocPanes[0], extraDocPanes[1]].slice(0, openPaneCount);
  const comboKey = comboKeyFor(panePaths);

  const [paneOutlineOpen, setPaneOutlineOpenState] = useState<boolean[]>([false, false, false]);
  const [paneWeights, setPaneWeights] = useState<number[]>([1, 1, 1]);

  // Re-hydrate outline/width state whenever the combo actually changes, and
  // register the combo so it appears in the sidebar's compare-views list.
  const lastComboRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (comboKey === lastComboRef.current) return;
    // Whatever combo we were just in gets superseded, so editing a pane updates
    // the view you're in rather than spawning a near-identical one. Passing the
    // previous key unconditionally is intentional: rememberComboView declines to
    // supersede when the new key already exists, which is the only case that
    // should preserve both, and unlike session-tracking it survives hot-reload.
    const prevKey = lastComboRef.current ?? null;
    lastComboRef.current = comboKey;
    rememberComboView(comboKey, panePaths.filter((p): p is string => !!p), prevKey);
    // Read AFTER remembering: when this edit superseded the previous combo,
    // that combo's pane widths and outline state were carried onto this key,
    // and re-reading is what keeps them applied live instead of snapping back
    // to defaults every time a pane's doc changes.
    const saved = loadComboLayout(comboKey);
    const nextOutline: boolean[] = [false, false, false];
    saved?.outlineOpen?.forEach((v, i) => { if (i < 3) nextOutline[i] = v; });
    setPaneOutlineOpenState(nextOutline);
    const nextWeights: number[] = [1, 1, 1];
    saved?.paneWidths?.forEach((v, i) => { if (i < 3 && v > 0) nextWeights[i] = v; });
    setPaneWeights(nextWeights);
  }, [comboKey]);

  // Force-collapse the sidebar the moment a 2nd pane opens (default), unless
  // this exact combo has a remembered override; force it back open at 1 pane.
  // The Warroom AI panel and team chat panel carry the same logic — they're
  // side panels too, and multi-pane leaves no room for them either. Unlike
  // the sidebar (which just toggles collapsed/expanded), these panels default
  // to *closed* far more often, so instead of always force-opening them on
  // the way out, we restore whatever they were set to right before this
  // multi-pane stretch began.
  const wasMultiRef = useRef(false);
  const appliedOverrideForRef = useRef<string | null>(null);
  const chatWasOpenRef = useRef(false);
  const geminiWasOpenRef = useRef(false);
  useEffect(() => {
    const isMulti = openExtraCount > 0;
    if (!isMulti) {
      if (wasMultiRef.current) {
        window.dispatchEvent(new CustomEvent('warroom-force-sidebar-collapse', { detail: { collapsed: false } }));
        forceChatOpen(chatWasOpenRef.current);
        forceGeminiOpen(geminiWasOpenRef.current);
      }
      wasMultiRef.current = false;
      appliedOverrideForRef.current = null;
      return;
    }
    if (!wasMultiRef.current) {
      window.dispatchEvent(new CustomEvent('warroom-force-sidebar-collapse', { detail: { collapsed: true } }));
      const st = useApp.getState();
      chatWasOpenRef.current = st.chatOpen;
      geminiWasOpenRef.current = st.geminiOpen;
      if (st.chatOpen) forceChatOpen(false);
      if (st.geminiOpen) forceGeminiOpen(false);
    }
    wasMultiRef.current = true;
    if (comboKey && appliedOverrideForRef.current !== comboKey) {
      appliedOverrideForRef.current = comboKey;
      const saved = loadComboLayout(comboKey);
      if (typeof saved?.sidebarExpanded === 'boolean') {
        window.dispatchEvent(new CustomEvent('warroom-force-sidebar-collapse', { detail: { collapsed: !saved.sidebarExpanded } }));
      }
      if (typeof saved?.chatOpen === 'boolean') forceChatOpen(saved.chatOpen);
      if (typeof saved?.geminiOpen === 'boolean') forceGeminiOpen(saved.geminiOpen);
    }
  }, [openExtraCount, comboKey]);

  // Outline toggles from any pane land here. 'space' mode only makes sense
  // for one outline at a time (it's "a whole new space", not several) —
  // opening one closes any other. Persists into the current combo.
  const handleOutlineOpenChange = useCallback((paneIdx: number, open: boolean) => {
    setPaneOutlineOpenState((prev) => {
      const next = [...prev];
      if (open && layoutMethod === 'space') next.fill(false);
      next[paneIdx] = open;
      saveComboLayout(comboKey, { outlineOpen: next.slice(0, openPaneCount) });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutMethod, comboKey, openPaneCount]);

  // ── Row width measurement + pane sizing ──────────────────────────────────
  const scrollRowRef = useRef<HTMLDivElement>(null);
  const [rowWidthPx, setRowWidthPx] = useState(0);
  useEffect(() => {
    const el = scrollRowRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setRowWidthPx(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const paneWidthsPx = computePaneWidthsPx(openPaneCount, paneOutlineOpen, paneWeights, layoutMethod, rowWidthPx);
  const anyOutlineOpen = paneOutlineOpen.slice(0, openPaneCount).some(Boolean);
  const dividersEnabled = !(layoutMethod === 'space' && anyOutlineOpen);

  // Auto-scroll so the generous pair (active pane + its outline + partner) sits
  // in view, leaving SPACE_PEEK_FRACTION of the viewport showing the edge of
  // whatever pane comes before them — that peek is how an untouched, full-width
  // pane advertises "I'm still here, scroll left".
  useEffect(() => {
    if (layoutMethod !== 'space' || !scrollRowRef.current) return;
    const activeIdx = paneOutlineOpen.findIndex((v, i) => i < openPaneCount && v);
    if (activeIdx === -1) { scrollRowRef.current.scrollTo({ left: 0, behavior: 'smooth' }); return; }
    const partnerIdx = activeIdx < openPaneCount - 1 ? activeIdx + 1 : activeIdx - 1;
    const firstOfPair = Math.min(activeIdx, partnerIdx);
    let offset = 0;
    // Dividers are always locked-width here (space mode + an open outline is
    // exactly the condition that disables dragging), so use that width.
    for (let i = 0; i < firstOfPair; i++) offset += paneWidthsPx[i] + DIVIDER_LOCKED_PX;
    scrollRowRef.current.scrollTo({
      left: Math.max(0, offset - SPACE_PEEK_FRACTION * rowWidthPx),
      behavior: 'smooth',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutMethod, JSON.stringify(paneOutlineOpen.slice(0, 3)), openPaneCount, rowWidthPx]);

  // ── Divider dragging ──────────────────────────────────────────────────────
  const paneWeightsRef = useRef(paneWeights);
  useEffect(() => { paneWeightsRef.current = paneWeights; }, [paneWeights]);

  function onDividerMouseDown(i: number, e: React.MouseEvent) {
    if (!dividersEnabled) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWeights = [...paneWeights];
    function onMove(ev: MouseEvent) {
      if (!rowWidthPx) return;
      const totalWeight = startWeights.slice(0, openPaneCount).reduce((a, b) => a + b, 0) || openPaneCount;
      const deltaWeight = ((ev.clientX - startX) / rowWidthPx) * totalWeight;
      const minW = totalWeight * 0.12;
      let a = Math.max(minW, startWeights[i] + deltaWeight);
      let b = Math.max(minW, startWeights[i + 1] - deltaWeight);
      // Magnetic snap to an exact 50/50 split between these two panes: once
      // the drag is within DIVIDER_SNAP_PX of dead center, lock to it, so
      // "roughly halfway" reliably lands on perfectly halfway instead of
      // needing pixel-perfect aim.
      const pxPerWeight = rowWidthPx / totalWeight;
      if (Math.abs(a - b) * pxPerWeight < DIVIDER_SNAP_PX) {
        a = b = (a + b) / 2;
      }
      setPaneWeights((prev) => {
        const next = [...prev];
        next[i] = a;
        next[i + 1] = b;
        return next;
      });
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      saveComboLayout(comboKey, { paneWidths: paneWeightsRef.current.slice(0, openPaneCount) });
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const panes: { key: 0 | 1 | 2; docPath: string | undefined; isMain: boolean; pending?: boolean }[] = [
    { key: 0, docPath: undefined, isMain: true },
    ...extraDocPanes.map((p, i) => ({ key: (i + 1) as 1 | 2, docPath: p, isMain: false })).filter((p) => p.docPath !== undefined),
  ];
  if (pendingSlotOpen) {
    const key = (pendingEmptySlot as 0 | 1) + 1 as 1 | 2;
    if (!panes.some((p) => p.key === key)) {
      panes.push({ key, docPath: undefined, isMain: false, pending: true });
      panes.sort((a, b) => a.key - b.key);
    }
  }

  return (
    <div ref={scrollRowRef} className="flex h-full min-h-0 w-full overflow-x-auto scroll-thin">
      {panes.map((p, i) => (
        <React.Fragment key={p.key}>
          {i > 0 && (
            <div
              onMouseDown={(e) => onDividerMouseDown(i - 1, e)}
              className="shrink-0 h-full relative"
              style={{
                width: dividersEnabled ? DIVIDER_PX : DIVIDER_LOCKED_PX,
                cursor: dividersEnabled ? 'col-resize' : 'default',
                background: 'var(--border-subtle)',
              }}
            />
          )}
          <div
            className="h-full shrink-0"
            style={rowWidthPx ? { width: paneWidthsPx[i], flex: '0 0 auto' } : { flex: '1 1 0%', minWidth: 0 }}
          >
            <DocPaneViewer
              paneIndex={p.key}
              paneDocPath={p.isMain ? undefined : (p.docPath || undefined)}
              onPaneDocPathChange={p.isMain
                ? setMainDocPath
                : (path) => setExtraDocPane((p.key - 1) as 0 | 1, path)}
              focused={focusedPane === p.key}
              onFocusPane={() => setFocusedPane(p.key)}
              onCloseExtraPane={p.isMain ? undefined : () => {
                if (p.pending) setPendingEmptySlot(null);
                else setExtraDocPane((p.key - 1) as 0 | 1, undefined);
                if (focusedPane === p.key) setFocusedPane(0);
              }}
              onAddPane={addPane}
              canAddPane={canAddPane}
              outlineOpen={paneOutlineOpen[i]}
              onOutlineOpenChange={(open) => handleOutlineOpenChange(i, open)}
              toolbarCompact={openPaneCount > 1}
            />
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
