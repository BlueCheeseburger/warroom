import React, { useEffect, useState } from 'react';
import { useApp } from '../store/appStore';
import { TeamFile } from '../types';
import { getTeamKey, encryptText, decryptText } from '../lib/chatCrypto';

// A per-team file library, separate from the chat message stream. Files are
// uploaded once (encrypted client-side, see chatCrypto.ts) and the uploader's
// own device auto-pushes fresh content whenever their local copy changes on
// disk — see the `onLocalFileChanged` listener wired up in Chat.tsx, and the
// fs.watch machinery in electron/main.ts. This component only reads/writes
// team_files rows and renders the list; it doesn't own the watch itself.

interface DecryptedFile extends Omit<TeamFile, 'name'> {
  name: string;
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
  const { currentUser, currentTeam, setView } = useApp();
  const [files, setFiles] = useState<DecryptedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [watchingIds, setWatchingIds] = useState<Set<string>>(new Set());
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

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
        const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
        const name = await decryptText(key, p.row.name);
        const decrypted: DecryptedFile = { ...p.row, name };
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
        const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
        const decrypted = await Promise.all((res.data as TeamFile[]).map(async (f) => ({
          ...f, name: await decryptText(key, f.name),
        })));
        setFiles(decrypted);
      } catch {
        setFiles([]);
      }
    }
    setLoading(false);
  }

  async function handleUpload() {
    if (!currentUser || !currentTeam) return;
    setError('');
    try {
      const path = await window.warroom.dialog.openFile(['docx']);
      if (!path) return;
      setUploading(true);
      const bytesRes = await window.warroom.fs.readFileBytes(path);
      if (!bytesRes.ok || !bytesRes.base64) throw new Error(bytesRes.error ?? 'Failed to read file');
      const filename = path.split(/[\\/]/).pop() ?? 'Document.docx';
      const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
      const [encName, encData] = await Promise.all([
        encryptText(key, filename),
        encryptText(key, bytesRes.base64),
      ]);
      const res = await window.warroom.teamFiles.upload({
        teamId: currentTeam.id, uploaderId: currentUser.id, uploaderName: currentUser.displayName,
        name: encName, dataB64: encData,
      });
      if (!res.ok || !res.data) throw new Error(res.error ?? 'Upload failed');
      await window.warroom.teamFiles.watchLocal(res.data.id, path);
      setWatchingIds((prev) => new Set(prev).add(res.data.id));
      // Optimistic prepend — realtime will also deliver this row, but the id
      // match in onChange's upsert-by-id logic means it just replaces in place.
      setFiles((prev) => (prev.find((f) => f.id === res.data.id) ? prev : [{ ...res.data, name: filename }, ...prev]));
    } catch (e: any) {
      setError(e?.message ?? 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  }

  async function handleOpen(file: DecryptedFile) {
    if (!currentTeam || openingId) return;
    setOpeningId(file.id);
    setError('');
    try {
      const key = await getTeamKey(currentTeam.id, currentTeam.invite_code);
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

  async function handleDelete(file: DecryptedFile) {
    setDeletingId(file.id);
    const res = await window.warroom.teamFiles.delete(file.id);
    if (res.ok) setFiles((prev) => prev.filter((f) => f.id !== file.id));
    else setError(res.error ?? 'Failed to delete file');
    setDeletingId(null);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto scroll-thin px-3 py-3 space-y-2">
        {error && <p className="text-xs pb-1" style={{ color: '#ef4444' }}>{error}</p>}
        {loading ? (
          <div className="text-xs text-center pt-6" style={{ color: 'var(--nav-inactive-color)' }}>Loading…</div>
        ) : files.length === 0 ? (
          <div className="text-xs text-center pt-6 leading-relaxed" style={{ color: 'var(--nav-inactive-color)' }}>
            No files yet.<br />Upload a .docx to share it with your team.
          </div>
        ) : files.map((f) => {
          const isHovered = hoveredId === f.id;
          const isMine = f.uploader_id === currentUser?.id;
          return (
            <div
              key={f.id}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-colors"
              style={{ background: isHovered ? 'var(--nav-hover-bg)' : 'var(--bg-card)', border: '1px solid var(--border-side)' }}
              onMouseEnter={() => setHoveredId(f.id)}
              onMouseLeave={() => setHoveredId((cur) => (cur === f.id ? null : cur))}
            >
              <span className="text-lg leading-none shrink-0">📝</span>
              <button
                className="flex-1 min-w-0 text-left"
                title="Open in Speech Doc Viewer"
                onClick={() => handleOpen(f)}
                disabled={openingId === f.id}
                style={{ background: 'transparent', border: 'none', cursor: openingId === f.id ? 'default' : 'pointer' }}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs font-semibold truncate" style={{ color: 'var(--ink)' }}>
                    {openingId === f.id ? 'Opening…' : f.name}
                  </span>
                  {watchingIds.has(f.id) && (
                    <span
                      className="text-[11px] leading-none shrink-0"
                      title="This device watches your local file and pushes updates automatically when you save changes"
                    >
                      🔄
                    </span>
                  )}
                </div>
                <div className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--nav-inactive-color)' }}>
                  Modified {timeAgo(f.updated_at)} · {f.uploader_name}
                </div>
              </button>
              {isMine && (
                <button
                  title="Delete"
                  onClick={() => handleDelete(f)}
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
          );
        })}
      </div>
      <div className="shrink-0 px-3 pb-3 pt-2" style={{ borderTop: '1px solid var(--border-side)' }}>
        <button
          className="btn-primary w-full text-xs py-1.5"
          title="Upload a .docx to share with your team"
          onClick={handleUpload}
          disabled={uploading}
        >
          {uploading ? 'Uploading…' : '+ Add file'}
        </button>
      </div>
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
