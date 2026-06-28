// Shared helpers for formatted card bodies (underline / highlight / small text).
// A card body is a string of verbatim source text; CardRun[] layers debate emphasis
// on top without ever changing the text itself.

import { CardRun, HighlightColor } from '../types';

// Full-saturation highlight colors — same palette Verbatim/Word uses. Dark mode
// readability is handled post-render by applyDarkModeViewerFixes (same as the
// docx viewer), so we use solid colors here rather than low-opacity washes.
export const HIGHLIGHT_CSS: Record<HighlightColor, string> = {
  yellow: '#ffff00',
  cyan:   '#00ffff',
  green:  '#00ff00',
};

export const HIGHLIGHT_SWATCH: Record<HighlightColor, string> = {
  yellow: '#ffff00',
  cyan:   '#00ffff',
  green:  '#00ff00',
};

// Per-character emphasis attributes — the editable source of truth.
export interface CharAttr {
  u: boolean;                    // underline (read)
  hl: HighlightColor | null;     // highlight color
  sm: boolean;                   // small (not read)
}

export function emptyAttrs(len: number): CharAttr[] {
  return Array.from({ length: len }, () => ({ u: false, hl: null, sm: false }));
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
  // small first, then underline, then highlight (emphasis wins over context).
  mark(spans.small, (a) => { a.sm = true; });
  mark(spans.underline, (a) => { a.u = true; a.sm = false; });
  mark(spans.highlight, (a) => { a.hl = color; a.u = true; a.sm = false; });
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
      attrs.push({ u: !!r.underline, hl: r.highlight ?? null, sm: !!r.small });
    }
  }
  return { text, attrs };
}

export function runsFromAttrs(text: string, attrs: CharAttr[]): CardRun[] {
  const runs: CardRun[] = [];
  let cur: (CardRun & { _key: string }) | null = null;
  for (let i = 0; i < text.length; i++) {
    const a = attrs[i] ?? { u: false, hl: null, sm: false };
    const key = `${a.u}|${a.hl ?? ''}|${a.sm}`;
    if (cur && cur._key === key) {
      cur.text += text[i];
    } else {
      cur = { _key: key, text: text[i], underline: a.u || undefined, highlight: a.hl ?? undefined, small: a.sm || undefined };
      runs.push(cur);
    }
  }
  return runs.map(({ text: t, underline, highlight, small }) => {
    const run: CardRun = { text: t };
    if (underline) run.underline = true;
    if (highlight) run.highlight = highlight;
    if (small) run.small = true;
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

  // Skip text inside <button> / [data-noselect] (e.g. the remove-✕ glyphs) so
  // their characters don't shift the offsets that map back into the body text.
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
