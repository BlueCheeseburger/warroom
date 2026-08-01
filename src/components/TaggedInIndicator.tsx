import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/appStore';
import { ChatTeam, NoteTagType } from '../types';
import { findTaggedIn, TaggedInMatch } from '../lib/noteTags';

/** Small "Tagged in N" pill for a flow/case/doc toolbar — reverse lookup showing
 * which opponents/judges (private notes + every team's shared notes) have this
 * item tagged. Renders nothing if there are no matches. */
export default function TaggedInIndicator({
  type, localRefId, matchKey, matchValue,
}: {
  type: NoteTagType;
  localRefId: string;
  matchKey?: 'localRefId' | 'url' | 'teamFileId';
  matchValue?: string;
}) {
  const { db, currentUser, currentTeam, setView } = useApp();
  const [matches, setMatches] = useState<TaggedInMatch[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let teams: ChatTeam[] = currentTeam ? [currentTeam] : [];
      if (currentUser) {
        try {
          const res = await window.warroom.chat.getTeams(currentUser.id);
          if (res.ok && res.data?.length) teams = res.data;
        } catch {}
      }
      const found = await findTaggedIn({ type, localRefId, matchKey, matchValue, db, teams });
      if (!cancelled) setMatches(found);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, localRefId, matchKey, matchValue, currentUser?.id]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  if (matches.length === 0) return null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title={`Tagged in ${matches.length} opponent/judge note${matches.length === 1 ? '' : 's'}`}
        className="text-[11px] px-2 py-0.5 rounded-full flex items-center gap-1 transition"
        style={{ background: 'var(--bg-elevated)', color: 'var(--label-color)', border: '1px solid var(--border-subtle)' }}
      >
        🏷 Tagged in {matches.length}
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 rounded-md shadow-lg py-1 overflow-hidden"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)', minWidth: 190, maxWidth: 260 }}
        >
          {matches.map((m, i) => (
            <button
              key={i}
              disabled={!m.localId}
              onClick={() => {
                if (!m.localId) return;
                setOpen(false);
                setView(m.kind === 'opponent' ? { kind: 'opponent', opponentId: m.localId } : { kind: 'judge', judgeId: m.localId } as any);
              }}
              className="w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-2"
              style={{ color: m.localId ? 'var(--ink-color)' : 'var(--nav-inactive-color)', cursor: m.localId ? 'pointer' : 'default', background: 'transparent' }}
              onMouseEnter={(e) => { if (m.localId) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              title={m.localId ? `Open ${m.name}` : `${m.name} — not in your list yet`}
            >
              <span className="truncate">{m.kind === 'judge' ? '👨‍⚖️ ' : '🥊 '}{m.name}</span>
              <span className="text-[10px] shrink-0 opacity-60">{m.source}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
