import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store/appStore';
import { Card, CutterSource, HighlightColor, AIClarification, AIQuestion } from '../types';
import AIQuestionPrompt from './AIQuestionPrompt';
import { LoadingState } from './Spinner';
import { humanizeGeminiError } from '../utils/geminiError';
import { FormattedBody } from './CardBody';
import {
  CharAttr, buildAttrsFromSpans, runsFromAttrs, HighlightLevel, HIGHLIGHT_SWATCH,
} from '../utils/cardFormat';

const CURRENT_YEAR = new Date().getFullYear();
const CUT_CASE_ID = '__cut__';
const CUT_BLOCK_ID = '__cut_inbox__';

type Step = 'pick' | 'reading' | 'select' | 'cutting' | 'edit';

const COLORS: HighlightColor[] = ['yellow', 'cyan', 'green'];

type CutResult = { underline: string[]; highlight: { text: string; tier: HighlightLevel }[]; small: string[] };

export default function CardCutter({ onClose }: { onClose: () => void }) {
  const { update, cardOutdatedYears } = useApp();
  const [step, setStep] = useState<Step>('pick');
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [source, setSource] = useState<CutterSource | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // selection (step 2) — paragraph-granularity: click to toggle whole paragraphs
  const [includedParas, setIncludedParas] = useState<Set<number>>(new Set());
  const [pickedImages, setPickedImages] = useState<Set<number>>(new Set());
  const [showPics, setShowPics] = useState(false);

  // intent + color (step 3 = inside select step)
  const [intent, setIntent] = useState('');
  const [color, setColor] = useState<HighlightColor>('cyan');

  // editor (step 4)
  const [editText, setEditText] = useState('');
  const [editAttrs, setEditAttrs] = useState<CharAttr[]>([]);
  // Raw AI result kept around (not just the baked-in editAttrs) so the highlight
  // density control below can re-filter and re-render instantly — no AI call.
  const [cutResult, setCutResult] = useState<CutResult | null>(null);
  const [highlightLevel, setHighlightLevel] = useState<HighlightLevel>(2);
  const [taglines, setTaglines] = useState<string[]>([]);
  const [chosenTag, setChosenTag] = useState('');
  const [cite, setCite] = useState('');
  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [saving, setSaving] = useState(false);
  // Refine box — asks Warroom AI to adjust the cut it just made, replacing the
  // old manual underline/highlight/font-size toolbar.
  const [refineText, setRefineText] = useState('');
  const [refining, setRefining] = useState(false);

  // manually-added images (file input)
  const [extraImages, setExtraImages] = useState<{ src: string; alt: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Ambiguity escape hatch (see AIQuestion in types.ts): cutterEmphasize can pause
  // instead of guessing when intent is unspecified and the card supports more
  // than one framing. `pendingCut` remembers the body/intent so the resume call
  // uses the same inputs the question was asked about.
  const [pendingQuestion, setPendingQuestion] = useState<AIQuestion | null>(null);
  const [clarifications, setClarifications] = useState<AIClarification[]>([]);
  const [pendingCut, setPendingCut] = useState<{ body: string; intent: string } | null>(null);
  const [answering, setAnswering] = useState(false);

  async function runEmphasize(bodyText: string, intentText: string, clars: AIClarification[]) {
    setPendingCut({ body: bodyText, intent: intentText });
    setPendingQuestion(null);
    setStep('cutting');
    setError('');
    try {
      const res = await window.warroom.ai.cutterEmphasize({ body: bodyText, intent: intentText, highlightColor: color, cite, clarifications: clars });
      if (res.question) { setPendingQuestion(res.question); return; }
      const result = { underline: res.underline, highlight: res.highlight, small: res.small };
      setEditText(bodyText);
      setEditAttrs(buildAttrsFromSpans(bodyText, result, color, 2));
      setCutResult(result);
      setHighlightLevel(2);
      setTaglines(res.taglines || []);
      setChosenTag((res.taglines && res.taglines[0]) || '');
      setClarifications([]);
      setPendingCut(null);
      setRefineText('');
      setStep('edit');
    } catch (e: any) {
      setError(humanizeGeminiError(e?.message) || e?.message || 'Could not cut the card.');
      setStep('select');
    }
  }

  // Send the current cut back to Warroom AI with a plain-language instruction
  // ("underline less", "highlight the statistics", "don't shrink the last
  // paragraph"). Replaces the old manual formatting toolbar.
  async function runRefine() {
    const instruction = refineText.trim();
    if (!instruction || !cutResult || refining) return;
    setRefining(true);
    setError('');
    try {
      const res = await window.warroom.ai.cutterEmphasize({
        body: editText, intent, highlightColor: color, cite,
        refineInstruction: instruction, previous: cutResult,
      });
      // A refinement is an explicit instruction, so the prompt is told not to
      // ask a clarifying question — but if one comes back anyway, its emphasis
      // arrays are all empty, and applying them would silently wipe every
      // highlight and underline off the card. Keep the existing cut instead.
      if (res.question) {
        setError(`Warroom AI needs more detail to make that change: ${res.question.question}`);
        return;
      }
      const result = { underline: res.underline, highlight: res.highlight, small: res.small };
      setEditAttrs(buildAttrsFromSpans(editText, result, color, highlightLevel));
      setCutResult(result);
      if (res.taglines?.length) {
        setTaglines(res.taglines);
        // Only move the user off their chosen tag if it's gone from the new set.
        if (!res.taglines.includes(chosenTag)) setChosenTag(res.taglines[0]);
      }
      setRefineText('');
    } catch (e: any) {
      setError(humanizeGeminiError(e?.message) || e?.message || 'Could not refine the card.');
    } finally {
      setRefining(false);
    }
  }

  async function answerQuestion(answer: string) {
    if (!pendingQuestion || !pendingCut || answering) return;
    setAnswering(true);
    const next = [...clarifications, { question: pendingQuestion.question, answer }];
    setClarifications(next);
    await runEmphasize(pendingCut.body, pendingCut.intent, next);
    setAnswering(false);
  }

  async function pickFile() {
    let filePath: string | null = null;
    try { filePath = await window.warroom.dialog.openFile(['html', 'htm', 'xhtml', 'mhtml', 'mht', 'pdf']); } catch {}
    if (!filePath) return;
    setFileName(filePath.split(/[\\/]/).pop() || 'source');
    setError('');
    setClarifications([]);
    setPendingQuestion(null);
    setPendingCut(null);
    setStep('reading');
    try {
      const src = await window.warroom.ai.cutterReadSource(filePath);
      if (!src?.ok || !src.paragraphs?.length) {
        setError('No readable article text was found in this file. Try saving the page again (⌘S / Ctrl+S → Webpage).');
        setStep('pick');
        return;
      }
      setSource(src);
      setCite(src.cite || '');
      setYear(src.year || CURRENT_YEAR);
      setIncludedParas(new Set());
      setPickedImages(new Set());
      setStep('select');
    } catch (e: any) {
      setError(humanizeGeminiError(e?.message) || e?.message || 'Could not read this file.');
      setStep('pick');
    }
  }

  function togglePara(idx: number) {
    setIncludedParas((prev) => {
      const n = new Set(prev);
      n.has(idx) ? n.delete(idx) : n.add(idx);
      return n;
    });
  }

  // Selecting nothing means "use the whole article" rather than blocking the
  // cut — picking paragraphs is an optional narrowing step, not a required one.
  const selectedBody = useMemo(() => {
    if (!source) return '';
    const idxs = includedParas.size
      ? [...includedParas].sort((a, b) => a - b)
      : source.paragraphs.map((_, i) => i);
    return idxs.map((i) => source.paragraphs[i]).filter(Boolean).join('\n\n');
  }, [includedParas, source]);

  async function cut() {
    if (!selectedBody.trim()) return;
    await runEmphasize(selectedBody, intent, []);
  }

  // Re-filters the single AI response by tier and re-renders instantly — no AI call.
  function applyHighlightLevel(level: HighlightLevel) {
    if (!cutResult) return;
    setHighlightLevel(level);
    setEditAttrs(buildAttrsFromSpans(editText, cutResult, color, level));
  }

  // Recolors the already-applied highlighting. Without this the edit-step
  // swatches only affected future manual edits, so clicking one appeared to do
  // nothing to the card actually on screen.
  function changeColor(c: HighlightColor) {
    setColor(c);
    if (cutResult) setEditAttrs(buildAttrsFromSpans(editText, cutResult, c, highlightLevel));
  }

  function addImageFromFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setExtraImages((prev) => [...prev, { src: reader.result as string, alt: file.name }]);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  async function save() {
    const tag = (chosenTag || 'Untitled card').trim();
    // Used to call onClose() here — clicking "Save to All Cards" silently threw
    // the card away and shut the dialog, with nothing saved and nothing said.
    if (!editText.trim()) { setError('There is no card body to save. Go back and cut the card again.'); return; }
    setSaving(true);
    const now = new Date().toISOString();
    const runs = runsFromAttrs(editText, editAttrs);
    const sourceImgs = source
      ? [...pickedImages].sort((a, b) => a - b).map((i) => ({ src: source.images[i].src, alt: source.images[i].alt }))
      : [];
    const allImgs = [...sourceImgs, ...extraImages];
    const yr = Number(year) || CURRENT_YEAR;
    try {
      await update((db) => {
        const id = crypto.randomUUID();
        const newCard: Card = {
          id, blockId: CUT_BLOCK_ID, tag, cite: cite.trim(), body: editText.trim(),
          bodyRuns: runs, images: allImgs.length ? allImgs : undefined,
          year: yr, flagged: CURRENT_YEAR - yr > cardOutdatedYears, createdAt: now,
        };
        const existingCase = db.cases[CUT_CASE_ID];
        const cutCase = existingCase
          ? (existingCase.blocks.includes(CUT_BLOCK_ID) ? existingCase : { ...existingCase, blocks: [...existingCase.blocks, CUT_BLOCK_ID] })
          : { id: CUT_CASE_ID, name: 'Cut Cards', side: 'aff' as const, blocks: [CUT_BLOCK_ID] };
        const existingBlock = db.blocks[CUT_BLOCK_ID];
        const cutBlock = existingBlock
          ? existingBlock
          : { id: CUT_BLOCK_ID, caseId: CUT_CASE_ID, title: 'Cut from source', type: 'text', cards: [] as string[], createdAt: now, updatedAt: now };
        return {
          ...db,
          cases: { ...db.cases, [CUT_CASE_ID]: cutCase },
          blocks: { ...db.blocks, [CUT_BLOCK_ID]: { ...cutBlock, cards: [...cutBlock.cards, id], updatedAt: now } },
          cards: { ...db.cards, [id]: newCard },
        };
      });
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to save the card.');
      setSaving(false);
    }
  }

  // Combined image list for the edit step
  type EditImg = { key: string; src: string; alt: string; isSource: boolean; srcIdx: number; extraIdx: number };
  const editImages = useMemo<EditImg[]>(() => {
    const sourceImgs: EditImg[] = source
      ? [...pickedImages].sort((a, b) => a - b).map((i) => ({ key: `s${i}`, isSource: true, srcIdx: i, extraIdx: -1, src: source.images[i].src, alt: source.images[i].alt || '' }))
      : [];
    const extra: EditImg[] = extraImages.map((img, ei) => ({ key: `e${ei}`, isSource: false, srcIdx: -1, extraIdx: ei, src: img.src, alt: img.alt }));
    return [...sourceImgs, ...extra];
  }, [pickedImages, extraImages, source]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div className="glass-elevated rounded-md w-full max-w-3xl max-h-[88vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-3 border-b border-line flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-semibold">Cut a card with Warroom AI</h2>
            <p className="text-xs text-ink/40">{stepLabel(step)}</p>
          </div>
          <button className="text-ink/40 hover:text-ink text-lg leading-none" onClick={onClose}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin p-5">
          {/* Sticky: refine and save both fail from controls at the BOTTOM of
              this scroll area, and a banner pinned to the top scrolled out of
              sight — the action just looked like it did nothing. */}
          {error && (
            <div className="sticky top-0 z-10 mb-3 border border-danger/30 rounded-sm bg-danger/5 backdrop-blur p-2.5 text-sm text-danger flex items-start gap-2">
              <span className="flex-1">{error}</span>
              <button className="text-danger/60 hover:text-danger leading-none shrink-0" title="Dismiss" onClick={() => setError('')}>✕</button>
            </div>
          )}

          {/* STEP: pick */}
          {step === 'pick' && (
            <div className="text-center py-10 space-y-4">
              <div className="text-sm text-ink/60 max-w-lg mx-auto space-y-2">
                <p>Save the article first, then import it:</p>
                <p className="text-ink/80">
                  <strong>Press ⌘S / Ctrl+S → save as a Webpage (HTML)</strong> so the images come too,
                  or <strong>Print → Save as PDF</strong> for text only.
                </p>
                <p className="text-xs text-ink/40">Warroom AI reads it, then you guide what goes in the card.</p>
              </div>
              <button className="ai-glow-ring btn-primary text-sm" onClick={pickFile}>Choose a saved page (.html) or PDF…</button>
            </div>
          )}

          {/* STEP: reading */}
          {step === 'reading' && (
            <div className="py-14">
              <LoadingState messages={[
                `Reading ${fileName}…`,
                'Pulling the cite and article body…',
                'Extracting images…',
                'Cleaning up the text…',
              ]} />
            </div>
          )}

          {/* STEP: select */}
          {step === 'select' && source && (
            <div className="space-y-3">
              <div className="text-xs text-ink/50">
                <span className="text-ink/70 font-medium">Optional: click paragraphs to narrow the card to just those.</span>{' '}
                Leave everything unselected and Warroom AI cuts from the whole article. Paragraphs go in whole —
                irrelevant parts get shrunk to small text rather than dropped.
              </div>
              {source.cite && (
                <div className="text-[11px] text-ink/40 border border-line rounded-sm px-2 py-1.5">
                  <span className="text-ink/55 font-medium">Cite: </span>{source.cite}
                </div>
              )}
              <div className="rounded-sm border border-line max-h-[34vh] overflow-y-auto scroll-thin divide-y divide-line">
                {source.paragraphs.map((para, i) => {
                  const on = includedParas.has(i);
                  return (
                    <button
                      key={i}
                      onClick={() => togglePara(i)}
                      className="w-full text-left px-3 py-2 text-sm leading-relaxed transition"
                      style={on ? { backgroundColor: 'var(--accent-soft)', boxShadow: 'inset 3px 0 0 var(--accent)', color: 'var(--ink)' } : { color: 'var(--ink)', opacity: 0.55 }}
                    >
                      {para}
                    </button>
                  );
                })}
              </div>

              {/* Pictures — from source */}
              {source.images.length > 0 && (
                <div className="border border-line rounded-sm">
                  <button className="w-full px-3 py-2 flex items-center justify-between text-xs text-ink/60 hover:text-ink" onClick={() => setShowPics((v) => !v)}>
                    <span>Pictures from the source ({source.images.length}) · {pickedImages.size} selected</span>
                    <span>{showPics ? '▲' : '▼'}</span>
                  </button>
                  {showPics && (
                    <div className="px-3 pb-3 grid grid-cols-3 gap-2">
                      {source.images.map((img, i) => {
                        const on = pickedImages.has(i);
                        return (
                          <button
                            key={i}
                            onClick={() => setPickedImages((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                            className="relative rounded-sm border-2 overflow-hidden"
                            style={{ borderColor: on ? 'var(--accent)' : 'rgb(var(--line-rgb))' }}
                            title={img.alt || ''}
                          >
                            <img src={img.src} alt={img.alt || ''} className="w-full h-20 object-cover bg-white" />
                            {img.suggested && <span className="absolute top-0.5 left-0.5 text-[9px] text-white px-1 rounded-sm" style={{ background: 'var(--accent)' }}>suggested</span>}
                            {on && <span className="absolute top-0.5 right-0.5 text-[10px] text-white px-1 rounded-sm" style={{ background: 'var(--accent)' }}>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Intent + color */}
              <div className="space-y-2 pt-1">
                <label className="text-xs text-ink/55 font-medium">What are you using this card for? <span className="text-ink/35 font-normal">(helps Warroom AI cut it well — optional)</span></label>
                <textarea
                  className="input w-full text-sm" rows={2}
                  placeholder="e.g. neg link card — surveillance trades off with deterrence"
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink/55">Highlight color:</span>
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-6 h-6 rounded-full border-2 ${color === c ? 'border-ink' : 'border-transparent'}`}
                      style={{ backgroundColor: HIGHLIGHT_SWATCH[c] }}
                      title={c}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP: cutting */}
          {step === 'cutting' && pendingQuestion && (
            <div className="py-6">
              <AIQuestionPrompt question={pendingQuestion} onAnswer={answerQuestion} busy={answering} />
            </div>
          )}
          {step === 'cutting' && !pendingQuestion && (
            <div className="py-14">
              <LoadingState messages={[
                'Warroom AI is cutting the card…',
                'Selecting the most important sentences…',
                'Deciding what to underline and highlight…',
                'Shrinking the rest…',
              ]} />
            </div>
          )}

          {/* STEP: edit */}
          {step === 'edit' && (
            <div className="space-y-3">
              {/* Tagline */}
              <div className="space-y-1.5">
                <label className="text-xs text-ink/55 font-medium">Tag</label>
                {taglines.length > 1 && (
                  <div className="flex flex-col gap-1">
                    {taglines.map((t, i) => (
                      <label key={i} className="flex items-start gap-2 text-sm cursor-pointer">
                        <input type="radio" name="tagline" className="mt-1" checked={chosenTag === t} onChange={() => setChosenTag(t)} />
                        <span>{t}</span>
                      </label>
                    ))}
                  </div>
                )}
                <input className="input w-full text-sm font-semibold" value={chosenTag} onChange={(e) => setChosenTag(e.target.value)} placeholder="Tag" />
              </div>

              {/* Cite + year */}
              <div className="space-y-1.5">
                <label className="text-xs text-ink/55 font-medium">Cite</label>
                <input className="input w-full text-xs" value={cite} onChange={(e) => setCite(e.target.value)} placeholder="Author, date, title, URL" />
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-ink/40">Year</span>
                  <input className="input w-24 text-xs" type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || CURRENT_YEAR)} />
                </div>
              </div>

              {/* Card body + emphasis controls */}
              <div>
                <label className="text-xs text-ink/55 font-medium">Card body <span className="text-ink/35 font-normal">— verbatim from the source; the words never change.</span></label>
                <div className="flex items-center gap-2 my-1.5 flex-wrap">
                  <span className="text-xs text-ink/55">Highlight density:</span>
                  <div className="inline-flex rounded-sm border border-line overflow-hidden">
                    {([1, 2, 3] as HighlightLevel[]).map((lvl) => (
                      <button
                        key={lvl}
                        className={`px-2.5 py-1 text-xs transition ${lvl !== 1 ? 'border-l border-line' : ''}`}
                        style={highlightLevel === lvl ? { backgroundColor: 'var(--accent)', color: '#fff' } : { color: 'var(--ink)', opacity: 0.55 }}
                        onClick={() => applyHighlightLevel(lvl)}
                        disabled={!cutResult}
                        title={
                          lvl === 1 ? 'Only the most essential highlights'
                          : lvl === 2 ? 'Standard highlighting'
                          : 'Full, maximal highlighting'
                        }
                      >
                        {lvl === 1 ? 'Less' : lvl === 2 ? 'Medium' : 'More'}
                      </button>
                    ))}
                  </div>
                  <span className="mx-0.5 text-ink/20 select-none">|</span>
                  <span className="text-xs text-ink/55">Color:</span>
                  {COLORS.map((c) => (
                    <button key={c} onClick={() => changeColor(c)}
                      className={`w-5 h-5 rounded-full border-2 ${color === c ? 'border-ink' : 'border-transparent'}`}
                      style={{ backgroundColor: HIGHLIGHT_SWATCH[c] }} title={`Highlight in ${c}`} />
                  ))}
                </div>
                <div className="text-sm text-ink/80 rounded-sm border border-line p-3 max-h-[34vh] overflow-y-auto scroll-thin select-text">
                  <FormattedBody runs={runsFromAttrs(editText, editAttrs)} />
                </div>
              </div>

              {/* Refine with Warroom AI — replaces the old manual formatting
                  toolbar; the AI re-cuts rather than the user hand-editing spans. */}
              <div className="space-y-1.5">
                <label className="text-xs text-ink/55 font-medium">
                  Change something? <span className="text-ink/35 font-normal">Tell Warroom AI what to fix.</span>
                </label>
                <div className="flex gap-2">
                  <input
                    className="input flex-1 text-sm"
                    placeholder="e.g. underline less, highlight the statistics, don't shrink the last paragraph"
                    value={refineText}
                    disabled={refining || !cutResult}
                    onChange={(e) => setRefineText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') runRefine(); }}
                  />
                  <button
                    className="ai-glow-ring btn-primary text-sm shrink-0"
                    onClick={runRefine}
                    disabled={refining || !refineText.trim() || !cutResult}
                    title="Send this card back to Warroom AI with your instructions"
                  >
                    {refining ? 'Refining…' : 'Refine'}
                  </button>
                </div>
              </div>

              {/* Images — individual removal + add from file */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-ink/55 font-medium">Images</label>
                  <button className="btn text-[11px]" onClick={() => fileInputRef.current?.click()} title="Add an image from your files">
                    + Add image…
                  </button>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={addImageFromFile} />
                {editImages.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {editImages.map((img) => (
                      <div key={img.key} className="relative group/img">
                        <img src={img.src} alt={img.alt} className="max-h-24 rounded-sm border border-line object-contain bg-white" />
                        <button
                          className="absolute -top-1.5 -right-1.5 opacity-0 group-hover/img:opacity-100 transition text-[10px] bg-danger text-white w-4 h-4 rounded-full flex items-center justify-center"
                          title="Remove image"
                          onClick={() => {
                            if (img.isSource) {
                              setPickedImages((prev) => { const n = new Set(prev); n.delete(img.srcIdx); return n; });
                            } else {
                              setExtraImages((prev) => prev.filter((_, i) => i !== img.extraIdx));
                            }
                          }}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-ink/35">No images — click "+ Add image…" to attach one from your files.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-line flex items-center gap-2 shrink-0">
          {step === 'select' && (
            <>
              <button
                className="ai-glow-ring btn-primary text-sm"
                disabled={!selectedBody.trim()}
                onClick={cut}
                title={includedParas.size ? `Cut from the ${includedParas.size} selected paragraph${includedParas.size === 1 ? '' : 's'}` : 'Cut from the whole article'}
              >
                Cut card →
              </button>
              <button className="btn text-sm" onClick={() => setIncludedParas(new Set())} disabled={!includedParas.size} title="Clear paragraph selection">Clear</button>
              <span className="text-xs text-ink/40 ml-auto">
                {includedParas.size
                  ? `${includedParas.size} paragraph${includedParas.size === 1 ? '' : 's'} selected`
                  : 'Nothing selected — the whole article will be used'}
              </span>
            </>
          )}
          {step === 'edit' && (
            <>
              <button className="btn-primary text-sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save to All Cards'}</button>
              <button className="btn text-sm" onClick={() => setStep('select')} disabled={saving}>← Back</button>
              <span className="text-xs text-ink/40 ml-auto">Saved cards appear in All Cards.</span>
            </>
          )}
          {(step === 'pick' || step === 'reading' || step === 'cutting') && (
            <button className="btn text-sm ml-auto" onClick={onClose}>Cancel</button>
          )}
        </div>
      </div>
    </div>
  );
}

function stepLabel(step: Step): string {
  switch (step) {
    case 'pick': return 'Step 1 — import the source';
    case 'reading': return 'Reading the source…';
    case 'select': return 'Step 2 — choose the body & pictures, then tell Warroom AI the plan';
    case 'cutting': return 'Cutting…';
    case 'edit': return 'Step 3 — review & fix the cut, then save';
  }
}
