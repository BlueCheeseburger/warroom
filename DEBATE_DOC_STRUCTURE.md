# Debate document structure reference

How Warroom reads a debate `.docx` (Verbatim format). Read this before building or
changing any feature that parses, displays, classifies, or reasons about speech
docs, cases, or cards. The source of truth in code is the `speechdoc:extract`
handler in `electron/main.ts` and the viewer logic in
`src/components/SpeechDocViewer.tsx`.

---

## 1. Structural hierarchy (Word heading styles)

Cards are organized by Word heading styles **Heading1–Heading4**. docx-preview
renders every paragraph as a `<p>` and tags it with a class derived from its style
id (e.g. `docx-render_heading1`). In OOXML, read `w:pStyle w:val="Heading1..4"` on
each `<w:p>`.

**Non-standard heading style ids.** Not every doc uses the literal ids
`Heading1–9` — Google Docs exports, custom Verbatim templates, and hand-built
round reports often name their heading styles differently (so docx-preview emits a
class like `docx-render_mytagstyle`, not `docx-render_heading4`, and the literal
class regex misses them). docx-preview *parses* a style's `w:outlineLvl` but never
emits it to the DOM, so DOM-only detection can't see these headings.

To handle this, `resolveHeadingStyles(stylesXml)` in `electron/main.ts` reads
`word/styles.xml` and computes each **paragraph** style's effective Word outline
level, in priority order: (1) its own `<w:outlineLvl>`, (2) its `<w:name>` matching
`heading N`, (3) inheritance up its `<w:basedOn>` chain. It returns
`Map<styleId, 1-based level>` (outlineLvl 0 ⇒ level 1).

- The **viewer** calls the `speechdoc:headingStyles` IPC (bytes → map keyed by
  docx-preview's escaped class suffix). `headingLevelOf()` in `SpeechDocViewer.tsx`
  checks the built-in `Heading1–9` class first (fast path), then this resolved map.
  All structural features thread it through: outline, card credibility, focus mode,
  reading-time (`collectSpoken`), and Send-to-Flow.
- The **`speechdoc:extract`** handler (AI attach / token saving / aff-neg) uses the
  same resolver instead of a hardcoded `Heading1–4` list, and treats the deepest
  level present as the tag. Both fall back to `Heading1–4` if `styles.xml` is
  missing/empty.

(`fs:countDocxCards`, the Home tile badge, is a separate mammoth-based path and
relies on mammoth's own heading mapping.)

Canonical Verbatim mapping:

| Word style | Verbatim term | What it is |
|---|---|---|
| Heading 1 | **Pocket** | Top-level section / speech divider. Where speech labels live ("1AC", "Off Case", "2NC — Politics"). Used for aff/neg detection. |
| Heading 2 | **Hat** | A named position or advantage under a pocket ("Redundancy Advantage", "Politics DA"). |
| Heading 3 | **Block** | A group of cards under a hat ("Uniqueness", "Link", "Impact", "AT: Cap K"). |
| Heading 4 | **Tag** (tagline) | The one-sentence bolded claim above each card. |

**Important heuristic:** Warroom treats the **deepest heading level present in the
doc** as the tag, and the levels above it (in order) as block → hat → pocket. Real
files routinely skip levels (e.g. jump H1 → H4 with no H3/Block). Don't assume
Heading4 == tag; compute the max level present and collapse the gaps by relative
order. (The outline UI does exactly this in `SpeechDocViewer.tsx`.)

---

## 2. Inside a single card

After a tag, the following paragraphs are `Normal` / `NormalWeb`:

1. **Cite** — the **first** Normal paragraph right after the tag. Author,
   qualifications, date, publication. Warroom always treats this first post-tag
   paragraph as the cite. (Re-armed on every heading, so consecutive tags — e.g.
   an "Advantage 1 is…" label tag immediately followed by the real card tag — still
   resolve the cite correctly.)
2. **Card body** — every Normal paragraph after the cite, until the next heading.
   The full quoted evidence.

A bare tag with no Normal paragraph under it (another heading follows immediately)
is an **analytic / label tag**, not an evidence card.

---

## 3. Emphasis inside the body (what is actually read aloud)

Only some words in a card are spoken in-round. By OOXML marker:

| Element | OOXML | Parsed today? | Meaning |
|---|---|---|---|
| **Underlined** | `<w:u w:val="…">` (any value ≠ `none`) | ✅ yes | The "cut" — the words the debater reads. Primary read-aloud signal. |
| **Highlighted** | `<w:highlight w:val="cyan">` or `"yellow"` | ✅ yes | Emphasis on top of underline; the most important read words. |
| **Bold** | `<w:b/>` | ❌ no | Tags are bold; in-body bold+underline marks "power-tagged" words. |
| **Italic** | `<w:i/>` | ❌ no | Usually the source/publication title in a cite, or analytics. |
| **Boxed** | `<w:pBdr>` / `<w:bdr>` | ❌ no | A box around a paragraph/run — often an analytic or "must-read" callout. |
| **Small text (e.g. font 8)** | `<w:sz w:val="16">` (half-points → 16 = 8pt) | ❌ no | The shrunk, un-underlined remainder of the body: the "small text" that is NOT read aloud, kept for context/quals. |

Warroom treats **underline OR cyan/yellow highlight** as "read." Bold, italic,
box, and font size are present in the XML but **not currently parsed** — only
headings, cite position, underline, and cyan/yellow highlight drive behavior. If a
feature needs bold/italic/box/size, it has to add that parsing.

---

## 4. Token saving (what the AI receives)

When the user attaches a doc to Warroom AI with **token saving ON**, the AI does
NOT get the whole document — it gets the `tokenSaving` extraction:

- all headings (pockets, hats, blocks, tags),
- the cite line after each tag,
- ONLY the underlined / cyan-or-yellow-highlighted runs from each body,
- everything else (un-highlighted body, font-8 small text, bold-not-underlined,
  italics, boxed analytics) is **dropped**.

So with token saving on, the AI sees what the debater actually reads, not the small
text. With token saving OFF, the AI gets the `full` extraction (every heading +
cite + body paragraph, emphasis flattened to plain text). Cross-ex generation rule
#2 reflects this: only reference small text if it directly contradicts the
highlighted text in the same card.

---

## 5. Aff vs neg detection

Tally speech labels that appear in the pockets/hats:

- **Aff** = `1AC`, `2AC`, `1AR`, `2AR`
- **Neg** = `1NC`, `2NC`, `1NR`, `2NR`

Whichever side's labels dominate wins; a tie or no labels falls back to the
filename ("…Aff…" / "…Neg…"). This is what the home Cases tile uses to classify
imported speech docs (`useSpeechDocCounts` in `src/components/Home.tsx`).

---

## 6. Fonts (rendering)

Debate docs are almost always **Calibri** (newer files carry the **Aptos** theme
default). macOS ships neither, so the viewer injects `@font-face` aliases
(`SpeechDocViewer.tsx`) mapping Office families to installed fallbacks (Calibri /
Aptos → Carlito/Helvetica Neue/Arial; Cambria → serif).

**The theme-font gap.** Modern Word docs frequently leave the latin font *unset*
on body runs — a run carries only `w:rFonts w:cs="Calibri"` (complex-script) and
inherits its real latin font from `docDefaults`, which points at the **theme**
font via `w:asciiTheme="minorHAnsi"` (resolved in `theme1.xml` to Aptos/Calibri).
docx-preview **does not resolve theme fonts**, so those runs render with *no*
inline `font-family` and fall through to Chromium's default serif (Times New
Roman). That's why a doc can show sans-serif headings (which set Calibri
explicitly) but serif body text — even though the document intends one font
throughout. An `@font-face` alias can't fix this because the string "Aptos" is
never emitted by docx-preview.

**The fix:** the post-render loop sets `section.docx { font-family: <Calibri sans
stack> }` as the container default, so theme-inherited runs (no inline font) land
on the sans stack, while runs that *do* carry an explicit inline font — Calibri
headings, or a genuinely Times-New-Roman card body — keep winning via inline-style
specificity. When touching font handling, prefer adjusting that section default
over the `@font-face` block for theme-inheritance cases.
