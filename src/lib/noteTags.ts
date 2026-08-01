// Shared helpers for note tags (see SharedNotesEditor.tsx for the primary
// tagging UI). This module powers two read-only consumers: reverse lookup
// ("who has this flow/case/doc tagged?" — FlowView, SpeechDocViewer) and
// forward lookup ("what has this opponent/judge got tagged?" — MissionBrief).
// SharedNotesEditor keeps its own copy of the open/attach logic — this module
// is for new call sites, not a refactor of the (working, tested) original.

import { ChatTeam, DB, NoteTag, NoteTagRow, NoteTagType } from '../types';
import { FlowMeta } from '../store/appStore';
import { getTeamKey, decryptText } from './chatCrypto';

export function computeOpponentStableId(o: any): string {
  return o?.teamId ? String(o.teamId) : `${o?.school ?? ''}/${o?.teamName ?? ''}`.toLowerCase().replace(/\s+/g, '-');
}

// ── Reverse lookup ───────────────────────────────────────────────────────────

export interface TaggedInMatch {
  kind: 'opponent' | 'judge';
  /** Present only if the current user has a matching local record to navigate to. */
  localId?: string;
  name: string;
  /** 'Private' or a team name. */
  source: string;
}

/** Which opponents/judges (private notes + every team's shared notes) have this
 * flow/case/doc tagged? `matchKey`/`matchValue` scope the shared-side search —
 * omit both to skip it entirely (e.g. a bare local file has no portable id). */
export async function findTaggedIn(opts: {
  type: NoteTagType;
  localRefId: string;
  matchKey?: 'localRefId' | 'url' | 'teamFileId';
  matchValue?: string;
  db: DB;
  teams: ChatTeam[];
}): Promise<TaggedInMatch[]> {
  const { type, localRefId, matchKey, matchValue, db, teams } = opts;
  const results: TaggedInMatch[] = [];

  for (const o of Object.values(db.opponents)) {
    if (o.noteTags?.some((t) => t.type === type && t.refId === localRefId)) {
      results.push({ kind: 'opponent', localId: o.id, name: o.teamName, source: 'Private' });
    }
  }
  for (const j of Object.values(db.judges ?? {})) {
    if (j.noteTags?.some((t) => t.type === type && t.refId === localRefId)) {
      results.push({ kind: 'judge', localId: j.id, name: j.name, source: 'Private' });
    }
  }

  if (matchKey && matchValue) {
    await Promise.all(teams.map(async (team) => {
      const res = await window.warroom.notes.findTagsByRef({ teamId: team.id, type, matchKey, matchValue });
      if (!res.ok || !res.data) return;
      for (const row of res.data) {
        if (row.note_entity_type === 'opponent') {
          const local: any = Object.values(db.opponents).find((o: any) => computeOpponentStableId(o) === row.note_entity_id);
          results.push({ kind: 'opponent', localId: local?.id, name: local?.teamName ?? row.note_entity_name ?? 'Unknown opponent', source: team.name });
        } else {
          const local: any = Object.values(db.judges ?? {}).find((j: any) => j.personId === row.note_entity_id);
          results.push({ kind: 'judge', localId: local?.id, name: local?.name ?? row.note_entity_name ?? 'Unknown judge', source: team.name });
        }
      }
    }));
  }

  const seen = new Set<string>();
  return results.filter((r) => {
    const key = `${r.kind}:${r.localId ?? r.name}:${r.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Forward lookup ───────────────────────────────────────────────────────────

export interface ForwardTag {
  id: string;
  type: NoteTagType;
  name: string;
  /** 'Private' or the team's name. */
  source: string;
  isPrivate: boolean;
  localTag?: NoteTag;
  sharedRow?: NoteTagRow;
  /** The team this shared tag came from — needed to decrypt a teamFile-kind doc. */
  team?: ChatTeam;
}

/** Everything tagged on this opponent/judge's notes — private + every team the
 * current user belongs to. Read-only: for surfacing in Mission Brief, not editing. */
export async function fetchAllTagsForEntity(opts: {
  entityType: 'opponent' | 'judge'; entityId: string; localTags: NoteTag[]; teams: ChatTeam[];
}): Promise<ForwardTag[]> {
  const out: ForwardTag[] = opts.localTags.map((t) => ({
    id: `local:${t.id}`, type: t.type, name: t.name, source: 'Private', isPrivate: true, localTag: t,
  }));
  await Promise.all(opts.teams.map(async (team) => {
    const res = await window.warroom.notes.getTags({ teamId: team.id, entityType: opts.entityType, entityId: opts.entityId });
    if (!res.ok || !res.data) return;
    for (const row of res.data) {
      out.push({ id: row.id, type: row.type, name: row.name, source: team.name, isPrivate: false, sharedRow: row, team });
    }
  }));
  return out;
}

export interface OpenTagCtx {
  db: DB;
  flowsIndex: FlowMeta[];
  setFlowsIndex: (i: FlowMeta[]) => void;
  event: string;
  setView: (v: any) => void;
  currentUserId?: string;
}

/** Opens whatever a forward-lookup tag points at. Returns an error message on
 * failure, or null on success (navigation already happened via ctx.setView). */
export async function openForwardTag(tag: ForwardTag, ctx: OpenTagCtx): Promise<string | null> {
  if (tag.isPrivate && tag.localTag) {
    const t = tag.localTag;
    if (t.type === 'speechdoc') { ctx.setView({ kind: 'speech-doc', docPath: t.refId }); return null; }
    if (t.type === 'case') {
      if (ctx.db.cases[t.refId]) { ctx.setView({ kind: 'case', caseId: t.refId }); return null; }
      return `${t.name} no longer exists.`;
    }
    if (t.type === 'flow') {
      if (ctx.flowsIndex.some((f) => f.id === t.refId)) { ctx.setView({ kind: 'flow', flowId: t.refId }); return null; }
      return `${t.name} no longer exists.`;
    }
    if (t.type === 'opponent') {
      if (ctx.db.opponents[t.refId]) { ctx.setView({ kind: 'opponent', opponentId: t.refId }); return null; }
      return `${t.name} no longer exists.`;
    }
    if (t.type === 'judge') {
      if (ctx.db.judges?.[t.refId]) { ctx.setView({ kind: 'judge', judgeId: t.refId }); return null; }
      return `${t.name} no longer exists.`;
    }
    return null;
  }

  const row = tag.sharedRow;
  const team = tag.team;
  if (!row) return 'Nothing to open.';
  const mine = row.note_user_id === ctx.currentUserId;
  const d = row.data ?? {};

  if (row.type === 'speechdoc') {
    if (d.kind === 'bytes' && d.base64) {
      const res = await window.warroom.fs.writeTempFile(d.base64, d.fileName || `${row.name}.docx`);
      if (res?.ok && res.path) { ctx.setView({ kind: 'speech-doc', docPath: res.path }); return null; }
      return 'Could not open that file.';
    }
    if (d.kind === 'teamFile' && d.teamFileId && team) {
      const res = await window.warroom.teamFiles.getAll(team.id);
      const fileRow = res.ok ? res.data?.find((f: any) => f.id === d.teamFileId) : null;
      if (!fileRow) return 'That file is no longer in Team Files.';
      const key = await getTeamKey(team.id, team.invite_code);
      const base64 = await decryptText(key, fileRow.data_b64);
      const wt = await window.warroom.fs.writeTempFile(base64, row.name);
      if (wt?.ok && wt.path) { ctx.setView({ kind: 'speech-doc', docPath: wt.path }); return null; }
      return 'Could not open that file.';
    }
    return `${row.name} isn't available on your device yet.`;
  }
  if (row.type === 'case') {
    if (mine && d.localRefId && ctx.db.cases[d.localRefId]) { ctx.setView({ kind: 'case', caseId: d.localRefId }); return null; }
    if (d.kind === 'url' && d.url) {
      const fetched = await window.warroom.opencaselist.fetchFileToTemp(d.url);
      if (fetched?.ok && fetched.tempPath) { ctx.setView({ kind: 'speech-doc', docPath: fetched.tempPath }); return null; }
      return 'Could not fetch that doc — the source link may be gone.';
    }
    return `${row.name} isn't available on your device yet.`;
  }
  if (row.type === 'flow') {
    if (d.localRefId && ctx.flowsIndex.some((f) => f.id === d.localRefId)) { ctx.setView({ kind: 'flow', flowId: d.localRefId }); return null; }
    if (d.kind === 'snapshot' && d.flow) {
      const newId = crypto.randomUUID();
      await window.warroom.storage.write(`flow_${newId}`, d.flow);
      const meta = { id: newId, name: d.flow?.name || row.name, event: d.flow?.event || ctx.event };
      const newIndex = [...ctx.flowsIndex, meta];
      ctx.setFlowsIndex(newIndex);
      await window.warroom.storage.write('flows_index', newIndex);
      ctx.setView({ kind: 'flow', flowId: newId });
      return null;
    }
    return `${row.name} isn't available on your device yet.`;
  }
  if (row.type === 'opponent' || row.type === 'judge') {
    if (mine && d.localRefId) {
      ctx.setView(row.type === 'opponent' ? { kind: 'opponent', opponentId: d.localRefId } : { kind: 'judge', judgeId: d.localRefId });
      return null;
    }
    const stableId = d.entityStableId;
    if (row.type === 'opponent') {
      const match: any = Object.values(ctx.db.opponents).find((o: any) => computeOpponentStableId(o) === stableId);
      if (match) { ctx.setView({ kind: 'opponent', opponentId: match.id }); return null; }
    } else {
      const match: any = Object.values(ctx.db.judges ?? {}).find((j: any) => j.personId === stableId);
      if (match) { ctx.setView({ kind: 'judge', judgeId: match.id }); return null; }
    }
    ctx.setView({ kind: 'opponents' });
    return null;
  }
  return null;
}
