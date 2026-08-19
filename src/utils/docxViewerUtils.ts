// Shared utilities for docx-preview viewer dark-mode fixes.
// Used by SpeechDocViewer and OpponentProfile (DisclosedFileModal).

export function parseRgb(str: string): { r: number; g: number; b: number } | null {
  const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3] };
}

export function isBrightHighlight({ r, g, b }: { r: number; g: number; b: number }) {
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const isNearWhite = r > 230 && g > 230 && b > 230;
  const isNearBlack = r < 20 && g < 20 && b < 20;
  return luminance > 0.3 && !isNearWhite && !isNearBlack;
}

export function dimHighlightToHsl(r: number, g: number, b: number, targetL = 26): string {
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
      default:  h = ((rr - gg) / d + 4) / 6;
    }
  }
  const sFinal = Math.max(s * 100, 60);
  return `hsl(${Math.round(h * 360)}, ${Math.round(sFinal)}%, ${targetL}%)`;
}

export function applyDarkModeViewerFixes(container: HTMLElement) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
  let node: Node | null = walker.currentNode;
  while (node) {
    const el = node as HTMLElement;
    const bg = window.getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      const rgb = parseRgb(bg);
      if (rgb && isBrightHighlight(rgb)) {
        if (!el.dataset.origBg) el.dataset.origBg = bg;
        el.style.setProperty('background-color', dimHighlightToHsl(rgb.r, rgb.g, rgb.b), 'important');
      }
    }
    const bc = el.style.borderColor ||
      el.style.borderTopColor || el.style.borderBottomColor ||
      el.style.borderLeftColor || el.style.borderRightColor;
    if (bc) {
      const rgb = parseRgb(bc);
      if (rgb && (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255 < 0.2) {
        const light = 'rgba(240, 240, 242, 0.7)';
        if (!el.dataset.origBorderColor) el.dataset.origBorderColor = bc;
        if (el.style.borderColor) el.style.borderColor = light;
        if (el.style.borderTopColor) el.style.borderTopColor = light;
        if (el.style.borderBottomColor) el.style.borderBottomColor = light;
        if (el.style.borderLeftColor) el.style.borderLeftColor = light;
        if (el.style.borderRightColor) el.style.borderRightColor = light;
      }
    }
    node = walker.nextNode();
  }
}

// ── Highlight readability slider ────────────────────────────────────────────
// Word's raw highlighter colors (OOXML `w:highlight`) render at full
// saturation — yellow/cyan read fine that way, but green in particular is
// perceptibly harsher against black text at the same technical luminance,
// since pure green sits at the peak of human contrast sensitivity (the
// luminance formula weights G at 0.587 vs. R/B's 0.299/0.114). Rather than
// hardcode a fix, this exposes a 0–100 "readability" dial per doc-viewer
// pane (0 = exactly Word's own colors, 100 = fully muted/pastel), so debaters
// who are used to reading raw neon highlights aren't forced into a different
// look. Scoped to whenever the doc page itself renders light (light theme, or
// "keep docs light" in dark mode) — a dark page already gets its own
// luminance-based dim from applyDarkModeViewerFixes above, unaffected by this.

export type HighlightKind = 'yellow' | 'cyan' | 'green';

const HL_RAW: Record<HighlightKind, [number, number, number]> = {
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  green: [0, 255, 0],
};

// The fully-readable (readability = 100) end of the dial for each color —
// muted pastels that keep each hue recognizable rather than converging on
// one generic "highlighter" look.
const HL_SOFT_TARGET: Record<HighlightKind, [number, number, number]> = {
  yellow: [255, 244, 168],
  cyan: [163, 232, 232],
  green: [163, 225, 163],
};

function classifyRawHighlight(r: number, g: number, b: number): HighlightKind | null {
  if (r > 200 && g > 200 && b < 90) return 'yellow';
  if (r < 90 && g > 200 && b > 200) return 'cyan';
  if (r < 90 && g > 200 && b < 90) return 'green';
  return null;
}

/**
 * Tags every element whose (pristine, freshly-rendered) background is one of
 * Word's three raw highlighter colors with which one, via `data-hl-kind`.
 * Call this exactly once, right after docx-preview renders a document and
 * before any other color pass (dark-mode dimming, readability) touches it —
 * once a highlight has been recolored it no longer reads as "raw," so this
 * is the only point classification by computed style actually works.
 * `applyHighlightReadability`/`resetHighlightReadability` read the tag
 * instead, so they stay correct no matter how many times they're called
 * afterward (e.g. live while dragging the slider).
 */
export function tagHighlightElements(container: HTMLElement) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
  let node: Node | null = walker.currentNode;
  while (node) {
    const el = node as HTMLElement;
    const bg = window.getComputedStyle(el).backgroundColor;
    const rgb = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' ? parseRgb(bg) : null;
    const kind = rgb && classifyRawHighlight(rgb.r, rgb.g, rgb.b);
    if (kind) el.dataset.hlKind = kind;
    node = walker.nextNode();
  }
}

/**
 * Sets every `data-hl-kind`-tagged element's background to `readability`%
 * of the way from Word's raw highlighter color toward its muted target —
 * 0 = the exact original Word color, 100 = fully softened. Cheap to call
 * repeatedly (only reads the tag, never computed style), so it's safe to
 * call live on every slider input event.
 */
export function applyHighlightReadability(container: HTMLElement, readability: number) {
  const frac = Math.max(0, Math.min(100, readability)) / 100;
  container.querySelectorAll<HTMLElement>('[data-hl-kind]').forEach((el) => {
    const kind = el.dataset.hlKind as HighlightKind;
    const raw = HL_RAW[kind];
    const target = HL_SOFT_TARGET[kind];
    if (!raw || !target) return;
    const r = Math.round(raw[0] + (target[0] - raw[0]) * frac);
    const g = Math.round(raw[1] + (target[1] - raw[1]) * frac);
    const b = Math.round(raw[2] + (target[2] - raw[2]) * frac);
    el.style.setProperty('background-color', `rgb(${r}, ${g}, ${b})`, 'important');
  });
}

/**
 * Restores every tagged element to Word's exact original highlighter color.
 * Used before handing a page off to applyDarkModeViewerFixes, which needs to
 * compute its own dimming from the true raw color, not an already-softened
 * one — and safe to call unconditionally the rest of the time, since it's a
 * no-op wherever nothing was ever tagged.
 */
export function resetHighlightReadability(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('[data-hl-kind]').forEach((el) => {
    const raw = HL_RAW[el.dataset.hlKind as HighlightKind];
    if (raw) el.style.setProperty('background-color', `rgb(${raw[0]}, ${raw[1]}, ${raw[2]})`, 'important');
  });
}

const HIGHLIGHT_READABILITY_KEY = 'warroom-highlight-readability';
export const HIGHLIGHT_READABILITY_CHANGED = 'warroom-highlight-readability-changed';

export function loadHighlightReadability(): number {
  const v = parseInt(localStorage.getItem(HIGHLIGHT_READABILITY_KEY) ?? '', 10);
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 50;
}

export function saveHighlightReadability(v: number) {
  const clamped = Math.max(0, Math.min(100, Math.round(v)));
  try { localStorage.setItem(HIGHLIGHT_READABILITY_KEY, String(clamped)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(HIGHLIGHT_READABILITY_CHANGED, { detail: clamped }));
}

export function removeDarkModeViewerFixes(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('[data-orig-bg]').forEach(el => {
    el.style.setProperty('background-color', el.dataset.origBg!);
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
  // Deliberately nothing here for the page sections. This function is the exact
  // inverse of applyDarkModeViewerFixes, which only ever touches elements it
  // tagged with data-orig-bg / data-orig-border-color — it never restyles a page.
  // Page background/text colour is owned by the `html.dark .docx-viewer-wrap` rule
  // in index.css, which reacts to theme toggles on its own; writing inline colours
  // here would beat that rule and strand the page in light mode.
}
