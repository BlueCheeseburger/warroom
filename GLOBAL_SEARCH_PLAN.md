# Global Search — Implementation Plan

A single search box (sidebar, under Home) + keyboard shortcut that searches **everything**
in Warroom: cases, speech docs, flows, opponents, judges, and AI chats — with fuzzy/typo
tolerance and one-click hand-off to Logos / Google Scholar / Open Evidence.

---

## 1. The core problem: indexing large docs

We can't fuzzy-search hundreds of thousands of words in a docx on every keystroke. The plan
uses your idea: **keyword distillation**. For any large body of text (speech docs, case docx,
AI chats) we extract the **top ~150 most-frequent meaningful words** once, store them, and
search against that compact set instead of the raw text.

### Keyword extraction helper (`src/lib/searchIndex.ts`)

```ts
// Pure, no deps. Lowercase → strip punctuation → drop stopwords + short tokens →
// frequency-count → return top N actual words.
export function extractKeywords(text: string, n = 150): string[] { ... }
```

- A ~300-word English stopword list (the, and, is, of, …) plus debate filler we don't want
  as search hits.
- Drop tokens < 3 chars and pure numbers.
- Returns words sorted by frequency, capped at `n`.

This runs **once per document** and the result is cached (see §3), so it never blocks typing.

---

## 2. What gets indexed, and from where

| Source | Title | Searchable text | Notes |
|---|---|---|---|
| **Cases** | `case.name` | name + `ocSource.teamName/label` + extracted keywords from the docx | docx text via `speechdoc:extract`; extract keywords once, cache on the case |
| **Speech docs** | file name | extracted keywords from the docx | same extraction path as cases |
| **Flows** | `flow.name` | every cell across every sheet, joined | small — index in full, no distillation. Iterate `sheets[].cells` |
| **Opponents** | `opponent.teamName` | teamName + school | tiny, full text |
| **Judges** | `judge.name` | name + institution + keywords(paradigm) | paradigm can be long → distill it |
| **AI chats** | `conversation.title` | keywords over all messages (prompts **and** responses) | from `warroom-gemini-conv-*` in localStorage |

Data locations (confirmed in code):
- Cases / opponents / judges / flows → Zustand `db` (`appStore`) — already in memory.
- Flow cells → `FlowView` snapshot shape: `sheets: { name, cells: Record<string,string> }[]`.
- AI chats → `localStorage` keys `warroom-gemini-conversations` (meta) + `warroom-gemini-conv-<id>` (history).
- Speech doc / case docx text → `window.warroom.speechdoc.extract(filePath)`.

---

## 3. Index storage & freshness

A single in-memory index array, rebuilt from `db` + localStorage, with **cached keyword sets**
for the expensive sources so we don't re-extract on every launch.

```ts
interface SearchEntry {
  type: 'case' | 'speechdoc' | 'flow' | 'opponent' | 'judge' | 'chat';
  id: string;
  title: string;
  subtitle?: string;      // e.g. "Aff • imported from OpenCaselist"
  haystack: string;       // title + keywords joined — what Fuse searches
  view: View;             // where clicking navigates
}
```

- **Cheap sources** (opponents, judges, flows, chat titles): rebuilt live from `db` whenever it
  changes — no caching needed.
- **Expensive sources** (case/speech docx keywords, chat-body keywords): cache the extracted
  keyword array keyed by a content signature.
  - Cases: store `searchKeywords?: string[]` + `searchKeywordsFor?: string` (the docx `url` +
    `byteLen` as the signature) directly on the `Case` record in `db`. Re-extract only when the
    signature changes.
  - AI chats: cache in a new localStorage key `warroom-gemini-conv-kw-<id>` with a message-count
    signature; re-extract when the chat grows.
- Extraction runs in the background after launch (and after an import), updating the index
  incrementally so the UI never blocks.

---

## 4. Fuzzy matching + spell correction (Fuse.js — already a dependency)

`fuse.js@7` is already installed. It gives us typo tolerance and "similar but not exact" word
matching for free — no separate spell-checker needed.

```ts
new Fuse(entries, {
  keys: ['title', 'haystack'],
  threshold: 0.38,        // typo-tolerant but not noisy
  ignoreLocation: true,
  minMatchCharLength: 2,
  includeScore: true,
});
```

- `threshold` is the tuning knob for how "loose" matches are (covers the spell-correction ask).
- Title matches are boosted over body/keyword matches (weight the `keys`).
- Optionally surface a "Did you mean **<closest token>**?" line using the best fuzzy token hit
  when the raw query returns few results.

---

## 5. UI

### 5a. Sidebar search field (under Home)
- New `<SearchBox/>` in `Sidebar.tsx` expanded nav, directly below the Home item.
- Collapsed sidebar: a search icon that expands the sidebar and focuses the box.

### 5b. Results
- Renders as a dropdown/overlay panel anchored under the box (or a centered command palette).
- **Grouped by type** with section headers: Cases · Speech docs · Flows · Opponents · Judges · AI chats.
- Each row: icon + title + subtitle + a tiny matched-keyword snippet.
- ↑/↓ to move, ↵ to open (calls `setView(entry.view)`), Esc to close.

### 5c. External-search footer
At the bottom of the results panel, always-present actions that hand the query off:
- **Search "<query>" in Logos** (primary — your "maybe Logos for all three" note)
- Optionally also: Google Scholar, Open Evidence.

Each pre-fills the destination view's query. **Requires a small plumbing change**: the
`View` union's `logos` / `google-scholar` / `open-ev` variants don't currently carry a query.
Add an optional `query?: string` to those variants (or a `pendingSearch` field in `appStore`),
and have `FindCards` / `GoogleScholarView` / `OpenEvView` read it on mount via the existing
`registerAgentSearch` plumbing.

### 5d. Keyboard shortcut
- Global `Cmd+K` / `Ctrl+K` listener (in `App.tsx`) → focus the sidebar search box (expanding
  the sidebar first if collapsed). Esc clears + blurs.

---

## 6. Files touched

| File | Change |
|---|---|
| `src/lib/searchIndex.ts` *(new)* | `extractKeywords`, stopword list, `buildIndex(db)`, Fuse setup, `search(query)` |
| `src/components/SearchBox.tsx` *(new)* | the input + results panel + external-search footer |
| `src/components/Sidebar.tsx` | mount `<SearchBox/>` under Home (expanded + collapsed icon) |
| `src/App.tsx` | `Cmd/Ctrl+K` global shortcut |
| `src/store/appStore.ts` | optional `query` on `logos`/`google-scholar`/`open-ev` views (or `pendingSearch`) |
| `src/types.ts` | `searchKeywords?` + signature field on `Case` |
| `src/components/FindCards.tsx`, `GoogleScholarView.tsx`, `OpenEvView.tsx` | consume prefilled query |
| docs sync | `Documentation.tsx`, `documentation.md`, `user_manual.md`, `warroom-mcp/server.js` |

---

## 7. Suggested build order (phased)

1. **`searchIndex.ts`** — keyword extraction + Fuse wiring, unit-testable in isolation.
2. **Cheap index** — opponents, judges, flows, chat titles, case names. Wire `SearchBox` +
   sidebar + Cmd+K. Ship a working search over everything that's cheap.
3. **Expensive index** — background docx/chat keyword extraction + caching. Cases & speech docs
   become full-text-ish searchable.
4. **External-search footer** — query prefill into Logos (then Scholar / OpenEv).
5. **Polish** — "Did you mean", grouping, snippets, keyboard nav, docs sync.

Phases 1–2 deliver the core feature fast; 3–5 layer on the depth.

---

## 8. Open questions for you

- **External search**: just **Logos**, or all three (Logos / Scholar / OpenEv)?
- **Palette vs. dropdown**: centered `Cmd+K` command palette (covers screen), or a dropdown
  hanging off the sidebar box? (Palette is more standard; dropdown is more "lives in the sidebar".)
- **Chat indexing**: include AI chat *bodies* (keyword-distilled), or just chat titles? Bodies
  are more useful but cost the extra extraction/caching in §3.
