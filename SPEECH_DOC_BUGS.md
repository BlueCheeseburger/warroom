# Speech doc / Cases bug audit (found, not yet fixed)

Audited: SpeechDocViewer.tsx, Sidebar.tsx (CasesSection), CasesGrid.tsx, caseFolders.ts,
caseItems.ts, Home.tsx (Cases panel), and the `speechdoc:*` / `fs:*` IPC handlers in
electron/main.ts. Nothing below has been fixed yet — this file exists so a future
session (context was reset) can pick up straight into fixing without re-auditing.

None of these were user-reported; they were found by code review. Verify each still
reproduces against current code before fixing (files may have moved on since).

## High severity

**1. Card counts get written to the wrong document** — `src/components/SpeechDocViewer.tsx:3173`

```js
if (filePath) updateRecentCardCount(filePath, builtCards.length);
```

`applyRender` closes over the render-time `filePath`, but it's called from `loadFile()`
immediately after `setFilePath(path)` — which hasn't committed yet (React state update
is async). So the closure holds the **previous** doc's path. Open doc A, then doc B:
B's card count gets stamped onto A's recents entry. The very first doc opened in a
session writes nothing (`filePath === ''` at that point). This count is what's shown on
the Home tiles (`Home.tsx:643`).

Fix: pass the path into `applyRender(bytes, base64, path)` as an explicit argument
instead of reading `filePath` from closure/state.

**2. Two rapid doc opens can interleave into one container** — `src/components/SpeechDocViewer.tsx:3090`

`applyRender` fires `setTimeout(async () => { … await renderAsync(…) … })` with no
generation/epoch guard. Click a large doc, then quickly click a small one: both clear
`innerHTML` and both `await renderAsync` into the same container. Whichever finishes
last wins/appends after the other, and overwrites `headingClassesRef`, `outline`,
`credCards`, `docWords`, and the scroll restore with stale values. `loadedPath.current`
doesn't guard this because the two paths are different, so both calls proceed.

Fix: add a monotonically-increasing render-generation ref, capture it at the start of
`applyRender`, and bail after each `await` if it no longer matches the current
generation.

**3. Cross-Ex is broken for every OpenCaseList-imported case** — `src/components/SpeechDocViewer.tsx:1958` (docKey) and `:3243` (filePath assignment)

`CrossExPanel` gets `docKey={filePath}`, and for an imported case `filePath` is the
synthetic `oc:${url}` string (set in `loadOcCase`). That gets passed straight to the
`speechdoc:extract` IPC handler (`electron/main.ts:1518`), which calls `checkPath()` +
`fs.readFile()` on it — `checkPath` throws `Access denied: file path was not opened
through a dialog` for anything that isn't a real trusted path. So opening an opponent's
disclosed case and clicking **Cross-Ex** (or **Harder** / trap drill) always fails with
"Could not extract document text." Credibility scoring still works because it reads the
already-rendered DOM instead of re-reading the file — only Cross-Ex/traps go through
`speechdoc:extract`.

Fix: for OC cases, either (a) have the extract handler accept raw bytes (`ocBytesRef`
already holds the base64 in the renderer) instead of a path, or (b) write the OC docx to
a real trusted temp file (same pattern as `opencaselist.fetchFileToTemp`) and pass that
path instead of the synthetic `oc:` key.

**4. Dropping a doc onto itself yanks it out of its folder** — `src/components/Sidebar.tsx:927` (`onItemDragOver`) and `:940` (`onItemDrop`)

`onItemDragOver` returns early when `dragging?.id === item.key` WITHOUT calling
`preventDefault`/`stopPropagation`, so the dragover event bubbles up to the top-level
container's handler, which does call `preventDefault`. The drop then fires on the item
element; `onItemDrop` also returns early without stopping propagation, so it bubbles
into the top-level `onDropInto(e, null)` handler — which reads a closure value of
`dragging` from before `setDragging(null)` ran, and files the item at **top level**.

Net effect: pick up a doc that's inside a folder, drag it, and drop it back on itself
(no-op intended) → it silently gets pulled out to the top level instead.

Fix: `onItemDragOver`/`onItemDrop` should call `e.preventDefault(); e.stopPropagation();`
even on the self-drop early-return path, so the event never reaches the top-level
container's drop handler.

**5. Deleting a case from Home orphans all its blocks** — `src/components/Home.tsx:508` (`deleteCase`)

```js
await update((db) => { const { [id]: _, ...rest } = db.cases; return { ...db, cases: rest }; });
```

Only removes the case; every block with `caseId === id` stays in `db.blocks` forever —
dead data that never gets cleaned up. `caseItems.ts` exports `deleteCaseAndBlocks`
specifically so every delete path (Sidebar's `NavItem` delete, `CasesGrid`'s
`deleteItems`) stays in sync and this can't drift — Home's `CasesPanel.deleteCase` just
doesn't call it.

Fix: replace the inline `update()` body in `Home.tsx`'s `deleteCase` with
`update((db) => deleteCaseAndBlocks(db, id))` from `utils/caseItems.ts`.

## Medium severity

**6. Right-clicking a pocket/hat heading offers "Copy card" for the card ABOVE it** — `src/components/SpeechDocViewer.tsx:2838` (`onDocContextMenu`)

```js
if (lvl > 0 && el !== p) return;
```

The `el !== p` exemption means when the *right-clicked* paragraph itself is a shallower
heading (a pocket/hat, not a tag), the backward walk doesn't bail immediately — it keeps
scanning past it and latches onto the *previous* card's tag instead. So right-clicking a
section header offers to copy the card before it, silently wrong.

Fix: bail immediately (before the loop, or as its very first check) if
`headingLevelOf(p, hc) > 0 && headingLevelOf(p, hc) !== maxLevel` — i.e. any heading
that isn't itself the tag level should short-circuit with no menu.

**7. Section selection survives across documents** — `src/components/SpeechDocViewer.tsx:2725` (`sectionSelRef`), reset paths at `:3061` (`resetDocState`) and `:3368` (`reset`)

Neither `resetDocState()` nor `reset()` calls `clearSectionSel()` (or even directly
clears `sectionSelRef.current`). After `containerRef.current.innerHTML = ''` runs on the
next doc load, the refs in `sectionSelRef.current` point at now-detached DOM nodes from
the OLD document — but the copy handler (`onCopy`, `:2788`) still iterates them and will
happily serialize/copy the old doc's sections into the clipboard while viewing a
completely different doc.

Fix: call `clearSectionSel()` (or `sectionSelRef.current = []`) inside both
`resetDocState()` and `reset()`.

**8. The Cmd+C copy-interception handler is global and hijacks copies anywhere in the app** — `src/components/SpeechDocViewer.tsx:2805` (`onCopy` effect)

```js
document.addEventListener('copy', onCopy);
```

This fires for ANY copy event anywhere in the app, not just inside the speech doc
viewer. With a live section selection active, copying text in the find bar, the AI
chat sidebar, or literally any other input/pane returns the doc's selected sections
instead of what the user actually selected there.

Fix: in `onCopy`, check that `document.activeElement`/`window.getSelection()` anchor is
actually inside `containerRef.current` before hijacking; bail otherwise.

**9. Bulk folder-of-docx import silently truncates at 40 docs, and orphans the excess into the new folder anyway** — `src/components/SpeechDocViewer.tsx:32` (`RECENTS_MAX`), `:46` (`addRecents`), `:3334` (`pickFolder`)

`RECENTS_MAX = 40`, and `addRecents` does `[...fresh.map(...), ...existing].slice(0,
RECENTS_MAX)`. The code comment literally says "keep it roomy enough that a bulk import
of many docs doesn't silently evict earlier ones" — but 40 is not roomy for a folder
import (the folder walk cap in `electron/main.ts`'s `dialog:openFolderOfDocx` handler is
2000 files). Worse: `pickFolder()` assigns EVERY discovered doc's key to the newly
created folder via `moveItem`, including docs that got evicted by the `.slice(0, 40)` —
so the folder ends up claiming items the recents list no longer contains.

Also noted in passing: `persistTrustedPath` (electron/main.ts) re-reads and rewrites the
entire `trusted_paths.json` array once per path trusted, so a large folder import does
O(n²) file I/O — not correctness-breaking, just slow for big imports.

Fix: raise `RECENTS_MAX` substantially (or drop the cap / make it configurable), and
make `pickFolder` only assign the folder to docs that actually survived the cap.

**10. Concurrent order-seeding effects can clobber each other's writes** — `src/components/Sidebar.tsx:918` and `src/components/CasesGrid.tsx:116`

Both do `update(() => seeded)` — a hard REPLACE of the whole `CaseFoldersData`, computed
from a `folders` snapshot that may already be stale by the time the write lands. If the
sidebar tree and the grid both seed new items into `order` in the same tick (e.g. a doc
gets imported while both are mounted), the second `update(() => seeded)` call discards
whatever the first one wrote, including any folder assignment made concurrently by
something else. Contrast with the prune effect right above it in `CasesGrid.tsx`
(`:105`), which correctly uses the functional form `update((d) => pruneAssignments(d,
liveKeys))`.

Fix: change both seeding effects to `update((d) => ensureOrderSeeded(d, entries))`
(functional form) instead of computing `seeded` outside and replacing wholesale.

**11. Drag-to-reorder while searching silently re-files documents into the wrong folder** — `src/components/CasesGrid.tsx:130` (`visibleItems` in search mode) vs `:271` (`handleReorderDrop`)

In search mode, `visibleItems` shows results from every folder sorted alphabetically
(deliberately ignoring folder boundaries — see the comment above it). But
`handleReorderDrop` still runs unconditionally and calls `moveItem(d, draggedKey,
targetFolder)`, moving the dragged item into whichever folder the drop-target tile
happens to actually live in. Since results stay alphabetically sorted regardless, this
re-filing is completely invisible to the user in the moment.

Fix: disable/no-op the reorder-drop handlers (`onReorderOver`/`onReorderDrop`) while
`searching` is true.

## Low severity

**12. `pruneAssignments` write-skip check only looks at `assignments`, not `order`** — `src/components/CasesGrid.tsx:104`

The guard compares `Object.keys(next.assignments).length !== Object.keys(folders.assignments).length`
before deciding whether to persist, but `pruneAssignments` also prunes the `order` array
— so if only `order` shrank (all assignments already correct) the write is skipped and
deleted docs' keys accumulate in `order` forever.

Fix: compare on `next.order.length !== folders.order.length` too (or just always write
if either differs).

**13. Cases and docs sort in opposite directions on first order-seed, because cases have no `addedAt`** — `src/utils/caseFolders.ts:276` (`ensureOrderSeeded`), `src/utils/caseItems.ts:84-94` (`buildCaseItems`, case branch never sets `addedAt`)

`buildCaseItems` never populates `addedAt` for `case`/`oc-case` items — only for
`speech-doc` items (from `RecentDoc.addedAt`). In `ensureOrderSeeded`, missing entries
sort by `(b.addedAt ?? '').localeCompare(a.addedAt ?? '')` — cases with `addedAt ===
undefined` all compare equal and fall back to Array.prototype.sort's stability, which
preserves original insertion order (i.e., OLDEST case first), while docs correctly sort
NEWEST-first. So "date added" order means two different things depending on item kind,
in the same list.

Fix: either give `Case` a real `createdAt`/`addedAt` field set at creation time (touches
several case-creation call sites — Home.tsx, CardCutter.tsx, ChatMessage.tsx, Chat.tsx,
SharePanel.tsx, per earlier scoping notes), or accept the current best-effort behavior
and document it.

**14. Drag-hover auto-expand timer isn't cancelled on drag end or component unmount** — `src/components/Sidebar.tsx:687` (`useDragHoverExpand`)

The hook returns `{ hover, cancel }` but nothing calls `cancel()` on unmount (no
`useEffect` cleanup), and — check each call site — not every `onDragEnd` handler calls
`dragExpand.cancel()` either. Hover a collapsed folder for the drag, then press Esc to
abort the drag (native drag-cancel) → the folder still auto-expands ~600ms later even
though the drag is long gone.

Fix: add a `useEffect(() => cancel, [])` cleanup inside `useDragHoverExpand`, and make
sure every `onDragEnd` in both `CasesSection` and `FlowsSection` calls `dragExpand.cancel()`.

**15. Send-to-Flow resolves the destination sheet by array index, not stable id** — `src/components/SpeechDocViewer.tsx:2242` (`send()` in `SendToFlowPopover`)

```js
const sIdx = Math.min(sheetIdx, d.sheets.length - 1);
const sheet = d.sheets[sIdx];
```

`sheetIdx` is captured from a `<select>` populated when the popover opened; `d` is
freshly re-read from storage at send time. If sheets were reordered or a sheet was
deleted in that flow (in another window/tab) between opening the popover and clicking
Send, the card lands on the wrong sheet. This is exactly the class of bug that commit
`f6da591` ("Audit fixes: resolve sheets by id, not index, across flow editor")
fixed everywhere else — this call site in SpeechDocViewer was apparently missed by that
sweep.

Fix: store/select by `sheet.id` instead of array index, same pattern as the rest of the
flow editor post-f6da591.

**16. Three duplicate, slightly-diverged implementations of speech-doc recents read/write** — `src/utils/caseItems.ts` (canonical: `readSpeechDocRecents`/`removeFromRecents`/`renameInRecents`/`writeSpeechDocRecents`) vs `src/components/Sidebar.tsx:19-32` (local reimplementation, own `RecentDoc` type missing `addedAt`) vs `src/components/Home.tsx:441-445` (another local reimplementation, also missing `addedAt`)

Sidebar.tsx already imports other things from `caseItems.ts` but reimplements the
recents read/write functions locally instead of importing the canonical ones — same
logic, copy-pasted, silently able to drift (e.g. the local `RecentDoc` types don't carry
`addedAt`, so if someone adds a new field to the canonical one later these two won't get
it without separately being told to). Also noted: `SpeechDocViewer.tsx` never listens
for the `storage` event itself, so its own idle-screen "Recent" list can go stale if a
doc is removed from recents by the sidebar/grid while the viewer is sitting on the idle
screen. Separately: deleting a case via Sidebar's `NavItem` (`:1656`) and via
`CasesSection.bulkDelete` (`:1027`) both give no undo affordance, while Home's
`CasesPanel.deleteCase` and CasesGrid's `deleteItems` both do (`pushUndoToast`).

Fix (lower priority, more of a cleanup): have Sidebar.tsx and Home.tsx import
`readSpeechDocRecents`/`removeFromRecents`/`renameInRecents`/`writeSpeechDocRecents`
from `utils/caseItems.ts` instead of reimplementing them; add a `storage` listener in
`SpeechDocViewer.tsx`'s idle screen; add `pushUndoToast` to the two delete paths that
currently lack it.

---

## Suggested fix order

Not mandatory, but roughly most-impactful/cheapest first:
1. #1 (card count wrong doc) — one-line fix, pass path as arg
2. #5 (orphaned blocks on Home delete) — one-line fix, reuse existing helper
3. #4 (self-drop yanks out of folder) — small fix, add preventDefault/stopPropagation
4. #3 (Cross-Ex broken for OC cases) — real fix, needs a path or bytes-based extract route
5. #2 (interleaved renders) — needs a render-generation guard threaded through applyRender
6. #6, #7, #8 (small, independent doc-viewer correctness bugs)
7. #9, #10, #11, #12, #13, #14, #15 (medium/low, mostly independent, can be done in any order)
8. #16 (cleanup, lowest priority, not a functional bug on its own)
