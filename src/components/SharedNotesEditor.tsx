import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../store/appStore';
import { SharedNote, ChatTeam, NoteTag, NoteTagRow, NoteTagType, PendingMention } from '../types';
import NoteTagBar, { DisplayTag } from './NoteTagBar';
import MentionPicker from './MentionPicker';
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

const TAG_TYPES: PendingMention['type'][] = ['speechdoc', 'case', 'flow', 'opponent', 'judge'];
const NOTES_PLACEHOLDER = 'Add your notes… type @ to attach a doc, flow, opponent, or judge';

// ── @ mention helper, shared by the private and team note textareas ────────
// Tags render as chips below the textarea (not inline text), so selecting an
// item strips the "@query" fragment the user was typing instead of replacing
// it with mention text.
function useAtMention() {
  const [atQuery, setAtQuery] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function onTextChange(value: string) {
    const cursor = textareaRef.current?.selectionStart ?? value.length;
    const match = value.slice(0, cursor).match(/@(\w*)$/);
    setAtQuery(match ? match[1] : null);
  }

  function stripTrigger(value: string): string {
    const cursor = textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, cursor).replace(/@\w*$/, '');
    const after = value.slice(cursor);
    const pos = before.length;
    setTimeout(() => { textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(pos, pos); }, 0);
    return before + after;
  }

  return { atQuery, setAtQuery, textareaRef, onTextChange, stripTrigger };
}

// ── Private (local, non-shared) note panel ──────────────────────────────────
function PrivatePanel({
  localNotes, onLocalChange, onLocalSave, localTags, onLocalTagsChange, db, flowsIndex, setView,
}: {
  localNotes: string; onLocalChange: (v: string) => void; onLocalSave: (v: string) => void;
  localTags: NoteTag[]; onLocalTagsChange?: (tags: NoteTag[]) => void;
  db: any; flowsIndex: any[]; setView: (v: any) => void;
}) {
  const [tagError, setTagError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ content: string } | null>(null);
  const { atQuery, setAtQuery, textareaRef, onTextChange, stripTrigger } = useAtMention();

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (pending.current) onLocalSave(pending.current.content);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChange(val: string) {
    onLocalChange(val);
    onTextChange(val);
    pending.current = { content: val };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; pending.current = null; onLocalSave(val); }, 800);
  }

  function handleAddLocalTag(item: PendingMention) {
    if (!onLocalTagsChange) return;
    const refId = item.type === 'speechdoc' ? (item.data?.filePath ?? item.id) : item.id;
    const tag: NoteTag = { id: crypto.randomUUID(), type: item.type as NoteTagType, name: item.name, refId };
    onLocalTagsChange([...localTags, tag]);
  }
  function handleRemoveLocalTag(id: string) { onLocalTagsChange?.(localTags.filter((t) => t.id !== id)); }

  async function openLocalTag(tag: NoteTag) {
    setTagError(null);
    if (tag.type === 'speechdoc') { setView({ kind: 'speech-doc', docPath: tag.refId }); return; }
    if (tag.type === 'case') {
      if (db.cases[tag.refId]) { setView({ kind: 'case', caseId: tag.refId }); return; }
      setTagError(`${tag.name} no longer exists.`); return;
    }
    if (tag.type === 'flow') {
      if (flowsIndex.some((f: any) => f.id === tag.refId)) { setView({ kind: 'flow', flowId: tag.refId }); return; }
      setTagError(`${tag.name} no longer exists.`); return;
    }
    if (tag.type === 'opponent') {
      if (db.opponents[tag.refId]) { setView({ kind: 'opponent', opponentId: tag.refId }); return; }
      setTagError(`${tag.name} no longer exists.`); return;
    }
    if (tag.type === 'judge') {
      if (db.judges?.[tag.refId]) { setView({ kind: 'judge', judgeId: tag.refId }); return; }
      setTagError(`${tag.name} no longer exists.`); return;
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="text-xs text-ink/40 font-medium">Private</div>
      <div className="relative">
        <textarea
          ref={textareaRef}
          className="input w-full resize-none text-xs"
          rows={4}
          placeholder={NOTES_PLACEHOLDER}
          value={localNotes}
          onChange={(e) => handleChange(e.target.value)}
          style={{ fontFamily: 'inherit' }}
        />
        {atQuery !== null && (
          <MentionPicker
            query={atQuery}
            types={TAG_TYPES}
            onSelect={(item) => { setAtQuery(null); handleAddLocalTag(item); handleChange(stripTrigger(localNotes)); }}
            onClose={() => setAtQuery(null)}
          />
        )}
      </div>
      {onLocalTagsChange && (localTags.length > 0 || tagError) && (
        <NoteTagBar
          tags={localTags.map((t): DisplayTag => ({ id: t.id, type: t.type, name: t.name }))}
          onRemove={handleRemoveLocalTag}
          onOpen={(tag) => { const t = localTags.find((lt) => lt.id === tag.id); if (t) openLocalTag(t); }}
          error={tagError}
        />
      )}
    </div>
  );
}

// ── One team's shared note panel ────────────────────────────────────────────
function TeamPanel({
  team, entityType, entityId, entityName, initialNotes, initialTags,
  currentUser, db, flowsIndex, setFlowsIndex, event, setView,
}: {
  team: ChatTeam; entityType: 'opponent' | 'judge'; entityId: string; entityName: string;
  initialNotes: SharedNote[]; initialTags: NoteTagRow[];
  currentUser: any; db: any; flowsIndex: any[]; setFlowsIndex: (i: any[]) => void; event: any; setView: (v: any) => void;
}) {
  const teamId = team.id;
  const [sharedNotes, setSharedNotes] = useState<SharedNote[]>(initialNotes);
  const [mySharedNote, setMySharedNote] = useState(() => initialNotes.find((n) => n.user_id === currentUser?.id)?.content ?? '');
  const [sharedTags, setSharedTags] = useState<NoteTagRow[]>(initialTags);
  const [pendingTags, setPendingTags] = useState<{ id: string; type: string; name: string }[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<{ fileName: string; base64: string } | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ content: string } | null>(null);
  const { atQuery, setAtQuery, textareaRef, onTextChange, stripTrigger } = useAtMention();

  const doUpsert = useCallback(async (content: string) => {
    if (!currentUser) return;
    const userName = currentUser.displayName || currentUser.email || 'Unknown';
    setSaving(true);
    try {
      await window.warroom.notes.upsert({ teamId, entityType, entityId, entityName, userId: currentUser.id, userName, content });
      setSharedNotes((prev) => {
        const idx = prev.findIndex((n) => n.user_id === currentUser.id);
        const entry: SharedNote = { user_id: currentUser.id, user_name: userName, content, updated_at: new Date().toISOString() };
        if (idx >= 0) { const next = [...prev]; next[idx] = entry; return next; }
        return [...prev, entry];
      });
    } finally { setSaving(false); }
  }, [teamId, currentUser, entityType, entityId, entityName]);

  const doUpsertRef = useRef(doUpsert);
  useEffect(() => { doUpsertRef.current = doUpsert; }, [doUpsert]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (pending.current) void doUpsertRef.current(pending.current.content);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChange(val: string) {
    setMySharedNote(val);
    onTextChange(val);
    pending.current = { content: val };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; pending.current = null; void doUpsert(val); }, 800);
  }

  async function findMatchingTeamFile(fileName: string, base64: string): Promise<string | null> {
    try {
      const res = await window.warroom.teamFiles.getAll(teamId);
      if (!res.ok || !res.data) return null;
      const key = await getTeamKey(teamId, team.invite_code);
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
    if (!currentUser) return;
    const tempId = crypto.randomUUID();
    setPendingTags((prev) => [...prev, { id: tempId, type, name }]);
    try {
      const userName = currentUser.displayName || currentUser.email || 'Unknown';
      const res = await window.warroom.notes.attachTag({ teamId, entityType, entityId, userId: currentUser.id, userName, type, name, data });
      if (res.ok && res.data) setSharedTags((prev) => [...prev, res.data as NoteTagRow]);
      else setTagError(res.error ?? 'Could not save that tag.');
    } finally {
      setPendingTags((prev) => prev.filter((p) => p.id !== tempId));
    }
  }

  /** Resolves the "Also add to Team Files?" prompt for a not-yet-seen local doc. */
  async function confirmAddToTeamFiles(addToFiles: boolean) {
    if (!pendingConfirm || !currentUser) { setPendingConfirm(null); return; }
    const { fileName, base64 } = pendingConfirm;
    setPendingConfirm(null);
    if (!addToFiles) { await attachSharedTag('speechdoc', fileName, { kind: 'bytes', base64, fileName }); return; }
    const tempId = crypto.randomUUID();
    setPendingTags((prev) => [...prev, { id: tempId, type: 'speechdoc', name: fileName }]);
    try {
      const key = await getTeamKey(teamId, team.invite_code);
      const userName = currentUser.displayName || currentUser.email || 'Unknown';
      const [encName, encData] = await Promise.all([encryptText(key, fileName), encryptText(key, base64)]);
      const res = await window.warroom.teamFiles.upload({ teamId, uploaderId: currentUser.id, uploaderName: userName, name: encName, dataB64: encData });
      if (!res.ok || !res.data) { setTagError(res.error ?? 'Could not add to Team Files.'); return; }
      await attachSharedTag('speechdoc', fileName, { kind: 'teamFile', teamFileId: res.data.id });
    } finally {
      setPendingTags((prev) => prev.filter((p) => p.id !== tempId));
    }
  }

  async function buildTagPayload(item: PendingMention): Promise<{ type: NoteTagType; name: string; data: any } | null> {
    if (item.type === 'case') {
      const c = item.data?.case;
      if (c?.ocSource) return { type: 'case', name: item.name, data: { kind: 'url', url: c.ocSource.url, teamName: c.ocSource.teamName, localRefId: item.id } };
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
    if (!currentUser) return;
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
        if (res?.ok && res.path) setView({ kind: 'speech-doc', docPath: res.path });
        else setTagError('Could not open that file.');
        return;
      }
      if (d.kind === 'teamFile' && d.teamFileId) {
        const res = await window.warroom.teamFiles.getAll(teamId);
        const fileRow = res.ok ? res.data?.find((f: any) => f.id === d.teamFileId) : null;
        if (!fileRow) { setTagError('That file is no longer in Team Files.'); return; }
        const key = await getTeamKey(teamId, team.invite_code);
        const base64 = await decryptText(key, fileRow.data_b64);
        const wt = await window.warroom.fs.writeTempFile(base64, row.name);
        if (wt?.ok && wt.path) setView({ kind: 'speech-doc', docPath: wt.path });
        else setTagError('Could not open that file.');
        return;
      }
      setTagError(`${row.name} isn't available on your device yet.`);
      return;
    }
    if (row.type === 'case') {
      if (mine && d.localRefId && db.cases[d.localRefId]) { setView({ kind: 'case', caseId: d.localRefId }); return; }
      if (d.kind === 'url' && d.url) {
        const fetched = await window.warroom.opencaselist.fetchFileToTemp(d.url);
        if (fetched?.ok && fetched.tempPath) setView({ kind: 'speech-doc', docPath: fetched.tempPath });
        else setTagError('Could not fetch that doc — the source link may be gone.');
        return;
      }
      setTagError(`${row.name} isn't available on your device yet.`);
      return;
    }
    if (row.type === 'flow') {
      if (d.localRefId && flowsIndex.some((f: any) => f.id === d.localRefId)) { setView({ kind: 'flow', flowId: d.localRefId }); return; }
      if (d.kind === 'snapshot' && d.flow) {
        const newId = crypto.randomUUID();
        await window.warroom.storage.write(`flow_${newId}`, d.flow);
        const meta = { id: newId, name: d.flow?.name || row.name, event: d.flow?.event || event };
        const newIndex = [...flowsIndex, meta];
        setFlowsIndex(newIndex);
        await window.warroom.storage.write('flows_index', newIndex);
        setView({ kind: 'flow', flowId: newId });
        return;
      }
      setTagError(`${row.name} isn't available on your device yet.`);
      return;
    }
    if (row.type === 'opponent' || row.type === 'judge') {
      if (mine && d.localRefId) {
        setView(row.type === 'opponent' ? { kind: 'opponent', opponentId: d.localRefId } : { kind: 'judge', judgeId: d.localRefId });
        return;
      }
      const stableId = d.entityStableId;
      if (row.type === 'opponent') {
        const match: any = Object.values(db.opponents).find((o: any) => computeOpponentStableId(o) === stableId);
        if (match) { setView({ kind: 'opponent', opponentId: match.id }); return; }
      } else {
        const match: any = Object.values(db.judges ?? {}).find((j: any) => j.personId === stableId);
        if (match) { setView({ kind: 'judge', judgeId: match.id }); return; }
      }
      setView({ kind: 'opponents' });
      return;
    }
  }

  const otherNotes = sharedNotes.filter((n) => n.user_id !== currentUser?.id && n.content.trim());

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink/40 font-medium truncate">{team.name} · {currentUser?.displayName || 'You'}</span>
        {saving && <span className="text-[10px] text-ink/30 shrink-0">Saving…</span>}
      </div>
      <div className="relative">
        <textarea
          ref={textareaRef}
          className="input w-full resize-none text-xs"
          rows={4}
          placeholder={NOTES_PLACEHOLDER}
          value={mySharedNote}
          onChange={(e) => handleChange(e.target.value)}
          style={{ fontFamily: 'inherit' }}
        />
        {atQuery !== null && (
          <MentionPicker
            query={atQuery}
            types={TAG_TYPES}
            onSelect={(item) => { setAtQuery(null); handleAddSharedTag(item); handleChange(stripTrigger(mySharedNote)); }}
            onClose={() => setAtQuery(null)}
          />
        )}
      </div>
      {(sharedTags.some((t) => t.note_user_id === currentUser?.id) || pendingTags.length > 0 || tagError) && (
        <NoteTagBar
          tags={[
            ...sharedTags.filter((t) => t.note_user_id === currentUser?.id).map((t): DisplayTag => ({ id: t.id, type: t.type, name: t.name })),
            ...pendingTags.map((t): DisplayTag => ({ id: t.id, type: t.type, name: t.name, pending: true })),
          ]}
          onRemove={handleRemoveSharedTag}
          onOpen={(tag) => { const row = sharedTags.find((t) => t.id === tag.id); if (row) openTagRow(row); }}
          error={tagError}
        />
      )}
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
      {otherNotes.length > 0 && (
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
                <p className="text-xs text-ink/55 leading-relaxed whitespace-pre-wrap px-1">{n.content}</p>
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
    </div>
  );
}

function SlotToggle({ label, active, onClick, activeBg, activeColor }: {
  label: string; active: boolean; onClick: () => void; activeBg?: string; activeColor?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={active ? `Hide ${label} notes` : `Show ${label} notes`}
      className="text-[11px] font-medium px-2 py-0.5 rounded-full transition shrink-0"
      style={active
        ? { background: activeBg ?? 'var(--bg-card)', color: activeColor ?? 'var(--ink-color)', border: activeBg ? 'none' : '1px solid var(--border-side)' }
        : { background: 'var(--bg-elevated)', color: 'var(--label-color)', border: '1px solid var(--border-subtle)' }}
    >
      {label}
    </button>
  );
}

// ── Orchestrator ─────────────────────────────────────────────────────────────
// Private + one panel per team the user belongs to, shown side by side (2 per
// row) whenever more than one has content. A panel that's auto-opened because
// it has content, or opened manually, stays open for the rest of this app
// session even if its content is later cleared — only an explicit close (or
// restarting the app) hides it again.
export default function SharedNotesEditor({
  entityType, entityId, entityName,
  localNotes, onLocalChange, onLocalSave,
  localTags = [], onLocalTagsChange,
}: Props) {
  const { currentUser, currentTeam, db, flowsIndex, setFlowsIndex, event, setView } = useApp();

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

  // Disambiguate teams that happen to share a name (distinct team rows, not a
  // rendering bug) so they're not indistinguishable in the toggle row.
  function teamLabel(t: ChatTeam): string {
    const dupes = teams.filter((o) => o.name === t.name);
    return dupes.length > 1 ? `${t.name} (${t.invite_code.slice(-4)})` : t.name;
  }

  // One-time probe per team, purely to decide default panel visibility. Once a
  // panel opens, its own TeamPanel instance owns live state from there.
  const [teamProbe, setTeamProbe] = useState<Record<string, { notes: SharedNote[]; tags: NoteTagRow[] }>>({});
  const [probing, setProbing] = useState(false);
  useEffect(() => {
    if (!currentUser || teams.length === 0) { setTeamProbe({}); return; }
    let cancelled = false;
    setProbing(true);
    Promise.all(teams.map(async (t) => {
      const [notesRes, tagsRes] = await Promise.all([
        window.warroom.notes.get({ teamId: t.id, entityType, entityId }),
        window.warroom.notes.getTags({ teamId: t.id, entityType, entityId }),
      ]);
      return [t.id, { notes: notesRes.ok ? (notesRes.data ?? []) : [], tags: tagsRes.ok ? (tagsRes.data ?? []) : [] }] as const;
    })).then((entries) => { if (!cancelled) setTeamProbe(Object.fromEntries(entries)); })
      .finally(() => { if (!cancelled) setProbing(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams.map((t) => t.id).join(','), entityType, entityId, currentUser?.id]);

  // Explicit open/close choices, per entity, kept for the session only.
  const openKey = `notes_open_${entityType}_${entityId}`;
  const [openPrefs, setOpenPrefs] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(sessionStorage.getItem(openKey) ?? '{}'); } catch { return {}; }
  });
  useEffect(() => {
    try { setOpenPrefs(JSON.parse(sessionStorage.getItem(openKey) ?? '{}')); } catch { setOpenPrefs({}); }
  }, [openKey]);

  function setSlotOpen(slotId: string, open: boolean) {
    setOpenPrefs((prev) => {
      const next = { ...prev, [slotId]: open };
      try { sessionStorage.setItem(openKey, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  const privateHasContent = !!localNotes.trim() || localTags.length > 0;
  const isPrivateOpen = openPrefs.private ?? privateHasContent;

  function teamHasContent(teamId: string): boolean {
    const d = teamProbe[teamId];
    if (!d) return false;
    return d.notes.some((n) => n.content.trim()) || d.tags.length > 0;
  }
  const openTeams = teams.filter((t) => openPrefs[t.id] ?? teamHasContent(t.id));
  const openSlotCount = (isPrivateOpen ? 1 : 0) + openTeams.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="label">Notes</span>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <SlotToggle label="Private" active={isPrivateOpen} onClick={() => setSlotOpen('private', !isPrivateOpen)} />
          {teams.map((t) => {
            const open = openPrefs[t.id] ?? teamHasContent(t.id);
            return (
              <SlotToggle
                key={t.id}
                label={teamLabel(t)}
                active={open}
                onClick={() => setSlotOpen(t.id, !open)}
                activeBg="#fef08a"
                activeColor="#854d0e"
              />
            );
          })}
        </div>
      </div>

      {probing && teams.length > 0 && openSlotCount === 0 && (
        <div className="text-xs text-ink/30 italic">Checking team notes…</div>
      )}

      <div className={openSlotCount >= 2 ? 'grid grid-cols-2 gap-3' : 'space-y-3'}>
        {isPrivateOpen && (
          <PrivatePanel
            localNotes={localNotes} onLocalChange={onLocalChange} onLocalSave={onLocalSave}
            localTags={localTags} onLocalTagsChange={onLocalTagsChange}
            db={db} flowsIndex={flowsIndex} setView={setView}
          />
        )}
        {openTeams.map((t) => (
          <TeamPanel
            key={t.id}
            team={t} entityType={entityType} entityId={entityId} entityName={entityName}
            initialNotes={teamProbe[t.id]?.notes ?? []} initialTags={teamProbe[t.id]?.tags ?? []}
            currentUser={currentUser} db={db} flowsIndex={flowsIndex} setFlowsIndex={setFlowsIndex} event={event} setView={setView}
          />
        ))}
      </div>
    </div>
  );
}
