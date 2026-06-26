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
  container.querySelectorAll<HTMLElement>('section.docx').forEach(s => {
    s.style.background = '#ffffff';
    s.style.color = '#1c1c1e';
  });
}
