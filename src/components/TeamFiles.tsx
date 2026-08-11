import React, { useEffect, useState } from 'react';
import { useApp, FlowMeta } from '../store/appStore';
import { TeamFile } from '../types';
import { teamKeyFor, encryptText, decryptText } from '../lib/chatCrypto';
import { MAX_ATTACHMENT_BYTES, base64SizeBytes } from '../lib/fileSizeGate';
import { flowDataToXlsxBase64 } from '../utils/flowImport';
import type { StoredFlowData } from './FlowView';
import OversizedFilePopup from './OversizedFilePopup';

// Speech-doc recents — same RECENTS_KEY/shape as SpeechDocViewer.tsx and
// every other reader of this list (not exported from there, so duplicated
// like the other readers).
const SPEECH_RECENTS_KEY = 'warroom-speech-doc-recents';
interface RecentDoc { path: string; name: string }
function getSpeechDocRecents(): RecentDoc[] {
  try { return JSON.parse(localStorage.getItem(SPEECH_RECENTS_KEY) ?? '[]'); } catch { return []; }
}

type AddSource = 'menu' | 'speechdocs' | 'flows';

// A per-team file library, separate from the chat message stream. Every file
// added here comes from the app's own library (speech docs or flows) rather
// than an arbitrary OS file picker, and the device that added it auto-pushes
// fresh content whenever the source changes — two different mechanisms
// depending on the source: speech docs are a real file on disk, watched via
// fs.watch (`onLocalFileChanged` in Chat.tsx, fs.watch machinery in
// electron/main.ts); flows have no file on disk, so FlowView.tsx itself
// checks after every save whether it's linked to a Team File and pushes
// directly (see `pushToWatchedTeamFile`). This component only reads/writes
// team_files rows and renders the list; it doesn't own either watch itself.

interface DecryptedFile extends Omit<TeamFile, 'name' | 'summary_text'> {
  name: string;
  summary_text: string | null;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function TeamFiles() {
  const { currentUser, currentTeam, setView, flowsIndex } = useApp();
  const [files, setFiles] = useState<DecryptedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [watchingIds, setWatchingIds] = useState<Set<string>>(new Set());
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [expandedSummary, setExpandedSummary] = useState<{ id: string; text: string } | null>(null);
  const [addSource, setAddSource] = useState<AddSource | null>(null);

  // Oversized-upload gate: set once a chosen file is measured as over the cap.
  const [oversized, setOversized] = useState<{ path: string; filename: string; base64: string; sizeBytes: number } | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summarizeError, setSummarizeError] = useState('');

  useEffect(() => {
    if (!currentTeam) return;
    load();
    window.warroom.teamFiles.subscribe(currentTeam.id);
    const off = window.warroom.teamFiles.onChange(async (p) => {
      if (!currentTeam) return;
      if (p.eventType === 'DELETE') {
        setFiles((prev) => prev.filter((f) => f.id !== p.row.id));
        return;
      }
      try {
        const key = await teamKeyFor(currentTeam);
        const name = await decryptText(key, p.row.name);
        const summary_text = p.row.summary_text ? await decryptText(key, p.row.summary_text) : null;
        const decrypted: DecryptedFile = { ...p.row, name, summary_text };
        setFiles((prev) => {
          const idx = prev.findIndex((f) => f.id === decrypted.id);
          const next = idx === -1 ? [decrypted, ...prev] : prev.map((f, i) => (i === idx ? decrypted : f));
          return [...next].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        });
      } catch {}
    });
    return () => { off(); window.warroom.teamFiles.unsubscribe(); };
  }, [currentTeam?.id]);

  // Which loaded files THIS device is actively watching for auto-update — only
  // ever true for files this device itself uploaded.
  useEffect(() => {
    if (files.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(files.map(async (f) => {
        const res = await window.warroom.teamFiles.isWatching(f.id);
        return [f.id, !!(res.ok && res.data)] as const;
      }));
      if (!cancelled) setWatchingIds(new Set(entries.filter(([, w]) => w).map(([id]) => id)));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.map((f) => f.id).join(',')]);

  async function load() {
    if (!currentTeam) return;
    setLoading(true);
    const res = await window.warroom.teamFiles.getAll(currentTeam.id);
    if (res.ok) {
      try {
        const key = await teamKeyFor(currentTeam);
        const decrypted = await Promise.all((res.data as TeamFile[]).map(async (f) => ({
          ...f, name: await decryptText(key, f.name),
          summary_text: f.summary_text ? await decryptText(key, f.summary_text) : null,
        })));
        setFiles(decrypted);
      } catch {
        setFiles([]);
      }
    }
    setLoading(false);
  }

  // "Add from your speech docs" — sourced from a doc already saved in the
  // app (no OS file dialog — see the note on `addSource`'s removed "from
  // your computer" option). Ties together the same way as before: watchLocal
  // still applies, since this is still a real path on disk.
  async function addFromSpeechDoc(doc: RecentDoc) {
    setError('');
    try {
      const bytesRes = await window.warroom.fs.readFileBytes(doc.path);
      if (!bytesRes.ok || !bytesRes.base64) throw new Error(bytesRes.error ?? 'Failed to read file');
      const sizeBytes = base64SizeBytes(bytesRes.base64);
      if (sizeBytes > MAX_ATTACHMENT_BYTES) {
        setOversized({ path: doc.path, filename: doc.name, base64: bytesRes.base64, sizeBytes });
        return;
      }
      await finishUpload(doc.path, doc.name, bytesRes.base64);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to add file');
    } finally {
      setAddSource(null);
    }
  }

  // "Add from your flows" — flows have no file on disk, so there's no OS
  // dialog and no watchLocal; instead finishUpload registers a flow watch
  // (see FlowView.tsx's pushToWatchedTeamFile) so future saves push here too.
  async function addFromFlow(flow: FlowMeta) {
    setError('');
    try {
      const data = await window.warroom.storage.read(`flow_data_${flow.id}`);
      if (!data) throw new Error('Could not read this flow');
      const base64 = flowDataToXlsxBase64(data as StoredFlowData);
      const filename = `${flow.name || 'Flow'}.xlsx`;
      const sizeBytes = base64SizeBytes(base64);
      if (sizeBytes > MAX_ATTACHMENT_BYTES) {
        setError('This flow is too large to share.');
        return;
      }
      await finishUpload('', filename, base64, undefined, flow.id);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to add flow');
    } finally {
      setAddSource(null);
    }
  }

  async function finishUpload(path: string, filename: string, base64: string, summaryText?: string, flowId?: string) {
    if (!currentUser || !currentTeam) return;
    setUploading(true);
    try {
      const key = await teamKeyFor(currentTeam);
      const [encName, encData, encSummary] = await Promise.all([
        encryptText(key, filename),
        encryptText(key, base64),
        summaryText ? encryptText(key, summaryText) : Promise.resolve(undefined),
      ]);
      const res = await window.warroom.teamFiles.upload({
        teamId: currentTeam.id, uploaderId: currentUser.id, uploaderName: currentUser.displayName,
        name: encName, dataB64: encData, summaryText: encSummary,
      });
      if (!res.ok || !res.data) throw new Error(res.error ?? 'Upload failed');
      // Only watch for auto-update when the real content was sent — a
      // name-only or summarized upload has nothing on Supabase to keep in
      // sync. Flow uploads register a flow watch; doc uploads (from computer
      // or from the speech-doc library) register a local-path watch.
      if (base64) {
        if (flowId) await window.warroom.teamFiles.watchFlow(res.data.id, flowId);
        else if (path) await window.warroom.teamFiles.watchLocal(res.data.id, path);
        setWatchingIds((prev) => new Set(prev).add(res.data.id));
      }
      setFiles((prev) => (prev.find((f) => f.id === res.data.id) ? prev : [{ ...res.data, name: filename, summary_text: summaryText ?? null }, ...prev]));
    } catch (e: any) {
      setError(e?.message ?? 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  }

  function cancelOversized() { setOversized(null); setSummarizeError(''); }

  async function uploadOversizedNameOnly() {
    if (!oversized) return;
    setOversized(null);
    await finishUpload(oversized.path, oversized.filename, '');
  }

  async function summarizeOversizedUpload() {
    if (!oversized) return;
    setSummarizing(true); setSummarizeError('');
    try {
      const extractRes = await (window.warroom as any)?.speechdoc?.extract(oversized.path);
      if (!extractRes?.ok) throw new Error(extractRes?.error ?? 'Failed to read document');
      const text = extractRes.data.full || extractRes.data.tokenSaving || '';
      const res = await (window.warroom as any)?.speechdoc?.summarizeForAttachment(text, oversized.filename);
      if (!res?.ok) throw new Error(res?.error ?? 'Summarization failed');
      const { path, filename } = oversized;
      setOversized(null);
      await finishUpload(path, filename, '', res.data);
    } catch (e: any) {
      setSummarizeError(e?.message ?? 'Failed to summarize');
    } finally {
      setSummarizing(false);
    }
  }

  async function handleOpen(file: DecryptedFile) {
    if (!currentTeam || openingId || file.removed) return;
    if (file.summary_text) { setExpandedSummary((cur) => cur?.id === file.id ? null : { id: file.id, text: file.summary_text! }); return; }
    if (!file.data_b64) return; // name-only upload, nothing to open
    setOpeningId(file.id);
    setError('');
    try {
      const key = await teamKeyFor(currentTeam);
      const base64 = await decryptText(key, file.data_b64);
      const res = await window.warroom.fs.writeTempFile(base64, file.name);
      if (res.ok && res.path) setView({ kind: 'speech-doc', docPath: res.path } as any);
      else setError(res.error ?? 'Failed to open file');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to open file');
    } finally {
      setOpeningId(null);
    }
  }

  // Clears the file's content but keeps the row — name, uploader, and dates
  // stay visible to the team as a record that a file used to live here.
  async function handleRemove(file: DecryptedFile) {
    setDeletingId(file.id);
    const res = await window.warroom.teamFiles.removeContent(file.id);
    if (res.ok) setFiles((prev) => prev.map((f) => f.id === file.id ? { ...f, removed: true, data_b64: '' } : f));
    else setError(res.error ?? 'Failed to remove file');
    setDeletingId(null);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto scroll-thin px-3 py-3 space-y-2">
        {oversized && (
          <OversizedFilePopup
            fileName={oversized.filename}
            sizeBytes={oversized.sizeBytes}
            allowSummarize
            summarizing={summarizing}
            error={summarizeError}
            onSummarize={summarizeOversizedUpload}
            onSendNameOnly={uploadOversizedNameOnly}
            onCancel={cancelOversized}
          />
        )}
        {error && <p className="text-xs pb-1" style={{ color: '#ef4444' }}>{error}</p>}
        {loading ? (
          <div className="text-xs text-center pt-6" style={{ color: 'var(--nav-inactive-color)' }}>Loading…</div>
        ) : files.length === 0 ? (
          <div className="text-xs text-center pt-6 leading-relaxed" style={{ color: 'var(--nav-inactive-color)' }}>
            No files yet.<br />Add a speech doc or flow to share it with your team.
          </div>
        ) : files.map((f) => {
          const isHovered = hoveredId === f.id;
          const isMine = f.uploader_id === currentUser?.id;
          const noContent = !f.data_b64 && !f.summary_text;
          const statusLabel = f.removed ? 'Removed' : f.summary_text ? 'AI summary — too large to send in full' : noContent ? 'Too large — name only' : `Modified ${timeAgo(f.updated_at)}`;
          return (
            <div key={f.id}>
              <div
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-colors"
                style={{ background: isHovered && !f.removed ? 'var(--nav-hover-bg)' : 'var(--bg-card)', border: '1px solid var(--border-side)', opacity: f.removed ? 0.55 : 1 }}
                onMouseEnter={() => setHoveredId(f.id)}
                onMouseLeave={() => setHoveredId((cur) => (cur === f.id ? null : cur))}
              >
                <span className="text-lg leading-none shrink-0">📝</span>
                <button
                  className="flex-1 min-w-0 text-left"
                  title={f.removed ? 'Removed by uploader' : f.summary_text ? 'Show AI summary' : noContent ? 'No content — too large to send' : 'Open in Speech Doc Viewer'}
                  onClick={() => handleOpen(f)}
                  disabled={openingId === f.id || f.removed || noContent && !f.summary_text}
                  style={{ background: 'transparent', border: 'none', cursor: f.removed || (noContent && !f.summary_text) ? 'default' : openingId === f.id ? 'default' : 'pointer' }}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-semibold truncate" style={{ color: 'var(--ink)' }}>
                      {openingId === f.id ? 'Opening…' : f.name}
                    </span>
                    {!f.removed && watchingIds.has(f.id) && (
                      <span
                        className="text-[11px] leading-none shrink-0"
                        title="This device pushes updates automatically when the source changes"
                      >
                        🔄
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] mt-0.5 truncate" style={{ color: f.summary_text || noContent ? '#d97706' : 'var(--nav-inactive-color)' }}>
                    {statusLabel} · {f.uploader_name}
                  </div>
                </button>
                {isMine && !f.removed && (
                  <button
                    title="Remove — clears the file but keeps its record"
                    onClick={() => handleRemove(f)}
                    disabled={deletingId === f.id}
                    className="w-6 h-6 flex items-center justify-center rounded transition shrink-0"
                    style={{
                      color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none',
                      cursor: isHovered ? 'pointer' : 'default',
                      opacity: isHovered ? 1 : 0, pointerEvents: isHovered ? 'auto' : 'none',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#ef4444'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--nav-inactive-color)'; }}
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
              {expandedSummary?.id === f.id && (
                <div className="mt-1 px-3 py-2 rounded-lg text-[11px] leading-relaxed whitespace-pre-wrap" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)', color: 'var(--ink)' }}>
                  {expandedSummary.text}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="shrink-0 px-3 pb-3 pt-2 relative" style={{ borderTop: '1px solid var(--border-side)' }}>
        {addSource && (
          <div
            className="absolute left-3 right-3 bottom-full mb-1.5 rounded-lg overflow-hidden z-10"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-med)', boxShadow: '0 2px 12px rgba(0,0,0,0.24)' }}
          >
            {addSource === 'menu' && (
              <>
                <AddSourceRow label="From your speech docs" title="Pick a saved speech doc" onClick={() => setAddSource('speechdocs')} />
                <AddSourceRow label="From your flows" title="Pick a saved flow" onClick={() => setAddSource('flows')} />
              </>
            )}
            {addSource === 'speechdocs' && (
              <PickerList
                items={getSpeechDocRecents()}
                getLabel={(d) => d.name}
                emptyLabel="No speech docs yet."
                onBack={() => setAddSource('menu')}
                onPick={addFromSpeechDoc}
              />
            )}
            {addSource === 'flows' && (
              <PickerList
                items={flowsIndex}
                getLabel={(f) => f.name}
                emptyLabel="No flows yet."
                onBack={() => setAddSource('menu')}
                onPick={addFromFlow}
              />
            )}
          </div>
        )}
        <button
          className="btn-primary w-full text-xs py-1.5"
          title="Add a file to share with your team"
          onClick={() => setAddSource((cur) => (cur ? null : 'menu'))}
          disabled={uploading}
        >
          {uploading ? 'Uploading…' : '+ Add file'}
        </button>
      </div>
    </div>
  );
}

function AddSourceRow({ label, title, onClick }: { label: string; title?: string; onClick: () => void }) {
  return (
    <button
      className="w-full text-left px-3 py-2 text-xs transition-colors"
      style={{ background: 'transparent', border: 'none', color: 'var(--ink)' }}
      title={title ?? label}
      onClick={onClick}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {label}
    </button>
  );
}

function PickerList<T>({ items, getLabel, emptyLabel, onBack, onPick }: {
  items: T[]; getLabel: (item: T) => string; emptyLabel: string;
  onBack: () => void; onPick: (item: T) => void;
}) {
  return (
    <div className="max-h-52 overflow-y-auto scroll-thin">
      <button
        className="w-full text-left px-3 py-2 text-xs font-medium sticky top-0"
        style={{ background: 'var(--bg-elevated)', border: 'none', borderBottom: '1px solid var(--border-side)', color: 'var(--nav-inactive-color)' }}
        title="Back to add options"
        onClick={onBack}
      >
        ‹ Back
      </button>
      {items.length === 0 ? (
        <div className="px-3 py-3 text-xs text-center" style={{ color: 'var(--nav-inactive-color)' }}>{emptyLabel}</div>
      ) : items.map((item, i) => (
        <AddSourceRow key={i} label={getLabel(item)} onClick={() => onPick(item)} />
      ))}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
