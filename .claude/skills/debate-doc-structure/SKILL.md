---
name: debate-doc-structure
description: Reference for exactly how Warroom parses debate .docx files (Verbatim format) — heading hierarchy (pocket/hat/block/tag), cite/body detection, emphasis (underline/highlight/strikethrough), short-cite generation, speech/column/side detection, and known parser gaps (tables, numbered lists, footnotes, hyperlinks). Use this skill BEFORE writing or editing any code that parses, displays, classifies, imports, or reasons about a Warroom speech doc, case, card, or flow — including Auto Flow, card cutting, cross-ex generation, the speech doc viewer, or the ⌘K search index. Also use it whenever investigating a bug report about a card, tag, cite, or highlight looking wrong, missing, or misplaced, even if the report doesn't mention parsing at all.
---

# Debate Doc Structure

The full reference lives at the repo root: `DEBATE_DOC_STRUCTURE.md`. Read that
file in full before touching any code covered by the trigger above — it
documents Warroom's actual `.docx` parsing behavior (heading hierarchy,
cite/body detection, emphasis markers, short-cite generation, speech/column/side
detection, token-saving extraction, and known gaps) backed by real measurements
against real speech docs, not assumptions.

## Keeping it current

This reference decays fast — Warroom's parser changes, and new edge cases turn
up in real docs. When you discover something during a coding session that
`DEBATE_DOC_STRUCTURE.md` doesn't cover, or find something it says that's now
wrong:

1. Edit `DEBATE_DOC_STRUCTURE.md` directly — that's the single source of
   truth, not this file.
2. Prefer a real measurement over a guess wherever you can get one (grep the
   actual code, or count across a real corpus). The file's own history is full
   of guesses that turned out wrong in a specific, informative way — it's
   cheaper to just measure up front than to publish a guess and fix it later.
3. Tell the user what changed, per this repo's `CLAUDE.md` rule.

This `SKILL.md` stays a thin pointer on purpose — don't duplicate
`DEBATE_DOC_STRUCTURE.md`'s content here, or the two will drift out of sync.
