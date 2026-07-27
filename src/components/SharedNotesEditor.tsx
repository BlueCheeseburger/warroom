import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../store/appStore';
import { SharedNote, ChatTeam, NoteTag, NoteTagRow, NoteTagType, PendingMention } from '../types';
import NoteTagBar, { DisplayTag } from './NoteTagBar';
import { getTeamKey, encryptText, decryptText } from '../lib/chatCrypto';

interface Props {
  /** 'opponent' or 'judge' */
  entityType: 'opponent' | 'judge';
  /**
   * Stable cross-user identifier.
   * Opponents: use teamId from OpenCaselist (or "school/teamName" slug).
   * Judges: use Tabroom personId.
   */
  entityId: string;
  entityName: string;
  /** The local (private) notes value. */
  localNotes: string;
  onLocalChange: (val: string) => void;
  /** Called to persist local notes (e.g. update DB). */
  onLocalSave: (val: string) => void;
  /** Items tagged on the private (non-shared) note. Purely local — no upload. */
  localTags?: NoteTag[];
  onLocalTagsChange?: (tags: NoteTag[]) => void;
}

function computeOpponentStableId(o: any): string {
  return o?.teamId ? String(o.teamId) : `${o?.school ?? ''}/${o?.teamName ?? ''}`.toLowerCase().replace(/\s+/g, '-');
}

const PREF_KEY_PREFIX = 'notes_vis_';

export default function SharedNotesEditor({
  entityType, entityId, entityName,
  localNotes, onLocalChange, onLocalSave,
  localTags = [], onLocalTagsChange,
}: Props) {
  const { currentUser, currentTeam, db, flowsIndex, setFlowsIndex, event, setView } = useApp();

  // All teams the user is in (earliest joined first). Falls back to the single
  // currentTeam until the full list loads.
  const [teams, setTeams] = useState<ChatTeam[]>(() => (currentTeam ? [currentTeam] : []));
  useEffect(() => {
    if (!currentUser) { setTeams([]); return; }
    let cancelled = false;
    window.warroom.chat.getTeams(currentUser.id).then((res) => {
      if (cancelled) return;
      if (res.ok && res.data && res.data.length) setTeams(res.data);
      else if (currentTeam) setTeams([currentTeam]);
    }).catch(() => { if (currentTeam) setTeams([currentTeam]); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentTeam?.id]);

  // The default room is the one the user joined first (teams[0]), or the active
  // currentTeam if the list hasn't loaded yet.
  const defaultTeam: ChatTeam | null = teams[0] ?? currentTeam ?? null;

  // Explicit user override (only written to localStorage when the user picks one).
  // Effective visibility is computed reactively so it auto-upgrades to the team
  // default once teams finish loading asynchronously.
  const prefKey = `${PREF_KEY_PREFIX}${entityType}_${entityId}`;
  const [override, setOverride] = useState<string | null>(() => {
    try { return localStorage.getItem(prefKey); } catch { return null; }
  });

  // Resolve override against reality: a stored team id is only valid if the user
  // is still a member of that team.
  const visibility: 'private' | string = (() => {
    if (override === 'private') return 'private';
    if (override && teams.some((t) => t.id === override)) return override;
    // No valid override → default to the first-joined team if we have one.
    return defaultTeam ? defaultTeam.id : 'private';
  })();
  const isShared = visibility !== 'private' && !!defaultTeam;
  const activeTeam = teams.find((t) => t.id === visibility) ?? null;

  const [sharedNotes, setSharedNotes]   = useState<SharedNote[]>([]);
  const [mySharedNote, setMySharedNote] = useState('');
  const [loading, setLoading]           = useState(false);
  const [saving, setSaving]             = useState(false);

  // Refs for debounced saves + flush-on-unmount (so the last keystroke is never lost).
  const sharedSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localSaveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingShared   = useRef<{ content: string } | null>(null);
  const pendingLocal    = useRef<{ content: string } | null>(null);
  const userEditing     = useRef(false); // guards fetch from clobbering active typing

  function setVisibility(v: string) {
    // Flush any pending shared save before changing mode.
    flushShared();
    try { localStorage.setItem(prefKey, v); } catch {}
    setOverride(v);
  }

  // Load shared notes for the selected team.
  useEffect(() => {
    if (!isShared || !currentUser || visibility === 'private') {
      setSharedNotes([]); setMySharedNote(''); userEditing.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    userEditing.current = false;
    window.warroom.notes.get({ teamId: visibility, entityType, entityId })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          const notes = res.data ?? [];
          setSharedNotes(notes);
          // Don't clobber if the user already started typing during the fetch.
          if (!userEditing.current) {
            const mine = notes.find((n) => n.user_id === currentUser.id);
            setMySharedNote(mine?.content ?? '');
          }
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShared, entityType, entityId, visibility, currentUser?.id]);

  // ── Tags (shared/team mode) ────────────────────────────────────────────────
  // Loaded alongside shared notes; kept in a separate table (generalized
  // message_attachments) so tagging isn't gated on the note text existing yet.
  const [sharedTags, setSharedTags] = useState<NoteTagRow[]>([]);
  const [pendingTags, setPendingTags] = useState<{ id: string; type: string; name: string }[]>([]);
  const [tagError, setTagError] = useState<string | null>(null);

  useEffect(() => {
    if (!isShared || visibility === 'private') { setSharedTags([]); return; }
    let cancelled = false;
    window.warroom.notes.getTags({ teamId: visibility, entityType, entityId }).then((res) => {
      if (!cancelled && res.ok) setSharedTags(res.data ?? []);
    });
    return () => { cancelled = true; };
  }, [isShared, entityType, entityId, visibility]);

  // ── Team Files dedup (shared/team mode only) ───────────────────────────────
  // A tagged local doc is checked against the team's existing Team Files
  // (name + exact byte match) before we ask whether to add it there too, so
  // re-tagging the same file never creates a second copy or re-prompts.
  const [pendingConfirm, setPendingConfirm] = useState<{ fileName: string; base64: string } | null>(null);

  async function findMatchingTeamFile(fileName: string, base64: string): Promise<string | null> {
    if (!activeTeam) return null;
    try {
      const res = await window.warroom.teamFiles.getAll(visibility);
      if (!res.ok || !res.data) return null;
      const key = await getTeamKey(visibility, activeTeam.invite_code);
      for (const f of res.data) {
        const name = await decryptText(key, f.name);
        if (name !== fileName) continue;
        const data = await decryptText(key, f.data_b64);
        if (data === base64) return f.id;
      }
      return null;
    } catch { return null; }
  }

  async function attachSharedTag(type: NoteTagType, name: string, data: any) {
    if (!currentUser || visibility === 'private') return;
    const tempId = crypto.randomUUID();
    setPendingTags((prev) => [...prev, { id: tempId, type, name }]);
    try {
      const userName = currentUser.displayName || (currentUser as any).email || 'Unknown';
      const res = await window.warroom.notes.attachTag({
        teamId: visibility, entityType, entityId,
        userId: currentUser.id, userName,
        type, name, data,
      });
      if (res.ok && res.data) setSharedTags((prev) => [...prev, res.data as NoteTagRow]);
      else setTagError(res.error ?? 'Could not save that tag.');
    } finally {
      setPendingTags((prev) => prev.filter((p) => p.id !== tempId));
    }
  }

  /** Resolves the "Also add to Team Files?" prompt for a not-yet-seen local doc. */
  async function confirmAddToTeamFiles(addToFiles: boolean) {
    if (!pendingConfirm || !currentUser || visibility === 'private') { setPendingConfirm(null); return; }
    const { fileName, base64 } = pendingConfirm;
    setPendingConfirm(null);
    if (!addToFiles) {
      await attachSharedTag('speechdoc', fileName, { kind: 'bytes', base64, fileName });
      return;
    }
    if (!activeTeam) return;
    const tempId = crypto.randomUUID();
    setPendingTags((prev) => [...prev, { id: tempId, type: 'speechdoc', name: fileName }]);
    try {
      const key = await getTeamKey(visibility, activeTeam.invite_code);
      const userName = currentUser.displayName || (currentUser as any).email || 'Unknown';
      const [encName, encData] = await Promise.all([encryptText(key, fileName), encryptText(key, base64)]);
      const res = await window.warroom.teamFiles.upload({
        teamId: visibility, uploaderId: currentUser.id, uploaderName: userName, name: encName, dataB64: encData,
      });
      if (!res.ok || !res.data) { setTagError(res.error ?? 'Could not add to Team Files.'); return; }
      setPendingTags((prev) => prev.filter((p) => p.id !== tempId));
      await attachSharedTag('speechdoc', fileName, { kind: 'teamFile', teamFileId: res.data.id });
    } finally {
      setPendingTags((prev) => prev.filter((p) => p.id !== tempId));
    }
  }

  async function buildTagPayload(item: PendingMention): Promise<{ type: NoteTagType; name: string; data: any } | null> {
    if (item.type === 'case') {
      const c = item.data?.case;
      if (c?.ocSource) {
        return { type: 'case', name: item.name, data: { kind: 'url', url: c.ocSource.url, teamName: c.ocSource.teamName, localRefId: item.id } };
      }
      return { type: 'case', name: item.name, data: { kind: 'unavailable', localRefId: item.id } };
    }
    if (item.type === 'flow') {
      let flow: any = null;
      try { flow = await window.warroom.storage.read(`flow_${item.id}`); } catch {}
      return { type: 'flow', name: item.name, data: { kind: 'snapshot', flow, localRefId: item.id } };
    }
    if (item.type === 'opponent') {
      const o = item.data?.opponent;
      return { type: 'opponent', name: item.name, data: { kind: 'pointer', entityStableId: computeOpponentStableId(o), localRefId: item.id } };
    }
    if (item.type === 'judge') {
      const j = item.data?.judge;
      return { type: 'judge', name: item.name, data: { kind: 'pointer', entityStableId: j?.personId, localRefId: item.id } };
    }
    return null;
  }

  async function handleAddSharedTag(item: PendingMention) {
    if (!currentUser || visibility === 'private') return;
    setTagError(null);
    if (item.type === 'speechdoc') {
      const filePath = item.data?.filePath;
      if (!filePath) return;
      const res = await window.warroom.fs.readFileBytes(filePath);
      if (!res?.ok || !res.base64) { setTagError('Could not read that file.'); return; }
      if (res.base64.length > 2_500_000) { setTagError('That doc is too large to share (2.5MB max).'); return; }
      const existingId = await findMatchingTeamFile(item.name, res.base64);
      if (existingId) { await attachSharedTag('speechdoc', item.name, { kind: 'teamFile', teamFileId: existingId }); return; }
      setPendingConfirm({ fileName: item.name, base64: res.base64 });
      return;
    }
    const built = await buildTagPayload(item);
    if (!built) return;
    await attachSharedTag(built.type, built.name, built.data);
  }

  async function handleRemoveSharedTag(id: string) {
    setSharedTags((prev) => prev.filter((t) => t.id !== id));
    await window.warroom.notes.removeTag(id);
  }

  async function openTagRow(row: NoteTagRow) {
    setTagError(null);
    const mine = row.note_user_id === currentUser?.id;
    const d = row.data ?? {};
    if (row.type === 'speechdoc') {
      if (d.kind === 'bytes' && d.base64) {
        const res = await window.warroom.fs.writeTempFile(d.base64, d.fileName || `${row.name}.docx`);
        if (res?.ok && res.path) setView({ kind: 'speech-doc', docPath: res.path } as any);
        else setTagError('Could not open that file.');
        return;
      }
      if (d.kind === 'teamFile' && d.teamFileId) {
        if (!activeTeam) { setTagError('Not signed into a team.'); return; }
        const res = await window.warroom.teamFiles.getAll(visibility);
        const fileRow = res.ok ? res.data?.find((f: any) => f.id === d.teamFileId) : null;
        if (!fileRow) { setTagError('That file is no longer in Team Files.'); return; }
        const key = await getTeamKey(visibility, activeTeam.invite_code);
        const base64 = await decryptText(key, fileRow.data_b64);
        const wt = await window.warroom.fs.writeTempFile(base64, row.name);
        if (wt?.ok && wt.path) setView({ kind: 'speech-doc', docPath: wt.path } as any);
        else setTagError('Could not open that file.');
        return;
      }
      setTagError(`${row.name} isn't available on your device yet.`);
      return;
    }
    if (row.type === 'case') {
      if (mine && d.localRefId && db.cases[d.localRefId]) { setView({ kind: 'case', caseId: d.localRefId } as any); return; }
      if (d.kind === 'url' && d.url) {
        const fetched = await window.warroom.opencaselist.fetchFileToTemp(d.url);
        if (fetched?.ok && fetched.tempPath) setView({ kind: 'speech-doc', docPath: fetched.tempPath } as any);
        else setTagError('Could not fetch that doc — the source link may be gone.');
        return;
      }
      setTagError(`${row.name} isn't available on your device yet.`);
      return;
    }
    if (row.type === 'flow') {
      if (d.localRefId && flowsIndex.some((f) => f.id === d.localRefId)) { setView({ kind: 'flow', flowId: d.localRefId } as any); return; }
      if (d.kind === 'snapshot' && d.flow) {
        const newId = crypto.randomUUID();
        await window.warroom.storage.write(`flow_${newId}`, d.flow);
        const meta = { id: newId, name: d.flow?.name || row.name, event: d.flow?.event || event };
        const newIndex = [...flowsIndex, meta];
        setFlowsIndex(newIndex);
        await window.warroom.storage.write('flows_index', newIndex);
        setView({ kind: 'flow', flowId: newId } as any);
        return;
      }
      setTagError(`${row.name} isn't available on your device yet.`);
      return;
    }
    if (row.type === 'opponent' || row.type === 'judge') {
      if (mine && d.localRefId) {
        setView(row.type === 'opponent' ? { kind: 'opponent', opponentId: d.localRefId } as any : { kind: 'judge', judgeId: d.localRefId } as any);
        return;
      }
      const stableId = d.entityStableId;
      if (row.type === 'opponent') {
        const match: any = Object.values(db.opponents).find((o: any) => computeOpponentStableId(o) === stableId);
        if (match) { setView({ kind: 'opponent', opponentId: match.id } as any); return; }
      } else {
        const match: any = Object.values(db.judges ?? {}).find((j: any) => j.personId === stableId);
        if (match) { setView({ kind: 'judge', judgeId: match.id } as any); return; }
      }
      setView({ kind: 'opponents' } as any);
      return;
    }
  }

  // ── Tags (private/local mode) ──────────────────────────────────────────────
  async function handleAddLocalTag(item: PendingMention) {
    if (!onLocalTagsChange) return;
    let refId = item.id;
    let name = item.name;
    if (item.type === 'opponent' || item.type === 'judge' || item.type === 'flow' || item.type === 'case' || item.type === 'speechdoc') {
      refId = item.type === 'speechdoc' ? (item.data?.filePath ?? item.id) : item.id;
    } else {
      return;
    }
    const tag: NoteTag = { id: crypto.randomUUID(), type: item.type as NoteTagType, name, refId };
    onLocalTagsChange([...localTags, tag]);
  }

  function handleRemoveLocalTag(id: string) {
    onLocalTagsChange?.(localTags.filter((t) => t.id !== id));
  }

  async function openLocalTag(tag: NoteTag) {
    setTagError(null);
    if (tag.type === 'speechdoc') { setView({ kind: 'speech-doc', docPath: tag.refId } as any); return; }
    if (tag.type === 'case') {
      if (db.cases[tag.refId]) { setView({ kind: 'case', caseId: tag.refId } as any); return; }
      setTagError(`${tag.name} no longer exists.`);
      return;
    }
    if (tag.type === 'flow') {
      if (flowsIndex.some((f) => f.id === tag.refId)) { setView({ kind: 'flow', flowId: tag.refId } as any); return; }
      setTagError(`${tag.name} no longer exists.`);
      return;
    }
    if (tag.type === 'opponent') {
      if (db.opponents[tag.refId]) { setView({ kind: 'opponent', opponentId: tag.refId } as any); return; }
      setTagError(`${tag.name} no longer exists.`);
      return;
    }
    if (tag.type === 'judge') {
      if (db.judges?.[tag.refId]) { setView({ kind: 'judge', judgeId: tag.refId } as any); return; }
      setTagError(`${tag.name} no longer exists.`);
      return;
    }
  }

  const doUpsert = useCallback(async (content: string) => {
    if (!currentUser || visibility === 'private') return;
    const userName = currentUser.displayName || (currentUser as any).email || 'Unknown';
    setSaving(true);
    try {
      await window.warroom.notes.upsert({
        teamId: visibility, entityType, entityId, entityName,
        userId: currentUser.id, userName, content,
      });
      setSharedNotes((prev) => {
        const idx = prev.findIndex((n) => n.user_id === currentUser.id);
        const entry: SharedNote = {
          user_id: currentUser.id, user_name: userName,
          content, updated_at: new Date().toISOString(),
        };
        if (idx >= 0) { const next = [...prev]; next[idx] = entry; return next; }
        return [...prev, entry];
      });
    } finally { setSaving(false); }
  }, [visibility, currentUser, entityType, entityId, entityName]);

  // Keep the latest savers in refs so flush-on-unmount never uses a stale closure
  // (e.g. an old team id after the user switched visibility).
  const doUpsertRef    = useRef(doUpsert);
  const onLocalSaveRef = useRef(onLocalSave);
  useEffect(() => { doUpsertRef.current = doUpsert; }, [doUpsert]);
  useEffect(() => { onLocalSaveRef.current = onLocalSave; }, [onLocalSave]);

  function flushShared() {
    if (sharedSaveTimer.current) { clearTimeout(sharedSaveTimer.current); sharedSaveTimer.current = null; }
    if (pendingShared.current) {
      const { content } = pendingShared.current;
      pendingShared.current = null;
      void doUpsertRef.current(content);
    }
  }

  function flushLocal() {
    if (localSaveTimer.current) { clearTimeout(localSaveTimer.current); localSaveTimer.current = null; }
    if (pendingLocal.current) {
      const { content } = pendingLocal.current;
      pendingLocal.current = null;
      onLocalSaveRef.current(content);
    }
  }

  // Flush both on unmount so navigating away within the debounce window saves.
  useEffect(() => {
    return () => { flushShared(); flushLocal(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleMySharedChange(val: string) {
    userEditing.current = true;
    setMySharedNote(val);
    pendingShared.current = { content: val };
    if (sharedSaveTimer.current) clearTimeout(sharedSaveTimer.current);
    sharedSaveTimer.current = setTimeout(() => {
      sharedSaveTimer.current = null;
      pendingShared.current = null;
      void doUpsert(val);
    }, 800);
  }

  function handleLocalChange(val: string) {
    onLocalChange(val);
    pendingLocal.current = { content: val };
    if (localSaveTimer.current) clearTimeout(localSaveTimer.current);
    localSaveTimer.current = setTimeout(() => {
      localSaveTimer.current = null;
      pendingLocal.current = null;
      onLocalSave(val);
    }, 800);
  }

  const otherNotes = sharedNotes.filter(
    (n) => n.user_id !== currentUser?.id && n.content.trim(),
  );
  const hasTeam = teams.length > 0;

  return (
    <div className="space-y-3">
      {/* Header: label + sharing badge/dropdown */}
      <div className="flex items-center justify-between">
        <span className="label">Notes</span>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-ink/30">Saving…</span>}
          {hasTeam ? (
            /* Single pill: yellow when shared, muted when private. Acts as the dropdown. */
            <div className="relative inline-flex items-center">
              <select
                className="text-xs font-medium rounded-full pl-2.5 pr-6 py-0.5 outline-none cursor-pointer appearance-none"
                style={isShared
                  ? { background: '#fef08a', color: '#854d0e', border: 'none' }
                  : { background: 'var(--bg-elevated)', color: 'var(--label-color)', border: '1px solid var(--border-subtle)' }}
                value={isShared ? visibility : 'private'}
                onChange={(e) => setVisibility(e.target.value)}
              >
                <option value="private">Only me</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{isShared && activeTeam?.id === t.id ? `Shared · ${t.name}` : t.name}</option>
                ))}
              </select>
              {/* chevron */}
              <svg className="pointer-events-none absolute right-1.5" width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2.5 3.5L5 6.5L7.5 3.5" stroke={isShared ? '#854d0e' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          ) : (
            <span className="text-xs text-ink/30">Only me</span>
          )}
        </div>
      </div>

      {/* My notes */}
      {isShared ? (
        <div className="space-y-1.5">
          <div className="text-xs text-ink/40 font-medium">
            {currentUser?.displayName || 'You'}
          </div>
          <textarea
            className="input w-full resize-none text-xs"
            rows={4}
            placeholder="Add your notes…"
            value={mySharedNote}
            onChange={(e) => handleMySharedChange(e.target.value)}
            style={{ fontFamily: 'inherit' }}
          />
          <NoteTagBar
            tags={[
              ...sharedTags.filter((t) => t.note_user_id === currentUser?.id).map((t): DisplayTag => ({ id: t.id, type: t.type, name: t.name })),
              ...pendingTags.map((t): DisplayTag => ({ id: t.id, type: t.type, name: t.name, pending: true })),
            ]}
            onAdd={handleAddSharedTag}
            onRemove={handleRemoveSharedTag}
            onOpen={(tag) => { const row = sharedTags.find((t) => t.id === tag.id); if (row) openTagRow(row); }}
            error={tagError}
          />
          {pendingConfirm && (
            <div className="flex items-center gap-2 text-[11px] px-2 py-1.5 rounded-md"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
              <span className="flex-1 truncate">Also add "{pendingConfirm.fileName}" to Team Files?</span>
              <button onClick={() => confirmAddToTeamFiles(true)} className="btn-primary text-[10px] px-2 py-0.5" title="Add this file to your team's shared file library">
                Add
              </button>
              <button onClick={() => confirmAddToTeamFiles(false)} className="btn text-[10px] px-2 py-0.5" title="Tag it here without adding to Team Files">
                Skip
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <textarea
            className="input w-full resize-none text-xs"
            rows={4}
            placeholder="Add your notes…"
            value={localNotes}
            onChange={(e) => handleLocalChange(e.target.value)}
            style={{ fontFamily: 'inherit' }}
          />
          {onLocalTagsChange && (
            <NoteTagBar
              tags={localTags.map((t): DisplayTag => ({ id: t.id, type: t.type, name: t.name }))}
              onAdd={handleAddLocalTag}
              onRemove={handleRemoveLocalTag}
              onOpen={(tag) => { const t = localTags.find((lt) => lt.id === tag.id); if (t) openLocalTag(t); }}
              error={tagError}
            />
          )}
        </div>
      )}

      {/* Teammates' notes, each behind a labeled divider */}
      {isShared && !loading && otherNotes.length > 0 && (
        <div className="space-y-3 pt-1">
          {otherNotes.map((n) => {
            const theirTags = sharedTags.filter((t) => t.note_user_id === n.user_id);
            return (
              <div key={n.user_id}>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                  <span className="text-xs text-ink/40 font-medium shrink-0">{n.user_name}</span>
                  <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                </div>
                <p className="text-xs text-ink/55 leading-relaxed whitespace-pre-wrap px-1">
                  {n.content}
                </p>
                {theirTags.length > 0 && (
                  <div className="px-1 mt-1.5">
                    <NoteTagBar
                      tags={theirTags.map((t): DisplayTag => ({ id: t.id, type: t.type, name: t.name }))}
                      readOnly
                      onOpen={(tag) => { const row = theirTags.find((t) => t.id === tag.id); if (row) openTagRow(row); }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isShared && loading && (
        <div className="text-xs text-ink/30 italic">Loading team notes…</div>
      )}
    </div>
  );
}
