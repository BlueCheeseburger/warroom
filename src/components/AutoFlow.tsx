import React, { useState } from 'react';
import { useApp, FlowMeta } from '../store/appStore';
import { AIQuestion, AIClarification, ExtractedFlowCard } from '../types';
import AIQuestionPrompt from './AIQuestionPrompt';
import { LoadingState } from './Spinner';
import { humanizeGeminiError } from '../utils/geminiError';
import { escapeHtml } from '../lib/cellHtml';
import { readAutoFlowTagStyle } from '../lib/autoFlowTagStyle';
import { findColumnIndex, firstEmptyRow, inferEventFromPockets } from '../lib/autoFlowPlacement';
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
  cards: ExtractedFlowCard[];
  error?: string;
}

interface Placement {
  id: string;
  fileName: string;
  tag: string;
  cite: string;
  column: string;
  sheetName: string;
  isNewSheet: boolean;
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
function buildCellHtml(tag: string, cite: string): string {
  const style = readAutoFlowTagStyle();
  let t = escapeHtml(tag);
  if (style.underline) t = `<u>${t}</u>`;
  if (style.italic) t = `<i>${t}</i>`;
  if (style.bold) t = `<b>${t}</b>`;
  return `${t}<br>${escapeHtml(cite)}`;
}

export default function AutoFlow({ onClose }: { onClose: () => void }) {
  const { event, flowsIndex, setFlowsIndex, setView } = useApp();
  const [step, setStep] = useState<Step>('upload');
  const [error, setError] = useState('');

  const [docs, setDocs] = useState<DocResult[]>([]);

  // Target step
  const [targetMode, setTargetMode] = useState<'new' | 'existing'>('new');
  const [selectedFlowId, setSelectedFlowId] = useState<string>('');
  const [newEvent, setNewEvent] = useState<'policy' | 'pf'>('policy');
  const [newVariant, setNewVariant] = useState<PolicyVariant>('stock-issues');
  const [newPfOrder, setNewPfOrder] = useState<PFOrder>('pro-first');
  const [targetInferred, setTargetInferred] = useState(false);

  // Classify / question-pause-resume (mirrors CardCutter's runEmphasize/answerQuestion)
  const [clarifications, setClarifications] = useState<AIClarification[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<AIQuestion | null>(null);
  const [pendingClassify, setPendingClassify] = useState<ClassifyCtx | null>(null);
  const [answering, setAnswering] = useState(false);
  const [targetCtx, setTargetCtx] = useState<TargetCtx | null>(null);

  // Review
  const [placements, setPlacements] = useState<Placement[]>([]);

  // Writing / done
  const [writeSummary, setWriteSummary] = useState<{ written: number; skipped: SkippedPlacement[] } | null>(null);

  // ── Step 1: upload ──────────────────────────────────────────────────────────

  async function extractAll(paths: string[]) {
    setStep('extracting');
    setError('');
    const results: DocResult[] = [];
    for (const p of paths) {
      const fileName = p.split(/[\\/]/).pop() || p;
      try {
        const res = await (window.warroom as any).speechdoc.extractBlocks(p);
        if (res?.ok && Array.isArray(res.data?.cards)) {
          results.push({
            fileName,
            cards: res.data.cards,
            error: res.data.cards.length === 0 ? 'No cards found in this doc.' : undefined,
          });
        } else {
          results.push({ fileName, cards: [], error: res?.error || 'Could not read this file.' });
        }
      } catch (e: any) {
        results.push({ fileName, cards: [], error: e?.message || 'Could not read this file.' });
      }
    }
    setDocs(results);

    // Pre-select event for a NEW flow from the pockets seen across every doc —
    // the user can still change it on the target step.
    const allPockets = results.flatMap((d) => d.cards.map((c) => c.pocket));
    const inferred = inferEventFromPockets(allPockets);
    setNewEvent(inferred ?? (event === 'pf' ? 'pf' : 'policy'));
    setTargetInferred(!!inferred);

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
      const list: Placement[] = (res.placements || []).map((p: any) => ({
        id: crypto.randomUUID(),
        fileName: p.fileName,
        tag: p.tag,
        cite: p.cite,
        column: p.column,
        sheetName: p.sheetName,
        isNewSheet: !!p.isNewSheet,
        removed: false,
      }));
      setPlacements(list);
      setStep('review');
    } catch (e: any) {
      setError(humanizeGeminiError(e?.message) || e?.message || 'Warroom AI could not sort these cards.');
      setStep('target');
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
      const sheets: SheetData[] = data.sheets.map((s) => ({ ...s, cells: { ...s.cells } }));
      const sheetIndexByName = new Map<string, number>();
      sheets.forEach((s, i) => sheetIndexByName.set(s.name.trim().toLowerCase(), i));

      const skipped: SkippedPlacement[] = [];
      let written = 0;

      for (const p of accepted) {
        let sheetIdx = sheetIndexByName.get(p.sheetName.trim().toLowerCase());
        if (sheetIdx === undefined) {
          const newSheet: SheetData = { id: crypto.randomUUID(), name: p.sheetName, cells: {} };
          sheets.push(newSheet);
          sheetIdx = sheets.length - 1;
          sheetIndexByName.set(p.sheetName.trim().toLowerCase(), sheetIdx);
        }
        const colIdx = findColumnIndex(columns, p.column);
        if (colIdx === -1) {
          skipped.push({ tag: p.tag, sheetName: p.sheetName, column: p.column, reason: "column not found" });
          continue;
        }
        const row = firstEmptyRow(sheets[sheetIdx].cells, colIdx, NUM_ROWS);
        if (row === -1) {
          skipped.push({ tag: p.tag, sheetName: p.sheetName, column: p.column, reason: "column is full" });
          continue;
        }
        sheets[sheetIdx].cells[`${row}-${colIdx}`] = buildCellHtml(p.tag, p.cite);
        written++;
      }

      const updated: StoredFlowData = { ...data, sheets };
      await window.warroom.storage.write(`flow_data_${flowId}`, updated);

      if (isNewFlow && targetCtx.kind === 'new') {
        const firstName = docs.find((d) => d.cards.length > 0)?.fileName?.replace(/\.docx$/i, '');
        const meta: FlowMeta = {
          id: flowId,
          name: firstName || `Auto Flow ${flowsIndex.length + 1}`,
          event: targetCtx.event,
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
                className="flex flex-col items-center justify-center p-10 text-center border-2 border-dashed border-line rounded-sm cursor-pointer hover:border-ink/30 transition"
                onClick={pickFiles}
                onDrop={async (e) => {
                  e.preventDefault();
                  const files = Array.from(e.dataTransfer.files);
                  if (files.length === 0) return;
                  const paths = await window.warroom.dialog.resolveDroppedFiles(files, ['docx']);
                  if (paths.length > 0) { await extractAll(paths); return; }
                  setError('Those files could not be opened — Auto Flow only reads .docx speech docs.');
                }}
                onDragOver={(e) => e.preventDefault()}
              >
                <div className="text-sm font-medium text-ink/60 mb-2">Drop speech docs here (.docx)</div>
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

              {targetMode === 'new' && (
                <div className="space-y-3 rounded-sm border border-line p-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-ink/55 font-medium">
                      Event {targetInferred && <span className="text-ink/35 font-normal">(guessed from the doc's speech labels)</span>}
                    </label>
                    <div className="flex gap-2">
                      <button className={`btn text-xs flex-1 ${newEvent === 'policy' ? 'btn-primary' : ''}`} onClick={() => setNewEvent('policy')}>Policy</button>
                      <button className={`btn text-xs flex-1 ${newEvent === 'pf' ? 'btn-primary' : ''}`} onClick={() => setNewEvent('pf')}>Public Forum</button>
                    </div>
                  </div>
                  {newEvent === 'policy' ? (
                    <div className="space-y-1.5">
                      <label className="text-xs text-ink/55 font-medium">Sheet layout</label>
                      <div className="flex gap-2">
                        <button className={`btn text-xs flex-1 ${newVariant === 'stock-issues' ? 'btn-primary' : ''}`} onClick={() => setNewVariant('stock-issues')}>Stock issues</button>
                        <button className={`btn text-xs flex-1 ${newVariant === 'advantage' ? 'btn-primary' : ''}`} onClick={() => setNewVariant('advantage')}>Advantage</button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <label className="text-xs text-ink/55 font-medium">Speech order</label>
                      <div className="flex gap-2">
                        <button className={`btn text-xs flex-1 ${newPfOrder === 'pro-first' ? 'btn-primary' : ''}`} onClick={() => setNewPfOrder('pro-first')}>Pro first</button>
                        <button className={`btn text-xs flex-1 ${newPfOrder === 'con-first' ? 'btn-primary' : ''}`} onClick={() => setNewPfOrder('con-first')}>Con first</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

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
              <LoadingState messages={[
                'Warroom AI is sorting the cards…',
                'Matching pockets to columns…',
                'Matching hats and blocks to sheets…',
              ]} />
            </div>
          )}

          {/* STEP: review */}
          {step === 'review' && (
            <div className="space-y-3">
              <p className="text-xs text-ink/50">
                Review where each card will land. Uncheck any you don't want, then confirm.
              </p>
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
                          <span className="text-ink/80">{truncate(p.tag, 90)}</span>
                          <span className="block text-ink/40 mt-0.5">{p.sheetName} → {p.column}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              {placements.length === 0 && (
                <p className="text-sm text-ink/50 py-6 text-center">Warroom AI didn't propose any placements.</p>
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
