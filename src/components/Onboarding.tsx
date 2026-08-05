import React, { useState, useEffect } from 'react';
import type { FlowMeta } from '../store/appStore';
import { importFlowFile } from '../utils/flowImport';

const EVENT_OPTIONS = [
  { value: 'hspolicy', label: 'HS Policy' },
  { value: 'hsld',     label: 'HS LD' },
  { value: 'hspf',     label: 'HS PF' },
  { value: 'ndtceda',  label: 'College Policy (NDT/CEDA)' },
  { value: 'nfald',    label: 'College LD (NFA-LD)' },
];

type Step = 'event' | 'gemini' | 'import' | 'done';

interface Props {
  onDone: () => void;
}

// ── Speech-doc recents (mirrors SpeechDocViewer.tsx's addRecents) ──────────
// Duplicated rather than imported because SpeechDocViewer doesn't export it —
// same RECENTS_KEY, same shape, same dedup-by-path/cap-40 behavior, so a doc
// added here shows up identically in the sidebar's Cases list.
const SPEECH_RECENTS_KEY = 'warroom-speech-doc-recents';
const SPEECH_RECENTS_MAX = 40;
function addSpeechDocRecents(docs: { path: string; name: string }[]) {
  if (docs.length === 0) return 0;
  let existing: { path: string; name: string }[] = [];
  try { existing = JSON.parse(localStorage.getItem(SPEECH_RECENTS_KEY) ?? '[]'); } catch { /* ignore */ }
  const known = new Set(existing.map((r) => r.path));
  const fresh = docs.filter((d) => !known.has(d.path));
  if (fresh.length === 0) return 0;
  const addedAt = new Date().toISOString();
  const next = [...fresh.map((d) => ({ ...d, addedAt })), ...existing].slice(0, SPEECH_RECENTS_MAX);
  localStorage.setItem(SPEECH_RECENTS_KEY, JSON.stringify(next));
  window.dispatchEvent(new StorageEvent('storage', { key: SPEECH_RECENTS_KEY, newValue: JSON.stringify(next) }));
  return fresh.length;
}

export default function Onboarding({ onDone }: Props) {
  const [step, setStep] = useState<Step>('event');

  // event
  const [event, setEvent] = useState('hspolicy');

  // gemini
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiSaved, setGeminiSaved] = useState(false);

  // import
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<{ docs: number; flows: number } | null>(null);
  const [importError, setImportError] = useState('');

  // Pre-fill any credentials already saved in Settings.
  useEffect(() => {
    Promise.all([
      window.warroom?.secure.get('gemini'),
      window.warroom?.storage.read('app_settings'),
    ]).then(([k, s]) => {
      if (k) setGeminiKey(k);
      if ((s as any)?.event) setEvent((s as any).event);
    });
  }, []);

  async function markDone() {
    await window.warroom?.storage.write('onboarding_done', true);
    onDone();
  }

  async function saveEvent() {
    await window.warroom?.storage.write('app_settings', { event });
    setStep('gemini');
  }

  async function saveGemini() {
    if (geminiKey.trim()) {
      await window.warroom.secure.set('gemini', geminiKey.trim());
      setGeminiSaved(true);
    }
    setTimeout(() => setStep('import'), geminiKey.trim() ? 600 : 0);
  }

  /**
   * Import a batch of picked/walked paths: .docx files become speech docs
   * (added to recents, same as opening one from the sidebar), .xlsx files
   * become flows (parsed and added to flows_index). Runs both kinds from a
   * single mixed picker/folder so the user doesn't have to import twice.
   */
  async function importPaths(paths: string[]) {
    const docxPaths = paths.filter((p) => /\.docx$/i.test(p));
    const xlsxPaths = paths.filter((p) => /\.xlsx$/i.test(p));
    setImporting(true);
    setImportError('');
    try {
      const docsAdded = docxPaths.length
        ? addSpeechDocRecents(docxPaths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() ?? p })))
        : 0;

      let flowsAdded = 0;
      if (xlsxPaths.length) {
        const existing = await window.warroom?.storage.read('flows_index');
        let idx: FlowMeta[] = Array.isArray(existing) ? existing : [];
        for (const p of xlsxPaths) {
          try {
            const { name, data } = await importFlowFile(p);
            const id = crypto.randomUUID();
            const meta: FlowMeta = { id, name: name || `Flow ${idx.length + 1}`, event: data.event, createdAt: new Date().toISOString() };
            idx = [...idx, meta];
            await window.warroom?.storage.write(`flow_data_${id}`, data);
            flowsAdded++;
          } catch {
            // One bad spreadsheet shouldn't sink the rest of the batch — skip and keep going.
          }
        }
        await window.warroom?.storage.write('flows_index', idx);
      }

      setImportSummary((prev) => ({ docs: (prev?.docs ?? 0) + docsAdded, flows: (prev?.flows ?? 0) + flowsAdded }));
      if (docsAdded === 0 && flowsAdded === 0) {
        setImportError('Nothing new was found — those files may already be imported.');
      }
    } catch (e: any) {
      setImportError(e?.message ?? 'Import failed.');
    } finally {
      setImporting(false);
    }
  }

  async function pickImportFiles() {
    const paths = await window.warroom?.dialog.openFiles(['docx', 'xlsx']);
    if (!paths || paths.length === 0) return;
    await importPaths(paths);
  }

  async function pickImportFolder() {
    const res = await window.warroom?.dialog.openFolderOfDocx(['docx', 'xlsx']);
    if (!res) return; // canceled
    if (res.paths.length === 0) {
      setImportError(`No .docx or .xlsx files found in "${res.folderName}".`);
      return;
    }
    await importPaths(res.paths);
  }

  const TOTAL = 3;
  const stepIndex = { event: 0, gemini: 1, import: 2, done: 3 }[step];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}>
      <div className="glass-elevated w-full max-w-md mx-4 p-8" style={{ borderRadius: 18 }}>

        {/* Header row: progress bar + exit button */}
        {step !== 'done' ? (
          <div className="flex items-center gap-3 mb-6">
            <div className="flex gap-1.5 flex-1">
              {Array.from({ length: TOTAL }).map((_, i) => (
                <div
                  key={i}
                  className="h-1 rounded-full flex-1 transition-all duration-300"
                  style={{ background: i < stepIndex ? 'var(--item-selected-bg)' : i === stepIndex ? '#0077ed' : 'var(--border-med)' }}
                />
              ))}
            </div>
            <button
              className="w-6 h-6 flex items-center justify-center rounded-full text-ink/35 hover:text-ink/70 hover:bg-black/8 transition text-base shrink-0"
              onClick={markDone}
              title="Skip setup"
            >
              ×
            </button>
          </div>
        ) : null}

        {step === 'event' && (
          <>
            <div className="label mb-1">Step 1 of {TOTAL}</div>
            <h2 className="text-lg font-semibold text-ink mb-1">What event do you do?</h2>
            <p className="text-xs text-ink/50 mb-5">Used to pre-select the right OpenCaselist database for opponent research.</p>
            <div className="space-y-2 mb-6">
              {EVENT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className="w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium transition border"
                  style={{
                    background: event === o.value ? 'var(--item-selected-bg)' : 'var(--bg-input)',
                    color: event === o.value ? 'var(--item-selected-text)' : 'rgb(var(--ink-rgb))',
                    borderColor: event === o.value ? 'transparent' : 'var(--border-med)',
                  }}
                  onClick={() => setEvent(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <button className="btn-primary px-5 py-2 text-sm" onClick={saveEvent}>Continue</button>
            </div>
          </>
        )}

        {step === 'gemini' && (
          <>
            <div className="label mb-1">Step 2 of {TOTAL}</div>
            <h2 className="text-lg font-semibold text-ink mb-1">Gemini API key</h2>
            <p className="text-xs text-ink/50 mb-5">Powers AI card extraction and block suggestions. Get a free key from <span className="font-medium">aistudio.google.com</span>. Stored encrypted on device.</p>
            <input
              className="input w-full font-mono text-xs mb-2"
              type="password"
              placeholder="AIza…"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveGemini()}
            />
            <div className="flex items-center justify-between mt-5">
              <button className="text-xs text-ink/40 hover:text-ink/60 transition" onClick={saveGemini}>
                Skip for now
              </button>
              <button className="btn-primary px-5 py-2 text-sm" onClick={saveGemini}>
                {geminiSaved ? 'Saved ✓' : 'Save & continue'}
              </button>
            </div>
          </>
        )}

        {step === 'import' && (
          <>
            <div className="label mb-1">Step 3 of {TOTAL}</div>
            <h2 className="text-lg font-semibold text-ink mb-1">Import your existing prep</h2>
            <p className="text-xs text-ink/50 mb-5">
              Already have speech docs or flows? Bring them in now — <span className="font-medium">.docx</span> files
              become speech docs, <span className="font-medium">.xlsx</span> files become flows. Pick individual files
              or a whole folder; either way subfolders are searched too.
            </p>

            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                className="px-4 py-3 rounded-xl text-sm font-medium border transition disabled:opacity-50"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border-med)', color: 'rgb(var(--ink-rgb))' }}
                onClick={pickImportFiles}
                disabled={importing}
              >
                Choose files…
              </button>
              <button
                className="px-4 py-3 rounded-xl text-sm font-medium border transition disabled:opacity-50"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border-med)', color: 'rgb(var(--ink-rgb))' }}
                onClick={pickImportFolder}
                disabled={importing}
              >
                Choose a folder…
              </button>
            </div>

            {importing && <p className="text-xs text-ink/50 mb-4">Importing…</p>}
            {!importing && importSummary && (
              <p className="text-xs mb-4" style={{ color: 'var(--item-selected-bg)' }}>
                Imported {importSummary.docs} speech doc{importSummary.docs === 1 ? '' : 's'} and {importSummary.flows} flow{importSummary.flows === 1 ? '' : 's'} so far.
              </p>
            )}
            {!importing && importError && (
              <p className="text-xs mb-4" style={{ color: 'var(--danger)' }}>{importError}</p>
            )}

            <div className="flex items-center justify-between mt-5">
              <button className="text-xs text-ink/40 hover:text-ink/60 transition" onClick={() => setStep('done')}>
                Skip for now
              </button>
              <button className="btn-primary px-5 py-2 text-sm" onClick={() => setStep('done')}>
                Continue
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <div className="text-center py-4">
            <div className="text-4xl mb-4">✓</div>
            <h2 className="text-lg font-semibold text-ink mb-2">You're all set</h2>
            <p className="text-sm text-ink/50 mb-6">Add OpenCaselist/Tabroom credentials anytime in Settings for opponent disclosure and judge lookups.</p>
            <button className="btn-primary px-6 py-2 text-sm" onClick={markDone}>Get started</button>
          </div>
        )}
      </div>
    </div>
  );
}
