import React, { useRef, useState, useEffect } from 'react';
import { useApp, FlowMeta } from '../store/appStore';
import { AIQuestion, AIClarification, ExtractedFlowCard } from '../types';
import AIQuestionPrompt from './AIQuestionPrompt';
import { LoadingState } from './Spinner';
import ProgressBar from './ProgressBar';
import { humanizeGeminiError } from '../utils/geminiError';
import { escapeHtml } from '../lib/cellHtml';
import { useDragActive } from '../hooks/useDragActive';
import { readAutoFlowTagStyle } from '../lib/autoFlowTagStyle';
import { findColumnIndex, firstEmptyRow, inferEventFromPockets, inferVariantFromHats } from '../lib/autoFlowPlacement';
import {
  StoredFlowData, SheetData, PolicyVariant, PFOrder,
  POLICY_COLS, PF_PRO_FIRST_COLS, PF_CON_FIRST_COLS,
  SHEETS_STOCK_ISSUES, SHEETS_ADVANTAGE, SHEETS_PF,
  NUM_ROWS, makeDefaultData,
} from './FlowView';

// Auto Flow: upload one or many speech docs, and Warroom AI sorts their tags into
// the right column/sheet of a flow — either a brand new one or an existing one.
// It only ever reads tags + cites + heading structure (via speechdoc:extractBlocks
// / ExtractedFlowCard), never card bodies. See DEBATE_DOC_STRUCTURE.md for the
// document model this is built against, and CardCutter.tsx for the AI
// question-pause-resume pattern this file copies (runClassify/answerQuestion
// mirror its runEmphasize/answerQuestion).

type Step = 'upload' | 'extracting' | 'target' | 'classifying' | 'review' | 'writing' | 'done';

interface DocResult {
  fileName: string;
  path: string;
  cards: ExtractedFlowCard[];
  error?: string;
}

// Normalizes a tag for matching "respondsTo" against the tag it names — the AI is
// told to copy the target tag EXACTLY, but in practice it sometimes fixes a typo,
// drops trailing punctuation, or collapses whitespace, so an exact string compare
// silently drops most same-row alignments. Strip case/punctuation/spacing so
// those harmless variations still match.
function normTag(s: string): string {
  return s.trim().toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Best-effort lookup of the card a placement answers. Tries an exact normalized
// match first, then a substring match either direction (the AI paraphrased or
// truncated it), then falls back to the entry with the highest word overlap —
// only accepted above a similarity floor, so an unrelated card is never chosen.
function resolveRespondsTo<T>(respondsTo: string, index: Map<string, T>): T | undefined {
  const key = normTag(respondsTo);
  if (!key) return undefined;
  const exact = index.get(key);
  if (exact) return exact;

  let best: T | undefined; let bestScore = 0;
  const keyWords = new Set(key.split(' ').filter(Boolean));
  for (const [k, v] of index) {
    if (k.includes(key) || key.includes(k)) return v; // substring match — good enough
    const kWords = new Set(k.split(' ').filter(Boolean));
    const overlap = [...keyWords].filter((w) => kWords.has(w)).length;
    const union = new Set([...keyWords, ...kWords]).size || 1;
    const score = overlap / union;
    if (score > bestScore) { bestScore = score; best = v; }
  }
  return bestScore >= 0.5 ? best : undefined;
}

// Word count of a tagline — the cap the AI summary must come in strictly under.
// Preloaded at extract time (see extractAll) so it's ready without recomputation
// the moment the user turns on summary mode. See CLAUDE.md's preload guidance.
function tagWordCount(tag: string): number {
  return tag.trim().split(/\s+/).filter(Boolean).length || 1;
}

interface Placement {
  id: string;
  fileName: string;
  tag: string;
  cite: string;
  column: string;
  sheetName: string;
  isNewSheet: boolean;
  // The tag text of the card this one directly answers (from the classify step),
  // or null. Drives same-row alignment + arrow drawing in the write step.
  respondsTo: string | null;
  // The plan text (policy) — forced to the first cell of the first sheet.
  isPlan: boolean;
  // Which family the card's sheet belongs to (from the classify step), driving
  // tab ORDER in the write step: 'advantage' = aff case position (advantages
  // first, in 1AC order), 'offcase' = neg off-case, null = existing/structural.
  sheetRole: 'advantage' | 'offcase' | null;
  // AI-generated short summary (only when summary mode is on). When present the
  // write step writes THIS instead of tag+cite, and marks the cell as an AI cell.
  summary?: string;
  removed: boolean;
}

type TargetCtx =
  | { kind: 'existing'; flowId: string }
  | { kind: 'new'; event: 'policy' | 'pf'; variant: PolicyVariant; pfOrder: PFOrder };

interface ClassifyCtx {
  docs: { fileName: string; cards: ExtractedFlowCard[] }[];
  existingColumns: string[];
  existingSheetNames: string[];
  event: 'policy' | 'pf';
  variantLabel: string;
}

interface AutoFlowProgress {
  phase: 'classifying' | 'summarizing';
  batchesDone: number;
  totalBatches: number;
  cardsDone: number;
  cardsTotal: number;
}

/** Returned by ai:autoFlowClassify — see the handler's `stats` field. */
interface ClassifyStats {
  cardsIn: number;
  placed: number;
  /** Placement objects the AI returned that were missing tag/column/sheetName. */
  dropped: number;
  batches: number;
}

interface SkippedPlacement {
  tag: string;
  sheetName: string;
  column: string;
  reason: string;
}

function columnsForEvent(event: 'policy' | 'pf', pfOrder: PFOrder): string[] {
  return event === 'policy' ? POLICY_COLS : (pfOrder === 'pro-first' ? PF_PRO_FIRST_COLS : PF_CON_FIRST_COLS);
}
function sheetsForVariant(event: 'policy' | 'pf', variant: PolicyVariant): string[] {
  return event === 'pf' ? SHEETS_PF : (variant === 'advantage' ? SHEETS_ADVANTAGE : SHEETS_STOCK_ISSUES);
}

// Builds the cell HTML for one card's tag+cite, honoring the user's Auto Flow tag
// style (Settings → Auto Flow tag style). Only bold/italic/underline are applied
// — color and fontSize are NOT, because a flow cell can't carry them (see the
// comment in src/lib/autoFlowTagStyle.ts and src/lib/cellHtml.ts's
// ALLOWED_STYLE_PROPS: no per-run color or font-size support in a cell, so
// writing them would just be silently stripped the next time the flow renders).
function buildCellHtml(tag: string, cite: string, summary?: string): string {
  const style = readAutoFlowTagStyle();
  const useSummary = !!(summary && summary.trim());
  // A summary REPLACES tag + cite (that's the whole point of summary mode); it
  // still gets the user's tag emphasis, but no cite line underneath.
  let t = escapeHtml(useSummary ? summary!.trim() : tag);
  if (style.underline) t = `<u>${t}</u>`;
  if (style.italic) t = `<i>${t}</i>`;
  if (style.bold) t = `<b>${t}</b>`;
  return useSummary ? t : `${t}<br>${escapeHtml(cite)}`;
}

export default function AutoFlow({ onClose }: { onClose: () => void }) {
  const { event, flowsIndex, setFlowsIndex, setView } = useApp();
  const [step, setStep] = useState<Step>('upload');
  const { dragActive, setDragActive, dragHandlers } = useDragActive();
  const [error, setError] = useState('');

  const [docs, setDocs] = useState<DocResult[]>([]);
  // Preloaded at upload: word count of every tagline, keyed `fileName tag`.
  // Ready to become the AI summary's word cap without recomputing later.
  const wordCounts = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && step !== 'writing') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, step]);

  // Target step
  const [targetMode, setTargetMode] = useState<'new' | 'existing'>('new');
  const [selectedFlowId, setSelectedFlowId] = useState<string>('');
  const [newEvent, setNewEvent] = useState<'policy' | 'pf'>('policy');
  const [newVariant, setNewVariant] = useState<PolicyVariant>('stock-issues');
  const [newPfOrder, setNewPfOrder] = useState<PFOrder>('pro-first');
  const [variantInferred, setVariantInferred] = useState(false);
  // Opt-in: replace each card's tag+cite with a short AI summary of the card
  // (built from tag + body), capped under the tagline's own word count. Off by
  // default — it reads card bodies (sent to the AI) and costs an extra call.
  const [summarize, setSummarize] = useState(false);
  const [summarizing, setSummarizing] = useState(false);

  // Classify / question-pause-resume (mirrors CardCutter's runEmphasize/answerQuestion)
  const [clarifications, setClarifications] = useState<AIClarification[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<AIQuestion | null>(null);
  const [pendingClassify, setPendingClassify] = useState<ClassifyCtx | null>(null);
  const [answering, setAnswering] = useState(false);
  const [targetCtx, setTargetCtx] = useState<TargetCtx | null>(null);

  // Batch progress, pushed from the main process as each classify/summarize
  // batch lands — so a long run shows real movement instead of a blank spinner.
  const [progress, setProgress] = useState<AutoFlowProgress | null>(null);
  useEffect(() => {
    const off = window.warroom.autoFlow?.onProgress?.((p) => setProgress(p));
    return () => off?.();
  }, []);

  // Review
  const [placements, setPlacements] = useState<Placement[]>([]);
  // How many cards went in vs. how many placements came back — shown on the
  // review step so a shortfall is visible instead of silently looking like the
  // docs just had fewer cards.
  const [classifyStats, setClassifyStats] = useState<ClassifyStats | null>(null);

  // Writing / done
  const [writeSummary, setWriteSummary] = useState<{ written: number; skipped: SkippedPlacement[] } | null>(null);

  // ── Step 1: upload ──────────────────────────────────────────────────────────

  async function extractAll(paths: string[]) {
    setStep('extracting');
    setError('');
    const results: DocResult[] = [];
    const counts = new Map<string, number>();
    for (const p of paths) {
      const fileName = p.split(/[\\/]/).pop() || p;
      try {
        const res = await (window.warroom as any).speechdoc.extractBlocks(p);
        if (res?.ok && Array.isArray(res.data?.cards)) {
          const cards: ExtractedFlowCard[] = res.data.cards;
          // Preload each tagline's word count now — see CLAUDE.md's preload rule.
          for (const c of cards) counts.set(`${fileName} ${c.tag.trim().toLowerCase()}`, tagWordCount(c.tag));
          results.push({
            fileName, path: p, cards,
            error: cards.length === 0 ? 'No cards found in this doc.' : undefined,
          });
        } else {
          results.push({ fileName, path: p, cards: [], error: res?.error || 'Could not read this file.' });
        }
      } catch (e: any) {
        results.push({ fileName, path: p, cards: [], error: e?.message || 'Could not read this file.' });
      }
    }
    wordCounts.current = counts;
    setDocs(results);

    // Infer the event for a NEW flow from the pockets seen across every doc. The
    // Policy/PF switcher was removed from the UI, so this inference (falling back
    // to the app's current event) is what actually decides the layout.
    const allPockets = results.flatMap((d) => d.cards.map((c) => c.pocket));
    const inferred = inferEventFromPockets(allPockets);
    const resolvedEvent = inferred ?? (event === 'pf' ? 'pf' : 'policy');
    setNewEvent(resolvedEvent);

    // For a policy flow, also pre-select Stock Issues vs. Advantage from the aff's
    // hat/block structure — same "infer a default the user reviews" idea as event.
    const allHats = results.flatMap((d) => d.cards.flatMap((c) => [c.hat, c.block]));
    const inferredVariant = resolvedEvent === 'policy' ? inferVariantFromHats(allHats) : null;
    setNewVariant(inferredVariant ?? 'stock-issues');
    setVariantInferred(!!inferredVariant);

    setStep('target');
  }

  async function pickFiles() {
    const paths = await window.warroom.dialog.openFiles(['docx']);
    if (!paths || paths.length === 0) return;
    await extractAll(paths);
  }

  // ── Step 2 → 3: target, then kick off classify ──────────────────────────────

  async function runClassify(clars: AIClarification[], ctx: ClassifyCtx) {
    setPendingClassify(ctx);
    setPendingQuestion(null);
    setClarifications(clars);
    setStep('classifying');
    setError('');
    setProgress(null);
    setClassifyStats(null);
    try {
      const res = await (window.warroom as any).ai.autoFlowClassify({
        docs: ctx.docs,
        existingSheetNames: ctx.existingSheetNames,
        existingColumns: ctx.existingColumns,
        event: ctx.event,
        variant: ctx.variantLabel,
        clarifications: clars,
      });
      if (!res?.ok) throw new Error(res?.error || 'Could not sort these cards.');
      if (res.question) { setPendingQuestion(res.question); return; }
      if (res.stats) setClassifyStats(res.stats as ClassifyStats);
      let list: Placement[] = (res.placements || []).map((p: any) => ({
        id: crypto.randomUUID(),
        fileName: p.fileName,
        tag: p.tag,
        cite: p.cite,
        column: p.column,
        sheetName: p.sheetName,
        isNewSheet: !!p.isNewSheet,
        respondsTo: typeof p.respondsTo === 'string' && p.respondsTo.trim() ? p.respondsTo.trim() : null,
        isPlan: !!p.isPlan,
        sheetRole: p.sheetRole === 'advantage' || p.sheetRole === 'offcase' ? p.sheetRole : null,
        removed: false,
      }));
      // Opt-in summary pass: replace each card's tag+cite with a short AI summary
      // (built from tag + body, capped under the tagline's word count). Bodies are
      // re-read in the main process from the source paths and never come back here.
      if (summarize && list.length > 0) {
        setSummarizing(true);
        try {
          const files = docs.filter((d) => d.cards.length > 0).map((d) => ({ fileName: d.fileName, path: d.path }));
          const cards = list.map((p) => ({
            fileName: p.fileName,
            tag: p.tag,
            maxWords: wordCounts.current.get(`${p.fileName} ${p.tag.trim().toLowerCase()}`) ?? tagWordCount(p.tag),
          }));
          const sres = await (window.warroom as any).ai.autoFlowSummarize({ files, cards });
          if (sres?.ok && Array.isArray(sres.summaries)) {
            const byKey = new Map<string, string>();
            for (const s of sres.summaries) byKey.set(`${s.fileName} ${String(s.tag).trim().toLowerCase()}`, s.summary);
            list = list.map((p) => {
              const sum = byKey.get(`${p.fileName} ${p.tag.trim().toLowerCase()}`);
              return sum && sum.trim() ? { ...p, summary: sum.trim() } : p;
            });
          }
        } catch { /* summaries are best-effort — fall back to tag+cite for any that fail */ }
        finally { setSummarizing(false); }
      }
      setPlacements(list);
      setStep('review');
    } catch (e: any) {
      setError(humanizeGeminiError(e?.message) || e?.message || 'Warroom AI could not sort these cards.');
      setStep('target');
    } finally {
      setProgress(null);
    }
  }

  async function answerQuestion(answer: string) {
    if (!pendingQuestion || !pendingClassify || answering) return;
    setAnswering(true);
    const next = [...clarifications, { question: pendingQuestion.question, answer }];
    await runClassify(next, pendingClassify);
    setAnswering(false);
  }

  async function confirmTarget() {
    setError('');
    const usableDocs = docs.filter((d) => d.cards.length > 0);
    if (usableDocs.length === 0) {
      setError('None of the uploaded docs had any cards to sort.');
      return;
    }
    const docsForClassify = usableDocs.map((d) => ({ fileName: d.fileName, cards: d.cards }));

    if (targetMode === 'existing') {
      if (!selectedFlowId) { setError('Pick a flow to add into.'); return; }
      const data: StoredFlowData | null = await window.warroom.storage.read(`flow_data_${selectedFlowId}`);
      if (!data) { setError('Could not load that flow — try picking it again.'); return; }
      const existingColumns = data.customColumns ?? columnsForEvent(data.event, data.pfOrder);
      const existingSheetNames = data.sheets.map((s) => s.name);
      const variantLabel = data.event === 'policy' ? data.variant : data.pfOrder;
      setTargetCtx({ kind: 'existing', flowId: selectedFlowId });
      await runClassify(clarifications, { docs: docsForClassify, existingColumns, existingSheetNames, event: data.event, variantLabel });
    } else {
      const existingColumns = columnsForEvent(newEvent, newPfOrder);
      const existingSheetNames = sheetsForVariant(newEvent, newVariant);
      const variantLabel = newEvent === 'policy' ? newVariant : newPfOrder;
      setTargetCtx({ kind: 'new', event: newEvent, variant: newVariant, pfOrder: newPfOrder });
      await runClassify(clarifications, { docs: docsForClassify, existingColumns, existingSheetNames, event: newEvent, variantLabel });
    }
  }

  // ── Step 4: review ──────────────────────────────────────────────────────────

  function toggleRemoved(id: string) {
    setPlacements((prev) => prev.map((p) => (p.id === id ? { ...p, removed: !p.removed } : p)));
  }

  const acceptedCount = placements.filter((p) => !p.removed).length;

  // ── Step 5: write ────────────────────────────────────────────────────────────

  async function commitWrite() {
    if (!targetCtx) return;
    setStep('writing');
    setError('');
    try {
      const accepted = placements.filter((p) => !p.removed);
      let flowId: string;
      let data: StoredFlowData;
      let isNewFlow = false;

      if (targetCtx.kind === 'existing') {
        flowId = targetCtx.flowId;
        const fresh: StoredFlowData | null = await window.warroom.storage.read(`flow_data_${flowId}`);
        if (!fresh) throw new Error('That flow no longer exists.');
        data = fresh;
      } else {
        flowId = crypto.randomUUID();
        data = makeDefaultData(targetCtx.event, targetCtx.variant, targetCtx.pfOrder);
        isNewFlow = true;
      }

      const columns = data.customColumns ?? columnsForEvent(data.event, data.pfOrder);
      const sheets: SheetData[] = data.sheets.map((s) => ({
        ...s, cells: { ...s.cells },
        arrows: s.arrows ? [...s.arrows] : undefined,
        aiCells: s.aiCells ? [...s.aiCells] : undefined,
      }));
      const sheetIndexByName = new Map<string, number>();
      sheets.forEach((s, i) => sheetIndexByName.set(s.name.trim().toLowerCase(), i));

      const skipped: SkippedPlacement[] = [];
      let written = 0;
      // Where each written card landed, keyed by its tag — so a card that answers
      // another can align to it and/or draw an arrow back.
      const placedByTag = new Map<string, { sheetIdx: number; ri: number; ci: number }>();
      // AI-summarized cards' text, grouped by the sheet they landed on — folded
      // into that sheet's `aiSummary` once writing is done, for the tab hover
      // tooltip. Reuses the summaries already generated above; no extra AI call.
      const summariesBySheet = new Map<number, string[]>();

      // Numbered slot names from the default layouts ("Off 2", "Adv 1",
      // "Contention 2") are placeholders, not topics. When the AI proposes a new
      // position sheet ("Fism DA", "Warming"), rename the first UNTOUCHED
      // placeholder to it instead of appending a tab at the end — that's what
      // names each case/off-case position's tab after the position, and keeps a
      // fresh Auto Flow from ending up as named tabs stacked after a row of dead
      // "Off 1…Off 4" defaults. Only a placeholder with zero written cells is
      // ever taken over, so nothing a user (or an earlier pass) wrote can be
      // absorbed into a rename.
      const PLACEHOLDER_RE = /^(off|adv|advantage|contention)\s*\d+$/i;
      // The default tabs that are STRUCTURAL, not numbered placeholders — kept even
      // when they end up blank (RFD/Notes; the stock-issues aff tabs; PF's Turns).
      // Captured now, from the still-default sheet names, before the pre-pass below
      // renames any placeholder slots. Everything else that ends up blank on a NEW
      // flow gets pruned at the end (see the prune pass), so a 2-advantage doc
      // doesn't leave a dead "Adv 3" tab and a skipped card can't strand a
      // named-but-empty sheet.
      const structuralKeepNames = new Set(
        sheets.filter((s) => !PLACEHOLDER_RE.test(s.name.trim())).map((s) => s.name.trim().toLowerCase())
      );
      // Role of each proposed sheet name, so a sheet that reaches ensureSheet
      // without having been slotted by the pre-pass below still lands in the
      // right FAMILY of placeholder. Without this, an off-case position could
      // take an empty "Adv 2" slot (first placeholder wins), putting a DA in
      // among the advantages and breaking the advantages-first ordering.
      const roleByName = new Map<string, 'advantage' | 'offcase'>();
      for (const p of accepted) {
        const k = p.sheetName.trim().toLowerCase();
        if (p.sheetRole && !roleByName.has(k)) roleByName.set(k, p.sheetRole);
      }
      const emptySlot = (s: SheetData) =>
        !Object.values(s.cells).some((v) => String(v ?? '').trim());
      const ensureSheet = (name: string): number => {
        const key = name.trim().toLowerCase();
        let idx = sheetIndexByName.get(key);
        if (idx === undefined) {
          const role = roleByName.get(key);
          const familyRe = role === 'advantage' ? /^(adv|advantage|contention)\s*\d+$/i
            : role === 'offcase' ? /^off\s*\d+$/i
            : null;
          // Prefer a slot of this position's own family; fall back to any free
          // placeholder, then to appending a brand-new tab.
          let slot = familyRe
            ? sheets.findIndex((s) => familyRe.test(s.name.trim()) && emptySlot(s))
            : -1;
          if (slot === -1) {
            slot = sheets.findIndex((s) => PLACEHOLDER_RE.test(s.name.trim()) && emptySlot(s));
          }
          if (slot !== -1) {
            sheetIndexByName.delete(sheets[slot].name.trim().toLowerCase());
            sheets[slot] = { ...sheets[slot], name };
            idx = slot;
          } else {
            sheets.push({ id: crypto.randomUUID(), name, cells: {} });
            idx = sheets.length - 1;
          }
          sheetIndexByName.set(key, idx);
        }
        return idx;
      };
      const writeCard = (sheetIdx: number, ri: number, ci: number, p: Placement) => {
        const cellKey = `${ri}-${ci}`;
        sheets[sheetIdx].cells[cellKey] = buildCellHtml(p.tag, p.cite, p.summary);
        if (p.summary && p.summary.trim()) {
          const ai = sheets[sheetIdx].aiCells ?? [];
          ai.push(cellKey);
          sheets[sheetIdx].aiCells = ai;
          const list = summariesBySheet.get(sheetIdx) ?? [];
          list.push(p.summary.trim());
          summariesBySheet.set(sheetIdx, list);
        }
        placedByTag.set(normTag(p.tag), { sheetIdx, ri, ci });
        written++;
      };
      const addArrow = (sheetIdx: number, from: string, to: string) => {
        const arrows = sheets[sheetIdx].arrows ?? [];
        arrows.push({ id: crypto.randomUUID(), from, to });
        sheets[sheetIdx].arrows = arrows;
      };

      // Tab-ORDER pre-pass — advantages first, in 1AC order, then off-case.
      // The AI returns placements in document (1AC) order and tags each with a
      // sheetRole, so the distinct new 'advantage' sheets in first-appearance
      // order ARE the aff's advantages 1..N: they claim the leftmost aff
      // placeholder slots ("Adv N" for policy, "Contention N" for PF), and the
      // distinct new 'offcase' sheets claim the "Off N" slots after them. Since
      // those aff slots come before the off slots in every default layout, this
      // is what makes advantage tabs sit first, in the order they came up in the
      // 1AC. Runs BEFORE any card is placed, so it only ever renames still-empty
      // placeholder slots; once a name is slotted here, ensureSheet finds it as
      // an existing sheet and won't re-slot it. Names that don't cleanly fit a
      // role (or spill past the available slots) fall through to ensureSheet's
      // own placeholder-or-append logic during Pass 1.
      const AFF_SLOT_RE = /^(adv|advantage|contention)\s*\d+$/i;
      const OFF_SLOT_RE = /^off\s*\d+$/i;
      const distinctNewByRole = (role: 'advantage' | 'offcase'): string[] => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const p of accepted) {
          if (!p.isNewSheet || p.sheetRole !== role) continue;
          const key = p.sheetName.trim().toLowerCase();
          if (!key || seen.has(key) || sheetIndexByName.has(key)) continue;
          seen.add(key);
          out.push(p.sheetName.trim());
        }
        return out;
      };
      const slotInto = (names: string[], slotRe: RegExp) => {
        for (const name of names) {
          const key = name.toLowerCase();
          if (sheetIndexByName.has(key)) continue; // already slotted
          const slot = sheets.findIndex((s) =>
            slotRe.test(s.name.trim()) &&
            !Object.values(s.cells).some((v) => String(v ?? '').trim()));
          if (slot === -1) continue; // no empty slot of this family left — ensureSheet appends it later
          sheetIndexByName.delete(sheets[slot].name.trim().toLowerCase());
          sheets[slot] = { ...sheets[slot], name };
          sheetIndexByName.set(key, slot);
        }
      };
      slotInto(distinctNewByRole('advantage'), AFF_SLOT_RE);
      slotInto(distinctNewByRole('offcase'), OFF_SLOT_RE);

      // Pass 0 — the plan text (policy) always goes to the very first cell of the
      // very first sheet, regardless of what column/sheet the AI proposed for it.
      // Falls back to the first empty row of column 0 if 0-0 is already taken
      // (adding into an existing flow that already has a plan there).
      const planCard = accepted.find((p) => p.isPlan);
      if (planCard && sheets.length > 0) {
        const c0Empty = !((sheets[0].cells['0-0'] ?? '').trim());
        const ri = c0Empty ? 0 : firstEmptyRow(sheets[0].cells, 0, NUM_ROWS);
        if (ri !== -1) writeCard(0, ri, 0, planCard);
        else skipped.push({ tag: planCard.tag, sheetName: sheets[0].name, column: columns[0] ?? '1AC', reason: 'first column is full' });
      }

      // Pass 1 — every card that does NOT answer another card (originals). Placed
      // first so their positions are known when Pass 2 aligns answers to them.
      for (const p of accepted) {
        if (p.isPlan || p.respondsTo) continue;
        const sheetIdx = ensureSheet(p.sheetName);
        const colIdx = findColumnIndex(columns, p.column);
        if (colIdx === -1) { skipped.push({ tag: p.tag, sheetName: p.sheetName, column: p.column, reason: 'column not found' }); continue; }
        const row = firstEmptyRow(sheets[sheetIdx].cells, colIdx, NUM_ROWS);
        if (row === -1) { skipped.push({ tag: p.tag, sheetName: p.sheetName, column: p.column, reason: 'column is full' }); continue; }
        writeCard(sheetIdx, row, colIdx, p);
      }

      // Pass 2 — answering cards. Try to sit an answer on the SAME ROW as the
      // card it answers (so they line up like a paper flow). When that row is
      // already taken (e.g. a second card answering the same one), it drops to
      // the next empty row and an arrow is drawn from the answered card to it, so
      // the connection stays visible. Only same-sheet answers can align/arrow —
      // arrow endpoints are cell keys within one sheet.
      //
      // Worklist, not a single loop: a response can itself be answered by a LATER
      // response (1NC turn → 2AC answer → 1NR extension), and the AI's output
      // order isn't guaranteed to keep that chain in doc order. Repeatedly write
      // whichever remaining cards already have their target placed, so multi-
      // level chains still resolve regardless of list order; only genuinely
      // unresolvable cards (dangling/cyclic respondsTo) fall through unaligned.
      let remaining = accepted.filter((p) => !p.isPlan && !!p.respondsTo);
      while (remaining.length > 0) {
        const stillRemaining: Placement[] = [];
        let progressed = false;
        for (const p of remaining) {
          const sheetIdx = ensureSheet(p.sheetName);
          const colIdx = findColumnIndex(columns, p.column);
          if (colIdx === -1) { skipped.push({ tag: p.tag, sheetName: p.sheetName, column: p.column, reason: 'column not found' }); progressed = true; continue; }

          const answered = resolveRespondsTo(p.respondsTo!, placedByTag);
          if (!answered) { stillRemaining.push(p); continue; }

          const cells = sheets[sheetIdx].cells;
          if (answered.sheetIdx === sheetIdx && answered.ci !== colIdx && !((cells[`${answered.ri}-${colIdx}`] ?? '').trim())) {
            writeCard(sheetIdx, answered.ri, colIdx, p); // same row, adjacency IS the link — no arrow
          } else {
            const row = firstEmptyRow(cells, colIdx, NUM_ROWS);
            if (row === -1) { skipped.push({ tag: p.tag, sheetName: p.sheetName, column: p.column, reason: 'column is full' }); progressed = true; continue; }
            writeCard(sheetIdx, row, colIdx, p);
            if (answered.sheetIdx === sheetIdx) addArrow(sheetIdx, `${answered.ri}-${answered.ci}`, `${row}-${colIdx}`);
          }
          progressed = true;
        }
        if (!progressed) {
          // Nothing left resolved this round — the rest never will (target not in
          // this batch, or a cycle). Write them plainly so they still land.
          for (const p of stillRemaining) {
            const sheetIdx = ensureSheet(p.sheetName);
            const colIdx = findColumnIndex(columns, p.column);
            if (colIdx === -1) { skipped.push({ tag: p.tag, sheetName: p.sheetName, column: p.column, reason: 'column not found' }); continue; }
            const row = firstEmptyRow(sheets[sheetIdx].cells, colIdx, NUM_ROWS);
            if (row === -1) { skipped.push({ tag: p.tag, sheetName: p.sheetName, column: p.column, reason: 'column is full' }); continue; }
            writeCard(sheetIdx, row, colIdx, p);
          }
          break;
        }
        remaining = stillRemaining;
      }

      // Fold each sheet's AI card summaries into a short tab-hover blurb — reuses
      // text already generated above, no extra AI call. Joins up to 3, truncated.
      for (const [sheetIdx, list] of summariesBySheet) {
        const joined = list.slice(0, 3).join(' · ');
        sheets[sheetIdx].aiSummary = joined.length > 160 ? joined.slice(0, 159) + '…' : joined;
      }

      // Prune leftover blank tabs — only on a NEW flow (an existing flow's empty
      // tabs are the user's own, never touched). Drops any sheet that ended up
      // with no written cell AND isn't a structural keep (RFD/Notes, stock aff
      // tabs, PF Turns): a 2-advantage doc's unused "Adv 3", the unused "Off 3"/
      // "Off 4" slots, and any named-but-empty sheet a skipped card left behind.
      // Guards against ever emptying the flow to zero sheets.
      let finalSheets = sheets;
      if (isNewFlow) {
        const kept = sheets.filter((s) => {
          const hasContent = Object.values(s.cells).some((v) => String(v ?? '').trim());
          return hasContent || structuralKeepNames.has(s.name.trim().toLowerCase());
        });
        if (kept.length > 0) finalSheets = kept;
      }

      const updated: StoredFlowData = { ...data, sheets: finalSheets };
      await window.warroom.storage.write(`flow_data_${flowId}`, updated);

      if (isNewFlow && targetCtx.kind === 'new') {
        const firstName = docs.find((d) => d.cards.length > 0)?.fileName?.replace(/\.docx$/i, '');
        const meta: FlowMeta = {
          id: flowId,
          name: firstName || `Auto Flow ${flowsIndex.length + 1}`,
          event: targetCtx.event,
          createdAt: new Date().toISOString(),
        };
        const newIndex = [...flowsIndex, meta];
        setFlowsIndex(newIndex);
        await window.warroom.storage.write('flows_index', newIndex);
      }

      setWriteSummary({ written, skipped });
      if (skipped.length === 0) {
        setView({ kind: 'flow', flowId });
        onClose();
      } else {
        setStep('done');
        // Still navigate to the flow so the user can see what landed, but stay
        // open with the skip summary rather than closing silently.
        setView({ kind: 'flow', flowId });
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to write into the flow.');
      setStep('review');
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const totalCards = docs.reduce((n, d) => n + d.cards.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={step === 'writing' ? undefined : onClose}>
      <div className="glass-elevated rounded-md w-full max-w-2xl max-h-[88vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-line flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-semibold">Auto Flow — sort speech docs into a flow</h2>
            <p className="text-xs text-ink/40">{stepLabel(step)}</p>
          </div>
          <button className="text-ink/40 hover:text-ink text-lg leading-none" onClick={onClose}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin p-5">
          {error && (
            <div className="mb-3 border border-danger/30 rounded-sm bg-danger/5 p-2.5 text-sm text-danger">{error}</div>
          )}

          {/* STEP: upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              <p className="text-sm text-ink/60">
                Upload one or more speech docs (<code>.docx</code>). Warroom AI reads only the tags,
                cites, and heading structure — never the card bodies — and sorts each card into the
                right column and sheet of a flow.
              </p>
              <div
                className="flex flex-col items-center justify-center p-10 text-center border-2 rounded-sm cursor-pointer transition"
                style={{
                  borderStyle: 'dashed',
                  borderColor: dragActive ? 'var(--accent)' : 'var(--border-med)',
                  background: dragActive ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
                }}
                onClick={pickFiles}
                {...dragHandlers}
                onDrop={async (e) => {
                  e.preventDefault();
                  setDragActive(false);
                  const files = Array.from(e.dataTransfer.files);
                  if (files.length === 0) return;
                  const paths = await window.warroom.dialog.resolveDroppedFiles(files, ['docx']);
                  if (paths.length > 0) { await extractAll(paths); return; }
                  setError('Those files could not be opened — Auto Flow only reads .docx speech docs.');
                }}
              >
                <div className="text-sm font-medium text-ink/60 mb-2">
                  {dragActive ? 'Drop to add' : 'Drop speech docs here (.docx)'}
                </div>
                <div className="text-xs text-ink/40">drop several at once, or click to open the file picker</div>
              </div>
            </div>
          )}

          {/* STEP: extracting */}
          {step === 'extracting' && (
            <div className="py-14">
              <LoadingState messages={[
                'Reading the speech docs…',
                'Pulling tags, cites, and headings…',
                'Never reading card bodies…',
              ]} />
            </div>
          )}

          {/* STEP: target */}
          {step === 'target' && (
            <div className="space-y-4">
              <div className="rounded-sm border border-line divide-y divide-line">
                {docs.map((d) => (
                  <div key={d.fileName} className="px-3 py-2 flex items-center justify-between text-xs">
                    <span className="truncate text-ink/80">{d.fileName}</span>
                    {d.cards.length > 0 ? (
                      <span className="text-ink/45">{d.cards.length} card{d.cards.length === 1 ? '' : 's'}</span>
                    ) : (
                      <span className="text-danger/70">{d.error || 'No cards found'}</span>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-ink/45">{totalCards} card{totalCards === 1 ? '' : 's'} total across {docs.length} file{docs.length === 1 ? '' : 's'}.</p>

              <div className="space-y-2">
                <label className="label">Where should these go?</label>
                <div className="flex gap-2">
                  <button
                    className={`btn text-sm flex-1 ${targetMode === 'new' ? 'btn-primary' : ''}`}
                    onClick={() => setTargetMode('new')}
                  >
                    Create a new flow
                  </button>
                  <button
                    className={`btn text-sm flex-1 ${targetMode === 'existing' ? 'btn-primary' : ''}`}
                    onClick={() => setTargetMode('existing')}
                    disabled={flowsIndex.length === 0}
                    title={flowsIndex.length === 0 ? 'You have no existing flows yet' : ''}
                  >
                    Add to an existing flow
                  </button>
                </div>
              </div>

              {targetMode === 'new' && newEvent === 'pf' && (
                <div className="space-y-3 rounded-sm border border-line p-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-ink/55 font-medium">Speech order</label>
                    <div className="flex gap-2">
                      <button className={`btn text-xs flex-1 ${newPfOrder === 'pro-first' ? 'btn-primary' : ''}`} onClick={() => setNewPfOrder('pro-first')}>Pro first</button>
                      <button className={`btn text-xs flex-1 ${newPfOrder === 'con-first' ? 'btn-primary' : ''}`} onClick={() => setNewPfOrder('con-first')}>Con first</button>
                    </div>
                  </div>
                </div>
              )}
              {/* Policy sheet layout (Stock issues vs. Advantage) has no UI — Warroom AI
                  guesses it from the doc's hat/block structure (inferVariantFromHats,
                  run at extract time) and the classify step's own read of the cards.
                  newVariant/variantInferred stay wired, just not surfaced here. */}

              {targetMode === 'existing' && (
                <div className="space-y-1.5">
                  <label className="text-xs text-ink/55 font-medium">Flow</label>
                  <select
                    className="input w-full text-sm"
                    value={selectedFlowId}
                    onChange={(e) => setSelectedFlowId(e.target.value)}
                  >
                    <option value="">Choose a flow…</option>
                    {flowsIndex.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Opt-in AI summary mode. The ai-glow-ring marks it as an AI action
                  — it adds a Warroom AI call and reads card bodies. A real switch
                  (not a plain checkbox) so the on/off state reads unambiguously. */}
              <div className="ai-glow-ring flex items-start gap-3 rounded-sm border border-line p-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={summarize}
                  onClick={() => setSummarize((v) => !v)}
                  className="relative shrink-0 mt-0.5 transition"
                  style={{
                    width: 34, height: 19, borderRadius: 999,
                    background: summarize ? 'var(--accent)' : 'var(--bg-elevated)',
                    border: '1px solid var(--border-med)',
                  }}
                >
                  <span
                    className="absolute rounded-full transition"
                    style={{
                      top: 1, left: summarize ? 16 : 1,
                      width: 15, height: 15,
                      background: '#fff',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.35)',
                    }}
                  />
                </button>
                <button type="button" className="text-left flex-1 cursor-pointer" onClick={() => setSummarize((v) => !v)}>
                  <div className="text-xs font-medium text-ink/80">Summarize each card with Warroom AI</div>
                  <div className="text-[11px] text-ink/45 mt-0.5 leading-snug">
                    Writes a short AI summary of each card — built from its tagline <em>and</em> its evidence, always
                    shorter than the tagline — instead of the tagline + cite. Reads card bodies and takes an extra
                    moment. Off by default; summarized cells show an AI ring.
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* STEP: classifying */}
          {step === 'classifying' && pendingQuestion && (
            <div className="py-6">
              <AIQuestionPrompt question={pendingQuestion} onAnswer={answerQuestion} busy={answering} />
            </div>
          )}
          {step === 'classifying' && !pendingQuestion && (
            <div className="py-14">
              <LoadingState messages={summarizing ? [
                'Warroom AI is summarizing each card…',
                'Reading the evidence behind each tag…',
                'Keeping every summary under its tagline…',
              ] : [
                'Warroom AI is sorting the cards…',
                'Matching pockets to columns…',
                'Matching hats and blocks to sheets…',
              ]} />
              {progress && progress.cardsTotal > 0 && (
                <div className="mt-6 mx-auto max-w-sm space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-ink/55">
                    <span>
                      {progress.phase === 'summarizing' ? 'Summarizing' : 'Sorting'} batch{' '}
                      {Math.min(progress.batchesDone + 1, progress.totalBatches)} of {progress.totalBatches}
                    </span>
                    <span>{progress.cardsDone.toLocaleString()} / {progress.cardsTotal.toLocaleString()} cards</span>
                  </div>
                  <ProgressBar pct={(progress.cardsDone / progress.cardsTotal) * 100} />
                </div>
              )}
            </div>
          )}

          {/* STEP: review */}
          {step === 'review' && (
            <div className="space-y-3">
              <p className="text-xs text-ink/50">
                Review where each card will land. Uncheck any you don't want, then confirm.
              </p>
              {classifyStats && (
                <p className="text-[11px] text-ink/45">
                  {classifyStats.placed.toLocaleString()} of {classifyStats.cardsIn.toLocaleString()} cards sorted
                  {classifyStats.batches > 1 ? ` across ${classifyStats.batches} batches` : ''}
                  {classifyStats.dropped > 0 && (
                    <span className="text-danger"> · {classifyStats.dropped} returned incomplete and were dropped</span>
                  )}
                  {classifyStats.placed < classifyStats.cardsIn - classifyStats.dropped && (
                    <span className="text-danger">
                      {' '}· {(classifyStats.cardsIn - classifyStats.dropped - classifyStats.placed).toLocaleString()} didn't come back —
                      cancel and sort again to retry them
                    </span>
                  )}
                </p>
              )}
              {groupBySheet(placements).map(([sheetName, isNewSheet, items]) => (
                <div key={sheetName} className="rounded-sm border border-line">
                  <div className="px-3 py-1.5 flex items-center gap-2 border-b border-line" style={{ background: 'var(--bg-elevated)' }}>
                    <span className="text-xs font-medium text-ink/75">{sheetName}</span>
                    {isNewSheet && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>NEW</span>}
                  </div>
                  <div className="divide-y divide-line">
                    {items.map((p) => (
                      <label key={p.id} className="flex items-start gap-2 px-3 py-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={!p.removed}
                          onChange={() => toggleRemoved(p.id)}
                        />
                        <span className={`flex-1 ${p.removed ? 'opacity-40 line-through' : ''}`}>
                          {p.summary ? (
                            <>
                              {/* AI summary replaces the tag+cite in the cell. No ring
                                  here — per CLAUDE.md, AI-generated taglines (including
                                  this opt-in summary standing in for one) never get the
                                  ring, only the toggle that turns summarization on does. */}
                              <span className="inline-block rounded-sm px-1.5 py-0.5 text-ink/85">{truncate(p.summary, 90)}</span>
                              <span className="block text-ink/35 mt-1 italic">was: {truncate(p.tag, 70)}</span>
                            </>
                          ) : (
                            <span className="text-ink/80">{truncate(p.tag, 90)}</span>
                          )}
                          <span className="block text-ink/40 mt-0.5">{p.sheetName} → {p.column}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              {placements.length === 0 && (
                <div className="py-8 text-center space-y-3">
                  <p className="text-sm text-ink/60">Warroom AI didn't place any of these cards.</p>
                  <p className="text-xs text-ink/45 max-w-md mx-auto">
                    Every card came back unusable — usually a one-off model hiccup rather than
                    anything wrong with your docs. Sorting again normally fixes it.
                  </p>
                  <button className="ai-glow-ring btn-primary text-sm" onClick={() => setStep('target')}>
                    Back to sort again
                  </button>
                </div>
              )}
            </div>
          )}

          {/* STEP: writing */}
          {step === 'writing' && (
            <div className="py-14">
              <LoadingState messages={['Writing cards into the flow…']} />
            </div>
          )}

          {/* STEP: done (only reached when some placements didn't fit) */}
          {step === 'done' && writeSummary && (
            <div className="space-y-3">
              <p className="text-sm text-ink/70">
                Wrote {writeSummary.written} card{writeSummary.written === 1 ? '' : 's'}. {writeSummary.skipped.length} didn't fit and were skipped:
              </p>
              <div className="rounded-sm border border-line divide-y divide-line">
                {writeSummary.skipped.map((s, i) => (
                  <div key={i} className="px-3 py-2 text-xs">
                    <span className="text-ink/75">{truncate(s.tag, 90)}</span>
                    <span className="block text-ink/40 mt-0.5">{s.sheetName} → {s.column} — {s.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-line flex items-center gap-2 shrink-0">
          {step === 'upload' && (
            <button className="btn text-sm ml-auto" onClick={onClose}>Cancel</button>
          )}
          {step === 'target' && (
            <>
              <button
                className="ai-glow-ring btn-primary text-sm"
                disabled={totalCards === 0 || (targetMode === 'existing' && !selectedFlowId)}
                onClick={confirmTarget}
              >
                Sort with Warroom AI →
              </button>
              <button className="btn text-sm ml-auto" onClick={onClose}>Cancel</button>
            </>
          )}
          {step === 'review' && (
            <>
              <button className="btn-primary text-sm" disabled={acceptedCount === 0} onClick={commitWrite}>
                Write {acceptedCount} card{acceptedCount === 1 ? '' : 's'} to the flow
              </button>
              <button className="btn text-sm ml-auto" onClick={onClose}>Cancel</button>
            </>
          )}
          {step === 'done' && (
            <button className="btn-primary text-sm ml-auto" onClick={onClose}>Done</button>
          )}
          {(step === 'extracting' || step === 'classifying') && !pendingQuestion && (
            <button className="btn text-sm ml-auto" onClick={onClose}>Cancel</button>
          )}
        </div>
      </div>
    </div>
  );
}

function stepLabel(step: Step): string {
  switch (step) {
    case 'upload': return 'Step 1 — upload speech docs';
    case 'extracting': return 'Reading the docs…';
    case 'target': return 'Step 2 — choose the destination flow';
    case 'classifying': return 'Sorting…';
    case 'review': return 'Step 3 — review placements, then write';
    case 'writing': return 'Writing…';
    case 'done': return 'Done';
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Groups placements by destination sheet for the review step, preserving first-
// seen order so new sheets appear where the AI first introduced them rather than
// jumping around.
function groupBySheet(placements: Placement[]): [string, boolean, Placement[]][] {
  const order: string[] = [];
  const groups = new Map<string, { isNew: boolean; items: Placement[] }>();
  for (const p of placements) {
    if (!groups.has(p.sheetName)) {
      groups.set(p.sheetName, { isNew: p.isNewSheet, items: [] });
      order.push(p.sheetName);
    }
    groups.get(p.sheetName)!.items.push(p);
  }
  return order.map((name) => {
    const g = groups.get(name)!;
    return [name, g.isNew, g.items] as [string, boolean, Placement[]];
  });
}
