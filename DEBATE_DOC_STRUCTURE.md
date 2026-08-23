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

**The position is not at a fixed heading level — resolve most-specific-first.**
Measured across 90 real docs. The table above says the hat names the position;
that is the *common* case, not a rule, and three other shapes are all frequent:

| Shape | Example | Where the position is |
|---|---|---|
| Numbered advantages | hat `1AC---Single Payer`, block `1AC---Advantage 1---Economy` | **block** — hat holds the AFF's name |
| Unnumbered advantage | hat `1AC---Redundancy`, `Miscalc. Adv.`, `1AC---Inhuman Matter` | **hat** |
| Off-case / neg | hat `Cap K`, block `Perm---AT: Do Both---2NC` | **hat** |
| Single heading level | pocket `Miscalc. Adv.`, `The Advantage` | **pocket** |

Two invariants held with **zero counterexamples** across every aff doc measured:

1. **Explicit `Advantage N` numbering is always in the BLOCK, never the hat**
   (7 docs / 0 contradictions). When a doc numbers its advantages, its hat holds
   the aff's name instead — so reading the hat as the position collapses an
   entire case onto one tab named after the aff and loses every advantage. The
   advantage check must therefore run **before** the hat check.
2. When a doc *doesn't* number them, the advantage is in the hat, and the plain
   hat rule is correct.

So the resolution order is: block-advantage → hat-advantage → hat → block →
pocket → unknown (`sheetForCard` / `advantageName` in `src/lib/autoFlowParse.ts`).
Don't hardcode a level.

**The pocket is a real tab source, not only a speech divider.** A doc with only
one ancestor heading level puts the position there — the deepest level present is
the tag, so everything else collapses into the pocket. Three of the 90 docs are
shaped this way (35 aff cards). Adding the pocket as the last fallback took the
unresolved rate across all 90 docs from **15.3% to 3.9%** and the count of cards
dumped on an "Unsorted" tab from 102 to 6, with no other placement changing.
Guard it: skip a pocket that is a bare speech (`1AC`) or generic (`OFF`), which
is what it is in the common case.

**A speech label is not a position.** Pockets, and sometimes hats and blocks, are
speech names ("1NC", "2NC---Extra"). A speech identifies *when* a card is read, so
it can name a flow COLUMN — it can never name a flow TAB, which is a position. Any
fallback chain that ends at "use the speech" is wrong; end it at an explicit
unknown instead.

**The same position is written differently in every doc it appears in.** The 2AC
hats it `Midterms DA`, the 2NC hats the kick block `Midterms`. Matching heading
text literally produces duplicate tabs. Compare on a key that drops a leading
`AT:`/`A2:` and a trailing position-TYPE word (`DA`, `CP`, `K`, `T`, `Adv`), and
nothing else — dropping a meaningful word merges the aff's `Economy` advantage
into the neg's `Econ DA` (`sheetAliasKey`, same file).

**Some docs name no position at all.** A 1NC that hats all 16 off-case blocks
`OFF` has the positions only in the taglines. No parser can recover them; that is
the boundary where a model is genuinely required. Report which document and which
header, don't guess and don't hide it.

---

**XML entities must be decoded, not just tag-stripped.** Paragraph text in OOXML
is entity-encoded, so removing `<w:...>` tags is only half the job — `&amp;`,
`&lt;`, `&#8217;` all survive a naive strip. `extractFlowCardsFromXml` runs
`decodeXmlEntities` (exported from `electron/docxFlowCards.ts`) inside its
`strip`. This matters more than it looks: since Auto Flow placements became
index-keyed, this parser is the **only** source of tag and cite text (the model
no longer retypes them), so an undecoded `&` reaches the flow cell, gets escaped
again by `buildCellHtml`, and renders as a literal `&amp;`. Measured on real
speech docs before the fix: 116 of 833 cites and 3 taglines. `&amp;` is decoded
last so `&amp;lt;` yields the literal text `&lt;` rather than `<`.

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

**Consumers of tag/cite detection**: `speechdoc:extract` (token saving / AI
attach / aff-neg), and `extractDocxPriorityText` (`electron/main.ts`) — a
lighter pass reusing the same heading-level + "first paragraph after a tag is
the cite" logic, but only collecting headings + cite lines (not body/emphasis).
Its output feeds `extractKeywords`' `priorityText` param
(`src/lib/searchIndex.ts`) so every card's tagline and cite (author, date,
publication) is guaranteed part of a case/speech-doc's ⌘K search keywords,
regardless of word-frequency ranking. If the tag/cite detection rules above
change, update both consumers.

---

## 3. Emphasis inside the body (what is actually read aloud)

Only some words in a card are spoken in-round. By OOXML marker:

| Element | OOXML | Parsed today? | Meaning |
|---|---|---|---|
| **Underlined** | `<w:u w:val="…">` (any value ≠ `none`) | ✅ yes | The "cut" — the words the debater reads. Primary read-aloud signal. |
| **Highlighted** | `<w:highlight w:val="cyan">`, `"yellow"`, or `"green"` | ✅ yes | Emphasis on top of underline; the most important read words. |
| **Bold** | `<w:b/>` | ❌ no | Tags are bold; in-body bold+underline marks "power-tagged" words. |
| **Italic** | `<w:i/>` | ❌ no | Usually the source/publication title in a cite, or analytics. |
| **Boxed** | `<w:pBdr>` / `<w:bdr>` | ❌ no | A box around a paragraph/run — often an analytic or "must-read" callout. |
| **Small text (e.g. font 8)** | `<w:sz w:val="16">` (half-points → 16 = 8pt) | ❌ no | The shrunk, un-underlined remainder of the body: the "small text" that is NOT read aloud, kept for context/quals. |

Warroom treats **underline OR cyan/yellow/green highlight** as "read." (Green was
added as a read-aloud color for the in-app card cutter, which offers yellow / cyan /
green highlighters; the token-saving regex in `speechdoc:extract` matches all three,
and the viewer's luminance-based `isBrightHighlight` already accepts green.) Bold,
italic, box, and font size are present in the XML but **not currently parsed** — only
headings, cite position, underline, and cyan/yellow/green highlight drive behavior.
If a feature needs bold/italic/box/size, it has to add that parsing.

---

## 4. Token saving (what the AI receives)

When the user attaches a doc to Warroom AI with **token saving ON**, the AI does
NOT get the whole document — it gets the `tokenSaving` extraction:

- all headings (pockets, hats, blocks, tags),
- the cite line after each tag,
- ONLY the underlined / cyan-, yellow-, or green-highlighted runs from each body,
- everything else (un-highlighted body, font-8 small text, bold-not-underlined,
  italics, boxed analytics) is **dropped**.

So with token saving on, the AI sees what the debater actually reads, not the small
text. With token saving OFF, the AI gets the `full` extraction (every heading +
cite + body paragraph, emphasis flattened to plain text). Cross-ex generation rule
#2 reflects this: only reference small text if it directly contradicts the
highlighted text in the same card.

---

## 4b. Short cites (`electron/citeShort.ts`)

The cite paragraph under a tag carries the full quals — author, job title,
institution, date, sometimes the article title and URL. What goes on a flow is
the **short cite** a debater says out loud: `Cutler & Klarnet '26`.

Real cites come in two dominant shapes, both putting the short cite first:

| Shape | Example | Cut at |
|---|---|---|
| Bracket | `Toth ’16 [Federico; May; University of Bologna…` | `[` or `(` |
| Comma | `Ralph Nader 25, Former presidential candidate…` | `,` |

`shortCite(full)` takes the head before that delimiter, drops honorifics
(`Dr.`, `Prof.`) and post-nominals (`PhD`, `JD`), pulls a trailing year, and
reduces the remaining name run to a surname — the LAST token, walking back over
particles so `van der Berg` survives whole. `&`/`and` keeps both surnames;
`et al` is preserved. Year forms include `’26`, `26`, `2026`, Verbatim's
month-day current-year form (`'7/1`, `’6-25`), and the `'2k` shorthand.

Two deliberate refusals, both returning `''` rather than a placeholder:
`<<… FOR REFERENCE >>` markers (a card already read — no author to cite), and a
head with **no year and no delimiter**, which is arbitrary prose rather than a
cite head. Without that second rule an analytic sitting in the cite slot
(`"1. Uniqueness. COVID thumps any benefits…"`) yields a nonsense surname.

Measured over 833 real cites: **95% shortened**, the remainder reference markers
plus a handful of analytics correctly rejected. Auto Flow still asks Warroom AI
for the short cite (it handles organisations better — `PAHF '23`); this is the
fallback when the model omits it, replacing an older fallback that wrote the
**entire cite paragraph** into the flow cell.

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

**The fix:** the injected `#wr-docx-fonts` style block sets a page default —
`section.docx-render { font-family: <Calibri sans stack> }` — so theme-inherited
runs (which resolve no font at all) land on the sans stack, while runs that *do*
resolve a font (Calibri headings, a genuinely Times-New-Roman card body) keep it,
because docx-preview styles those per-element and that beats this selector. When
touching font handling, prefer adjusting that page default over the `@font-face`
block for theme-inheritance cases.

**Watch the class name.** The page `<section>` takes its class from `renderAsync`'s
`className` option, so in `SpeechDocViewer.tsx` (which passes `'docx-render'`) the
pages are `section.docx-render` — `section.docx` matches **nothing** there. Other
callers differ: `GoogleDrivePanel.tsx` passes no `className` and so gets
docx-preview's `'docx'` default, and `CasePreview.tsx` passes a per-item hashed
class on purpose (docx-preview scopes all its generated CSS to that class, so
sharing one class across many thumbnails would make them clobber each other's
styles). Always check the call site's `className` before writing a selector.
