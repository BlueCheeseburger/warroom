// Shared helpers for formatted card bodies (underline / highlight / small text).
// A card body is a string of verbatim source text; CardRun[] layers debate emphasis
// on top without ever changing the text itself.

import { CardRun, FontSize, HighlightColor } from '../types';

// Full-saturation highlight colors — same palette Verbatim/Word uses. Dark mode
// readability is handled post-render by applyDarkModeViewerFixes (same as the
// docx viewer), so we use solid colors here rather than low-opacity washes.
export const HIGHLIGHT_CSS: Record<HighlightColor, string> = {
  yellow: '#ffff00',
  cyan:   '#00ffff',
  green:  '#00ff00',
};

// RGB components for each highlight color (used to compute dark-mode dimming).
export const HIGHLIGHT_RGB: Record<HighlightColor, [number, number, number]> = {
  yellow: [255, 255, 0],
  cyan:   [0, 255, 255],
  green:  [0, 255, 0],
};

export const HIGHLIGHT_SWATCH: Record<HighlightColor, string> = {
  yellow: '#ffff00',
  cyan:   '#00ffff',
  green:  '#00ff00',
};

// em scaling for each debate font size relative to the base body size.
export const FONT_SIZE_EM: Record<number, string> = {
  11: '1em',
  8:  '0.73em',
  6:  '0.55em',
  3:  '0.27em',
};

// Per-character emphasis attributes — the editable source of truth.
export interface CharAttr {
  u: boolean;                // underline (read aloud)
  hl: HighlightColor | null; // highlight color (most important read words)
  fs: FontSize;              // 11 = normal; 8/6/3 = shrunk context (not read)
}

export function emptyAttrs(len: number): CharAttr[] {
  return Array.from({ length: len }, () => ({ u: false, hl: null, fs: 11 as FontSize }));
}

// Find every range of `sub` within `text`. Exact match first, then a
// whitespace-flexible match so minor whitespace drift from the model still lands.
function findRanges(text: string, sub: string): [number, number][] {
  const ranges: [number, number][] = [];
  const s = sub.trim();
  if (!s) return ranges;
  let idx = text.indexOf(s);
  if (idx !== -1) {
    while (idx !== -1) { ranges.push([idx, idx + s.length]); idx = text.indexOf(s, idx + s.length); }
    return ranges;
  }
  const pattern = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  try {
    const re = new RegExp(pattern, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      ranges.push([m.index, m.index + m[0].length]);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  } catch {/* ignore bad pattern */}
  return ranges;
}

// Apply AI-returned emphasis substrings onto the verbatim body, producing runs.
// small → fs=8 (standard Verbatim small text); underline/highlight override to normal.
export function buildAttrsFromSpans(
  text: string,
  spans: { underline?: string[]; highlight?: string[]; small?: string[] },
  color: HighlightColor,
): CharAttr[] {
  const attrs = emptyAttrs(text.length);
  const mark = (subs: string[] | undefined, fn: (a: CharAttr) => void) => {
    for (const sub of subs ?? []) {
      for (const [a, b] of findRanges(text, sub)) {
        for (let i = a; i < b; i++) fn(attrs[i]);
      }
    }
  };
  // small first, then underline/highlight (emphasis wins over shrunk context).
  mark(spans.small, (a) => { a.fs = 8; });
  mark(spans.underline, (a) => { a.u = true; a.fs = 11; });
  mark(spans.highlight, (a) => { a.hl = color; a.u = true; a.fs = 11; });
  return attrs;
}

export function attrsFromRuns(runs: CardRun[] | undefined, fallbackText: string): { text: string; attrs: CharAttr[] } {
  if (!runs || runs.length === 0) {
    return { text: fallbackText, attrs: emptyAttrs(fallbackText.length) };
  }
  let text = '';
  const attrs: CharAttr[] = [];
  for (const r of runs) {
    for (const ch of r.text) {
      text += ch;
      attrs.push({ u: !!r.underline, hl: r.highlight ?? null, fs: (r.fontSize ?? 11) as FontSize });
    }
  }
  return { text, attrs };
}

export function runsFromAttrs(text: string, attrs: CharAttr[]): CardRun[] {
  const runs: CardRun[] = [];
  let cur: (CardRun & { _key: string }) | null = null;
  for (let i = 0; i < text.length; i++) {
    const a = attrs[i] ?? { u: false, hl: null, fs: 11 as FontSize };
    const key = `${a.u}|${a.hl ?? ''}|${a.fs}`;
    if (cur && cur._key === key) {
      cur.text += text[i];
    } else {
      cur = { _key: key, text: text[i], underline: a.u || undefined, highlight: a.hl ?? undefined, fontSize: a.fs !== 11 ? a.fs : undefined };
      runs.push(cur);
    }
  }
  return runs.map(({ text: t, underline, highlight, fontSize }) => {
    const run: CardRun = { text: t };
    if (underline) run.underline = true;
    if (highlight) run.highlight = highlight;
    if (fontSize) run.fontSize = fontSize;
    return run;
  });
}

export function runsToPlain(runs: CardRun[] | undefined): string {
  return (runs ?? []).map((r) => r.text).join('');
}

// Absolute character offsets of the current selection within `container`,
// counting all text nodes (works regardless of how runs are split into spans).
export function selectionOffsets(container: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;

  // Skip text inside <button> / [data-noselect] so their chars don't shift body offsets.
  const makeWalker = () => document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let p = (node as Text).parentElement;
      while (p && p !== container) {
        if (p.tagName === 'BUTTON' || p.dataset?.noselect != null) return NodeFilter.FILTER_REJECT;
        p = p.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const offsetOf = (node: Node, offset: number): number => {
    let count = 0;
    const walker = makeWalker();
    let n: Node | null;
    while ((n = walker.nextNode())) {
      if (n === node) return count + offset;
      count += (n.textContent ?? '').length;
    }
    return count;
  };
  const start = offsetOf(range.startContainer, range.startOffset);
  const end = offsetOf(range.endContainer, range.endOffset);
  if (start === end) return null;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}
