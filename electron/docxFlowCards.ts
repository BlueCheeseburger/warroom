// Structured tag+cite extraction for Auto Flow. Unlike speechdoc:extract in
// main.ts (which flattens everything to a joined string), this keeps the
// heading HIERARCHY: each card comes back with its pocket/hat/block ancestor
// text, not just its own tag. That's what Auto Flow needs to route a card to
// the right speech column (from the pocket label) and the right flow tab
// (from the hat/block). See DEBATE_DOC_STRUCTURE.md §1–2 for the document
// model this mirrors.
//
// A bare tag with no Normal paragraph under it is an analytic/label heading,
// not an evidence card (§2) — skipped here, same as speechdoc:extract's cite
// detection in main.ts.
//
// NEVER reads card body: only headings + the first paragraph after a tag (the
// cite) are read. Auto Flow's whole point is routing tags, not re-cutting
// cards — see the CLAUDE.md instruction this feature was built against.
//
// Pulled out of main.ts as a pure function (XML strings in, data out — no
// fs/JSZip/ipcMain) so scripts/test-docx-flow-cards.ts can exercise the
// heading-collapse logic headlessly. The IPC handler (speechdoc:extractBlocks,
// main.ts) does the file I/O and calls this.

export interface ExtractedFlowCard {
  pocket: string | null;
  hat: string | null;
  block: string | null;
  tag: string;
  cite: string;
}

export function extractFlowCardsFromXml(xml: string, headingLevels: Map<string, number>): ExtractedFlowCard[] {
  const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const getStyle = (p: string) => (p.match(/w:pStyle\s+w:val="([^"]+)"/) ?? [])[1] ?? 'Normal';
  const levelOfStyle = (style: string) => headingLevels.get(style) ?? 0;

  const paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)];
  let maxLevel = 0;
  for (const paraMatch of paras) maxLevel = Math.max(maxLevel, levelOfStyle(getStyle(paraMatch[0])));
  if (maxLevel === 0) return [];

  // Real docs skip heading levels (H1 straight to H4, no H2/H3 used) — collapse
  // the DISTINCT levels present to consecutive depths, same approach as the
  // viewer's outline panel (SpeechDocViewer.tsx, "Collapse level gaps"), so a
  // doc using only two levels still gets pocket→tag instead of pocket→(empty
  // hat)→(empty block)→tag.
  const levelsPresent = new Set<number>();
  for (const paraMatch of paras) {
    const lvl = levelOfStyle(getStyle(paraMatch[0]));
    if (lvl > 0) levelsPresent.add(lvl);
  }
  const depths = [...levelsPresent].sort((a, b) => a - b);
  const depthOf = (lvl: number) => depths.indexOf(lvl);
  const tagDepth = depths.length - 1; // deepest present level = the tag
  const ancestorSlots = tagDepth; // depths 0..tagDepth-1 are ancestors

  // role(depth) assigns pocket/hat/block to ancestor depths, counted from the
  // SHALLOW end — pocket first. This matters most for the sparse cases: a doc
  // with only ONE ancestor level (e.g. bare "1AC"/"2NC" headings directly above
  // tags, extremely common in disclosed docs with no hat/block breakdown) must
  // call that level "pocket", since Auto Flow's speech-column routing reads
  // card.pocket for the "1AC"/"2NC" label — mislabeling it "block" would leave
  // pocket null and break routing for exactly the doc shape that matters most.
  // Only when there are MORE than 3 ancestor levels (rare) do the two closest
  // to the tag become hat/block and everything shallower collapses into pocket.
  function roleOf(depth: number): 'pocket' | 'hat' | 'block' | null {
    if (ancestorSlots <= 0) return null;
    if (ancestorSlots === 1) return depth === 0 ? 'pocket' : null;
    if (ancestorSlots === 2) return depth === 0 ? 'pocket' : 'hat';
    if (depth === ancestorSlots - 1) return 'block';
    if (depth === ancestorSlots - 2) return 'hat';
    return 'pocket';
  }

  const ancestors: { pocket: string | null; hat: string | null; block: string | null } = { pocket: null, hat: null, block: null };
  const cards: ExtractedFlowCard[] = [];
  let pendingTag: string | null = null;
  let pendingAncestors: typeof ancestors | null = null;

  for (const paraMatch of paras) {
    const p = paraMatch[0];
    const text = strip(p);
    if (!text) continue;
    const level = levelOfStyle(getStyle(p));

    if (level > 0) {
      // A new heading closes out any tag still waiting for its cite — a bare
      // tag with nothing under it is a label, not a card (drop it).
      pendingTag = null;
      pendingAncestors = null;

      const depth = depthOf(level);
      if (depth === tagDepth) {
        pendingTag = text;
        pendingAncestors = { ...ancestors };
      } else {
        const role = roleOf(depth);
        if (role) {
          ancestors[role] = text;
          // A new hat/pocket heading starts a fresh block/hat under it.
          if (role === 'pocket') { ancestors.hat = null; ancestors.block = null; }
          else if (role === 'hat') { ancestors.block = null; }
        }
      }
    } else if (pendingTag !== null && pendingAncestors) {
      cards.push({ ...pendingAncestors, tag: pendingTag, cite: text });
      pendingTag = null;
      pendingAncestors = null;
    }
    // Non-heading paragraphs beyond the cite (the card body) are the very
    // thing this module must never read — deliberately not walked further.
  }

  return cards;
}
