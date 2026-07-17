import React, { useMemo, useState } from 'react';
import type { SheetData } from './FlowView';
import type { AIClarification, AIQuestion } from '../types';
import AIQuestionPrompt from './AIQuestionPrompt';
import { LoadingState } from './Spinner';
import { humanizeGeminiError } from '../utils/geminiError';
import { htmlToText } from '../lib/cellHtml';

type Step = 'setup' | 'analyzing' | 'question' | 'result';

interface UploadedDoc {
  fileName: string;
  text: string;
}

// Flattens the flow into a plain-text summary an LLM can reason about clash
// across speeches with: for each sheet, for each column (speech, in the flow's
// own left-to-right order), every non-empty cell in row order. See
// DEBATE_DOC_STRUCTURE.md / CLAUDE.md for why cell HTML has to go through
// htmlToText rather than being sent raw.
function buildFlowSummary(sheets: SheetData[], columns: string[]): string {
  const lines: string[] = [];
  for (const sheet of sheets) {
    lines.push(`=== Sheet: ${sheet.name} ===`);
    for (let ci = 0; ci < columns.length; ci++) {
      const col = columns[ci];
      const entries = Object.entries(sheet.cells || {})
        .map(([key, html]) => {
          const [riStr, ciStr] = key.split('-');
          return { ri: Number(riStr), ci: Number(ciStr), text: htmlToText(String(html ?? '')).trim() };
        })
        .filter((e) => e.ci === ci && e.text)
        .sort((a, b) => a.ri - b.ri);
      if (entries.length === 0) {
        lines.push(`[${col}] (empty)`);
      } else {
        for (const e of entries) lines.push(`[${col}] ${e.text}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

// Local copy of the shared AI-emphasis renderer — every AI-output panel in this
// codebase defines its own (no shared component exists yet). Parses **bold**,
// *italic*, __underline__, `code` per the CLAUDE.md "always support emphasis" rule.
function RichText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|__(.+?)__|`(.+?)`|\*(.+?)\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const full = match[0];
    if (full.startsWith('**')) parts.push(<strong key={key++}>{match[2]}</strong>);
    else if (full.startsWith('__')) parts.push(<u key={key++}>{match[3]}</u>);
    else if (full.startsWith('`')) parts.push(<code key={key++} style={{ fontFamily: 'monospace', fontSize: '0.9em', background: 'var(--bg-hover)', borderRadius: 3, padding: '1px 4px' }}>{match[4]}</code>);
    else parts.push(<em key={key++}>{match[5]}</em>);
    last = match.index + full.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export default function AnalyzeRound({
  sheets, columns, event, flowId, onClose,
}: {
  sheets: SheetData[];
  columns: string[];
  event: 'policy' | 'pf';
  flowId?: string;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>('setup');
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  const [pendingQuestion, setPendingQuestion] = useState<AIQuestion | null>(null);
  const [clarifications, setClarifications] = useState<AIClarification[]>([]);
  const [answering, setAnswering] = useState(false);
  const [analysis, setAnalysis] = useState('');

  const flowSummary = useMemo(() => buildFlowSummary(sheets, columns), [sheets, columns]);

  async function addDocs(paths: string[]) {
    if (!paths.length) return;
    setDocsLoading(true);
    setError('');
    try {
      for (const p of paths) {
        const res = await (window.warroom as any).speechdoc.extract(p);
        if (!res?.ok) continue;
        const fileName = p.split(/[\\/]/).pop() || 'document.docx';
        setDocs((prev) => [...prev, { fileName, text: String(res.data?.full ?? '').slice(0, 20000) }]);
      }
    } catch (e: any) {
      setError(e?.message || 'Could not read one of those documents.');
    } finally {
      setDocsLoading(false);
    }
  }

  async function pickDocs() {
    const paths = await window.warroom.dialog.openFiles(['docx']);
    if (paths && paths.length) await addDocs(paths);
  }

  function removeDoc(fileName: string) {
    setDocs((prev) => prev.filter((d) => d.fileName !== fileName));
  }

  async function runAnalyze(clars: AIClarification[]) {
    setPendingQuestion(null);
    setStep('analyzing');
    setError('');
    try {
      const res = await (window.warroom as any).ai.analyzeRound({
        flowSummary, notes, docs, event, clarifications: clars,
      });
      if (res?.question) {
        setPendingQuestion(res.question);
        setStep('question');
        return;
      }
      setAnalysis(String(res?.analysis ?? ''));
      setClarifications([]);
      setStep('result');
    } catch (e: any) {
      setError(humanizeGeminiError(e?.message) || e?.message || 'Could not analyze the round.');
      setStep('setup');
    }
  }

  async function answerQuestion(answer: string) {
    if (!pendingQuestion || answering) return;
    setAnswering(true);
    const next = [...clarifications, { question: pendingQuestion.question, answer }];
    setClarifications(next);
    await runAnalyze(next);
    setAnswering(false);
  }

  function startOver() {
    setAnalysis('');
    setClarifications([]);
    setPendingQuestion(null);
    setError('');
    setStep('setup');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div className="glass-elevated rounded-md w-full max-w-2xl max-h-[88vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-3 border-b border-line flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-semibold">Analyze round with Warroom AI</h2>
            <p className="text-xs text-ink/40">{stepLabel(step)}</p>
          </div>
          <button className="text-ink/40 hover:text-ink text-lg leading-none" onClick={onClose}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin p-5">
          {error && (
            <div className="mb-3 border border-danger/30 rounded-sm bg-danger/5 p-2.5 text-sm text-danger">{error}</div>
          )}

          {/* STEP: setup */}
          {step === 'setup' && (
            <div className="space-y-4">
              <div>
                <button
                  className="text-xs text-ink/50 hover:text-ink/80 underline decoration-dotted"
                  onClick={() => setShowSummary((v) => !v)}
                >
                  {showSummary ? 'Hide' : 'Preview'} what's being read from your flow
                </button>
                {showSummary && (
                  <pre className="mt-2 text-[11px] leading-relaxed text-ink/60 rounded-sm border border-line p-2.5 max-h-40 overflow-y-auto scroll-thin whitespace-pre-wrap">
                    {flowSummary || '(flow is empty)'}
                  </pre>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-ink/55 font-medium">Additional context for Warroom AI</label>
                <textarea
                  className="input w-full text-sm" rows={3}
                  placeholder="e.g. I'm Neg, this is round 4, I think we're ahead on the DA but losing case — anything else not already on the flow"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-ink/55 font-medium">Supplementary docs <span className="text-ink/35 font-normal">(optional)</span></label>
                  {docsLoading && <span className="text-[11px] text-ink/40">Reading…</span>}
                </div>
                <div
                  className="flex flex-col items-center justify-center py-5 text-center border-2 border-dashed border-line rounded-sm cursor-pointer hover:border-ink/30 transition"
                  onClick={pickDocs}
                  onDrop={async (e) => {
                    e.preventDefault();
                    const files = Array.from(e.dataTransfer.files);
                    if (files.length === 0) return;
                    const paths = await window.warroom.dialog.resolveDroppedFiles(files, ['docx']);
                    if (paths.length > 0) await addDocs(paths);
                    else setError('Those files could not be opened — supplementary docs must be .docx.');
                  }}
                  onDragOver={(e) => e.preventDefault()}
                >
                  <div className="text-xs font-medium text-ink/60">Drop case docs / blocks here (.docx)</div>
                  <div className="text-[11px] text-ink/40 mt-0.5">or click to choose files — several at once is fine</div>
                </div>
                {docs.length > 0 && (
                  <div className="space-y-1">
                    {docs.map((d) => (
                      <div key={d.fileName} className="flex items-center justify-between text-xs rounded-sm border border-line px-2 py-1">
                        <span className="truncate text-ink/70">{d.fileName}</span>
                        <button className="text-ink/40 hover:text-danger px-1" onClick={() => removeDoc(d.fileName)} title="Remove">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP: analyzing */}
          {step === 'analyzing' && (
            <div className="py-14">
              <LoadingState messages={[
                'Warroom AI is reading your flow…',
                'Checking what got dropped…',
                'Weighing who is ahead on each clash…',
                'Drafting suggestions for your next speech…',
              ]} />
            </div>
          )}

          {/* STEP: question */}
          {step === 'question' && pendingQuestion && (
            <div className="py-6">
              <AIQuestionPrompt question={pendingQuestion} onAnswer={answerQuestion} busy={answering} />
            </div>
          )}

          {/* STEP: result */}
          {step === 'result' && (
            <div className="text-sm text-ink/80 leading-relaxed whitespace-pre-wrap">
              <RichText text={analysis} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-line flex items-center gap-2 shrink-0">
          {step === 'setup' && (
            <>
              <button className="btn-primary text-sm" onClick={() => runAnalyze(clarifications)}>Analyze round →</button>
              <button className="btn text-sm ml-auto" onClick={onClose}>Cancel</button>
            </>
          )}
          {(step === 'analyzing' || step === 'question') && (
            <button className="btn text-sm ml-auto" onClick={onClose}>Cancel</button>
          )}
          {step === 'result' && (
            <>
              <button className="btn text-sm" onClick={startOver}>← Analyze again</button>
              <button className="btn-primary text-sm ml-auto" onClick={onClose}>Done</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function stepLabel(step: Step): string {
  switch (step) {
    case 'setup': return 'Give Warroom AI context, then analyze';
    case 'analyzing': return 'Analyzing…';
    case 'question': return 'One quick question';
    case 'result': return 'Strategic read of the round';
  }
}
