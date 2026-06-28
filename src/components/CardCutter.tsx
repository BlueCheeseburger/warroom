import React, { useMemo, useRef, useState } from 'react';
import { useApp } from '../store/appStore';
import { Card, CutterSource, HighlightColor } from '../types';
import { Dots } from './Spinner';
import { humanizeGeminiError } from '../utils/geminiError';
import { FormattedBody } from './CardBody';
import {
  CharAttr, buildAttrsFromSpans, runsFromAttrs, selectionOffsets,
  HIGHLIGHT_SWATCH, HIGHLIGHT_CSS,
} from '../utils/cardFormat';

const CURRENT_YEAR = new Date().getFullYear();
const CUT_CASE_ID = '__cut__';
const CUT_BLOCK_ID = '__cut_inbox__';

type Step = 'pick' | 'reading' | 'select' | 'cutting' | 'edit';

const COLORS: HighlightColor[] = ['yellow', 'cyan', 'green'];

function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

export default function CardCutter({ onClose }: { onClose: () => void }) {
  const { update } = useApp();
  const [step, setStep] = useState<Step>('pick');
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [source, setSource] = useState<CutterSource | null>(null);

  // selection (step 2)
  const fullText = useMemo(() => (source ? source.paragraphs.join('\n\n') : ''), [source]);
  const [includedRanges, setIncludedRanges] = useState<[number, number][]>([]);
  const [pickedImages, setPickedImages] = useState<Set<number>>(new Set());
  const [showPics, setShowPics] = useState(false);
  const selRef = useRef<HTMLDivElement>(null);

  // intent + color (step 3)
  const [intent, setIntent] = useState('');
  const [color, setColor] = useState<HighlightColor>('cyan');

  // editor (step 4)
  const [editText, setEditText] = useState('');
  const [editAttrs, setEditAttrs] = useState<CharAttr[]>([]);
  const [taglines, setTaglines] = useState<string[]>([]);
  const [chosenTag, setChosenTag] = useState('');
  const [cite, setCite] = useState('');
  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [saving, setSaving] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);

  async function pickFile() {
    let filePath: string | null = null;
    try { filePath = await window.warroom.dialog.openFile(['html', 'htm', 'xhtml', 'mhtml', 'mht', 'pdf']); } catch {}
    if (!filePath) return;
    setFileName(filePath.split(/[\\/]/).pop() || 'source');
    setError('');
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
      setIncludedRanges([]);
      setPickedImages(new Set(src.images.map((im, i) => (im.suggested ? i : -1)).filter((i) => i >= 0)));
      setStep('select');
    } catch (e: any) {
      setError(humanizeGeminiError(e?.message) || e?.message || 'Could not read this file.');
      setStep('pick');
    }
  }

  function captureSelection() {
    if (!selRef.current) return;
    const off = selectionOffsets(selRef.current);
    if (!off) return;
    setIncludedRanges((prev) => mergeRanges([...prev, [off.start, off.end]]));
    window.getSelection()?.removeAllRanges();
  }

  function removeRange(idx: number) {
    setIncludedRanges((prev) => prev.filter((_, i) => i !== idx));
  }

  const selectedBody = useMemo(() => {
    if (!includedRanges.length) return '';
    return mergeRanges(includedRanges).map(([a, b]) => fullText.slice(a, b).trim()).filter(Boolean).join('\n\n');
  }, [includedRanges, fullText]);

  async function cut() {
    if (!selectedBody.trim()) return;
    setStep('cutting');
    setError('');
    try {
      const res = await window.warroom.ai.cutterEmphasize({ body: selectedBody, intent, highlightColor: color, cite });
      const attrs = buildAttrsFromSpans(selectedBody, { underline: res.underline, highlight: res.highlight, small: res.small }, color);
      setEditText(selectedBody);
      setEditAttrs(attrs);
      setTaglines(res.taglines || []);
      setChosenTag((res.taglines && res.taglines[0]) || '');
      setStep('edit');
    } catch (e: any) {
      setError(humanizeGeminiError(e?.message) || e?.message || 'Could not cut the card.');
      setStep('select');
    }
  }

  function applyFormat(kind: 'underline' | 'highlight' | 'small' | 'clear') {
    if (!editRef.current) return;
    const off = selectionOffsets(editRef.current);
    if (!off) return;
    setEditAttrs((prev) => {
      const next = prev.map((a) => ({ ...a }));
      for (let i = off.start; i < off.end && i < next.length; i++) {
        if (kind === 'underline') next[i].u = true;
        else if (kind === 'highlight') { next[i].hl = color; next[i].u = true; next[i].sm = false; }
        else if (kind === 'small') { next[i].sm = true; next[i].u = false; next[i].hl = null; }
        else { next[i].u = false; next[i].hl = null; next[i].sm = false; }
      }
      return next;
    });
    window.getSelection()?.removeAllRanges();
  }

  async function save() {
    const tag = (chosenTag || 'Untitled card').trim();
    if (!editText.trim()) { onClose(); return; }
    setSaving(true);
    const now = new Date().toISOString();
    const runs = runsFromAttrs(editText, editAttrs);
    const imgs = source ? [...pickedImages].sort((a, b) => a - b).map((i) => ({ src: source.images[i].src, alt: source.images[i].alt })) : [];
    const yr = Number(year) || CURRENT_YEAR;
    try {
      await update((db) => {
        const id = crypto.randomUUID();
        const newCard: Card = {
          id, blockId: CUT_BLOCK_ID, tag, cite: cite.trim(), body: editText.trim(),
          bodyRuns: runs, images: imgs.length ? imgs : undefined,
          year: yr, flagged: CURRENT_YEAR - yr > 4, createdAt: now,
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

  // Build display segments for the selection step.
  const selSegments = useMemo(() => {
    const merged = mergeRanges(includedRanges);
    const segs: { text: string; rangeIdx: number | null }[] = [];
    let cursor = 0;
    merged.forEach(([a, b], idx) => {
      if (a > cursor) segs.push({ text: fullText.slice(cursor, a), rangeIdx: null });
      segs.push({ text: fullText.slice(a, b), rangeIdx: idx });
      cursor = b;
    });
    if (cursor < fullText.length) segs.push({ text: fullText.slice(cursor), rangeIdx: null });
    return segs;
  }, [includedRanges, fullText]);

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
          {error && (
            <div className="mb-3 border border-danger/30 rounded-sm bg-danger/5 p-2.5 text-sm text-danger">{error}</div>
          )}

          {/* STEP: pick */}
          {step === 'pick' && (
            <div className="text-center py-10 space-y-4">
              <div className="text-sm text-ink/60 max-w-lg mx-auto space-y-2">
                <p>
                  Save the article first, then import it:
                </p>
                <p className="text-ink/80">
                  <strong>Press ⌘S / Ctrl+S → save as a Webpage (HTML)</strong> so the images come too,
                  or <strong>Print → Save as PDF</strong> for text only.
                </p>
                <p className="text-xs text-ink/40">Warroom AI reads it, then you guide what goes in the card.</p>
              </div>
              <button className="btn-primary text-sm" onClick={pickFile}>Choose a saved page (.html) or PDF…</button>
            </div>
          )}

          {/* STEP: reading */}
          {step === 'reading' && (
            <div className="text-center py-14 text-sm text-ink/60 flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">Reading {fileName} <Dots /></div>
              <div className="text-xs text-ink/40">Pulling the cite, article body, and images.</div>
            </div>
          )}

          {/* STEP: select */}
          {step === 'select' && source && (
            <div className="space-y-3">
              <div className="text-xs text-ink/50">
                <span className="text-ink/70 font-medium">Highlight the text you want in the card.</span>{' '}
                Select a passage and release — selections stack. Hover a selection and click ✕ to remove it.
              </div>
              {source.cite && (
                <div className="text-[11px] text-ink/40 border border-line rounded-sm px-2 py-1.5">
                  <span className="text-ink/55 font-medium">Cite: </span>{source.cite}
                </div>
              )}
              <div
                ref={selRef}
                onMouseUp={captureSelection}
                className="text-sm text-ink/70 leading-relaxed whitespace-pre-wrap select-text rounded-sm border border-line p-3 max-h-[34vh] overflow-y-auto scroll-thin"
              >
                {selSegments.map((seg, i) =>
                  seg.rangeIdx === null ? (
                    <span key={i}>{seg.text}</span>
                  ) : (
                    <span key={i} className="relative group/inc rounded-sm" style={{ backgroundColor: 'var(--accent-soft)', boxShadow: 'inset 0 -2px 0 var(--accent)' }}>
                      {seg.text}
                      <button
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); removeRange(seg.rangeIdx!); }}
                        className="opacity-0 group-hover/inc:opacity-100 transition align-super text-[10px] ml-0.5 px-1 rounded-full bg-danger text-white"
                        title="Remove this selection"
                      >✕</button>
                    </span>
                  )
                )}
              </div>

              {/* Pictures */}
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

              {/* Intent + color (step 3) */}
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
          {step === 'cutting' && (
            <div className="text-center py-14 text-sm text-ink/60 flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">Warroom AI is cutting the card <Dots /></div>
              <div className="text-xs text-ink/40">Deciding what to underline, highlight, and shrink.</div>
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

              {/* Editor toolbar */}
              <div>
                <label className="text-xs text-ink/55 font-medium">Card body <span className="text-ink/35 font-normal">— select text, then format. Words can't be changed (stays verbatim).</span></label>
                <div className="flex items-center gap-1.5 my-1.5 flex-wrap">
                  <button className="btn text-xs underline" onClick={() => applyFormat('underline')} title="Underline (read aloud)">Underline</button>
                  <button className="btn text-xs" onClick={() => applyFormat('highlight')} title="Highlight (most important)">
                    <span className="px-1 rounded-sm" style={{ backgroundColor: HIGHLIGHT_CSS[color] }}>Highlight</span>
                  </button>
                  {COLORS.map((c) => (
                    <button key={c} onClick={() => setColor(c)}
                      className={`w-5 h-5 rounded-full border-2 ${color === c ? 'border-ink' : 'border-transparent'}`}
                      style={{ backgroundColor: HIGHLIGHT_SWATCH[c] }} title={c} />
                  ))}
                  <button className="btn text-xs opacity-70" style={{ fontSize: '10px' }} onClick={() => applyFormat('small')} title="Shrink to small text (not read)">Small</button>
                  <button className="btn text-xs" onClick={() => applyFormat('clear')} title="Remove formatting">Clear</button>
                </div>
                <div ref={editRef} className="text-sm text-ink/80 rounded-sm border border-line p-3 max-h-[34vh] overflow-y-auto scroll-thin select-text">
                  <FormattedBody runs={runsFromAttrs(editText, editAttrs)} />
                </div>
              </div>

              {pickedImages.size > 0 && source && (
                <div className="flex flex-wrap gap-2">
                  {[...pickedImages].sort((a, b) => a - b).map((i) => (
                    <img key={i} src={source.images[i].src} alt={source.images[i].alt || ''} className="max-h-24 rounded-sm border border-line object-contain bg-white" />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-line flex items-center gap-2 shrink-0">
          {step === 'select' && (
            <>
              <button className="btn-primary text-sm" disabled={!selectedBody.trim()} onClick={cut}>Cut card →</button>
              <button className="btn text-sm" onClick={() => setIncludedRanges([])} disabled={!includedRanges.length}>Clear selection</button>
              <span className="text-xs text-ink/40 ml-auto">{includedRanges.length} selection{includedRanges.length !== 1 ? 's' : ''}</span>
            </>
          )}
          {step === 'edit' && (
            <>
              <button className="btn-primary text-sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save card'}</button>
              <button className="btn text-sm" onClick={() => setStep('select')} disabled={saving}>← Back to selection</button>
              <span className="text-xs text-ink/40 ml-auto">Saves to the “Cut Cards” case.</span>
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
