// ── Flow cell HTML sanitizer ─────────────────────────────────────────────────
// Cell content is rich text, but it is NOT all locally trusted: it arrives from
// remote collaborators over the live broadcast channel (Y.Doc updates), from
// AI / MCP-written values, and from the system clipboard, any of which could
// smuggle in <img onerror=…>, <script>, event handlers, or javascript: URLs.
// Before any cell HTML reaches a live innerHTML we parse it inertly (DOMParser
// never loads resources or runs script), drop every element/attribute outside a
// small formatting allowlist, and reserialize. execCommand-produced formatting
// (b/i/u/strike/br/spans) is preserved; anything dangerous is stripped.
//
// Lives apart from FlowView.tsx so it can be exercised by scripts/test-cell-paste.ts.

// Highlighter color (amber) for ⌘⇧H. Cells force dark ink on any highlighted
// span (see the .flow-cell rule in index.css) so it stays readable in dark mode.
export const HILITE = '#fde68a';
export const HILITE_RGB = 'rgb(253,230,138)';

export const HTML_RE = /<(br|div|span|b|i|u|s|strike|em|strong|p)[\s/>]/i;

const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'BR', 'DIV', 'P', 'SPAN', 'FONT', 'SUB', 'SUP']);
const VOID_TAGS = new Set(['BR']);
// Subtrees whose raw text must never be emitted (unwrapping would leak their contents).
const DROP_SUBTREE = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH']);

// Note what is NOT here: `color`, `font-family`, and `font-size`. Nothing in the
// app can legitimately set those on a cell — there is no text-color picker, the
// per-column colors live on the cell's wrapper, and cell font size is a
// view-level setting. So a run carrying any of them can only have come from
// pasted Word / Google Docs markup, which is exactly what we want to shed: it is
// why a pasted tag used to land in 22pt black-on-dark. Excluding them here (and
// not just on the paste path) means cells pasted before that fix also come back
// clean the next time they render.
export const ALLOWED_STYLE_PROPS = new Set([
  'font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'background-color', 'vertical-align',
]);

// Paste is stricter still: `background-color` is dropped too. Word and Google
// Docs stamp it on nearly every span with junk values (`transparent`, `white`),
// which would paint boxes inside cells and trip the `.flow-cell` dark-ink rule
// that exists for our own ⌘⇧H highlight spans. Emphasis (bold / italic /
// underline / strike / sub / sup) still survives; a highlight can be re-applied
// in-cell with ⌘⇧H.
const PASTE_DROPPED_PROPS = new Set(['background-color']);
export const PASTE_STYLE_PROPS = new Set([...ALLOWED_STYLE_PROPS].filter((p) => !PASTE_DROPPED_PROPS.has(p)));

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitizeStyle(style: string, props: Set<string>): string {
  return style
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((decl) => {
      const idx = decl.indexOf(':');
      if (idx < 0) return false;
      const prop = decl.slice(0, idx).trim().toLowerCase();
      const val = decl.slice(idx + 1).trim().toLowerCase();
      if (!props.has(prop)) return false;
      // Reject anything that could fetch a resource or execute.
      if (/url\(|expression|javascript:|@import|[<>]/.test(val)) return false;
      return true;
    })
    .join('; ');
}

// Cells render with `white-space: pre-wrap` so typed spacing survives, which
// means a literal newline in the markup becomes a real blank line on screen.
// Word and Google Docs pretty-print their clipboard HTML — newlines and indent
// between every tag — so pasted markup arrives carrying blank lines it never
// intended. Collapse newlines/tabs (which can only come from that source; typing
// produces <br>, never a raw newline in a text node) while leaving runs of
// spaces alone, since pre-wrap preserves those on purpose.
function collapseSourceWhitespace(s: string): string {
  return s.replace(/[\n\r\t]+/g, ' ');
}

function sanitizeNode(node: Node, out: string[], props: Set<string>): void {
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3 /* TEXT_NODE */) {
      out.push(escapeHtml(collapseSourceWhitespace(child.textContent || '')));
      return;
    }
    if (child.nodeType !== 1 /* ELEMENT_NODE */) return;
    const el = child as HTMLElement;
    const tag = el.tagName;
    if (DROP_SUBTREE.has(tag)) return; // skip element and everything under it
    if (!ALLOWED_TAGS.has(tag)) {
      // Unknown-but-harmless wrapper: drop the tag, keep its (sanitized) children.
      sanitizeNode(el, out, props);
      return;
    }
    const name = tag.toLowerCase();
    if (VOID_TAGS.has(tag)) { out.push(`<${name}>`); return; }
    const style = sanitizeStyle(el.getAttribute('style') || '', props);
    out.push(style ? `<${name} style="${escapeAttr(style)}">` : `<${name}>`);
    sanitizeNode(el, out, props);
    out.push(`</${name}>`);
  });
}

export function sanitizeCellHtml(html: string, props: Set<string> = ALLOWED_STYLE_PROPS): string {
  if (!html || !/[<&]/.test(html)) return html; // plain text — nothing to strip
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: string[] = [];
  sanitizeNode(doc.body, out, props);
  return out.join('');
}

export function cellToHtml(value: string): string {
  if (!value) return '';
  if (HTML_RE.test(value)) return sanitizeCellHtml(value);
  return escapeHtml(value).replace(/\n/g, '<br>');
}

export function htmlToText(html: string): string {
  if (!html) return '';
  if (!HTML_RE.test(html) && !/[<&]/.test(html)) return html;
  // Parse inertly rather than assigning to a live element, so a hostile
  // <img onerror> in remote/AI content can't fire while we extract text.
  const doc = new DOMParser().parseFromString(sanitizeCellHtml(html), 'text/html');
  // Preserve line breaks the way innerText did (<br>/<div> → newline).
  doc.body.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  doc.body.querySelectorAll('div, p').forEach((b) => { b.append('\n'); });
  return (doc.body.textContent || '').replace(/\n{2,}/g, '\n').replace(/\n$/, '');
}

// Block-level tags in pasted markup. A cell is a single flowing run of text, not
// a document, so these are flattened to a <br> rather than kept: a surviving <p>
// brings Word's default 1em margin with it, which reads as a blank line above and
// below every pasted paragraph.
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL',
  'TABLE', 'TR', 'TD', 'TH', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'PRE',
]);

// Paste-specific walk: like sanitizeNode, but flattens block structure to <br>
// and collapses insignificant whitespace the way normal (non-pre-wrap) HTML
// rendering would — pasted markup is authored for that model, not for a cell.
function pasteNode(node: Node, out: string[]): void {
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3 /* TEXT_NODE */) {
      out.push(escapeHtml((child.textContent || '').replace(/\s+/g, ' ')));
      return;
    }
    if (child.nodeType !== 1 /* ELEMENT_NODE */) return;
    const el = child as HTMLElement;
    const tag = el.tagName;
    if (DROP_SUBTREE.has(tag)) return;
    if (tag === 'BR') { out.push('<br>'); return; }
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) out.push('<br>');
    if (!isBlock && ALLOWED_TAGS.has(tag)) {
      const name = tag.toLowerCase();
      const style = sanitizeStyle(el.getAttribute('style') || '', PASTE_STYLE_PROPS);
      out.push(style ? `<${name} style="${escapeAttr(style)}">` : `<${name}>`);
      pasteNode(el, out);
      out.push(`</${name}>`);
    } else {
      pasteNode(el, out); // unwrap: a block we're flattening, or an unknown tag
    }
    if (isBlock) out.push('<br>');
  });
}

// Turn clipboard data into HTML safe to insert into a cell. Returns '' when
// there is nothing to paste.
export function cleanPastedHtml(html: string, text: string): string {
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const out: string[] = [];
    pasteNode(doc.body, out);
    const cleaned = out.join('')
      // Every block emitted a <br> on each side, and empty Word paragraphs emit
      // nothing else — collapse each run down to a single line break.
      .replace(/(?:\s*<br>\s*)+/g, '<br>')
      // Drop the breaks/space now stranded at the very start and end.
      .replace(/^(?:<br>|\s)+/, '')
      .replace(/(?:<br>|\s)+$/, '');
    if (cleaned.trim()) return cleaned;
  }
  // Fall back to plain text when the clipboard HTML sanitizes down to nothing
  // (e.g. it was all wrapper chrome), so the paste never silently no-ops.
  return text ? escapeHtml(text).replace(/\r?\n/g, '<br>') : '';
}
