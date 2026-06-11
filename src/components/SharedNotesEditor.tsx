import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../store/appStore';
import { SharedNote, ChatTeam } from '../types';

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
}

const PREF_KEY_PREFIX = 'notes_vis_';

export default function SharedNotesEditor({
  entityType, entityId, entityName,
  localNotes, onLocalChange, onLocalSave,
}: Props) {
  const { currentUser, currentTeam } = useApp();

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
        <div className="space-y-1">
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
        </div>
      ) : (
        <textarea
          className="input w-full resize-none text-xs"
          rows={4}
          placeholder="Add your notes…"
          value={localNotes}
          onChange={(e) => handleLocalChange(e.target.value)}
          style={{ fontFamily: 'inherit' }}
        />
      )}

      {/* Teammates' notes, each behind a labeled divider */}
      {isShared && !loading && otherNotes.length > 0 && (
        <div className="space-y-3 pt-1">
          {otherNotes.map((n) => (
            <div key={n.user_id}>
              <div className="flex items-center gap-2 mb-1.5">
                <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                <span className="text-xs text-ink/40 font-medium shrink-0">{n.user_name}</span>
                <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
              </div>
              <p className="text-xs text-ink/55 leading-relaxed whitespace-pre-wrap px-1">
                {n.content}
              </p>
            </div>
          ))}
        </div>
      )}

      {isShared && loading && (
        <div className="text-xs text-ink/30 italic">Loading team notes…</div>
      )}
    </div>
  );
}
