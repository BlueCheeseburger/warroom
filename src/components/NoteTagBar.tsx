import React, { useEffect, useRef, useState } from 'react';
import MentionPicker from './MentionPicker';
import { PendingMention } from '../types';

const TAG_ICONS: Record<string, string> = {
  case: '📁', flow: '⬜', opponent: '🥊', judge: '👨‍⚖️', speechdoc: '📝',
};

export interface DisplayTag {
  id: string;
  type: string;
  name: string;
  /** Still uploading/reading (e.g. a large local doc being read into memory). */
  pending?: boolean;
  /** Exists but this device/user can't open it (e.g. a teammate's local-only case). */
  unavailable?: boolean;
}

/** Row of tag chips + an inline "+ Tag" picker. Used in opponent/judge notes
 * to attach a speech doc, flow, opponent, or judge — see SharedNotesEditor. */
export default function NoteTagBar({
  tags, onAdd, onOpen, onRemove, readOnly, error,
}: {
  tags: DisplayTag[];
  onAdd?: (item: PendingMention) => void;
  onOpen: (tag: DisplayTag) => void;
  onRemove?: (id: string) => void;
  readOnly?: boolean;
  error?: string | null;
}) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!picking) return;
    function onMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setPicking(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [picking]);

  if (tags.length === 0 && (readOnly || !onAdd)) return null;

  return (
    <div ref={rootRef} className="flex flex-wrap items-center gap-1.5 relative">
      {tags.map((t) => (
        <span key={t.id}
          className="inline-flex items-center gap-1 text-[10px] pl-1.5 pr-1 py-0.5 rounded-full"
          style={{
            background: 'var(--bg-card)',
            color: t.unavailable ? 'var(--nav-inactive-color)' : 'var(--ink-color)',
            border: '1px solid var(--border-side)',
            opacity: t.pending ? 0.6 : 1,
          }}
        >
          <span style={{ fontSize: 10 }}>{TAG_ICONS[t.type] ?? '📎'}</span>
          <button
            className="truncate max-w-[120px]"
            style={{ cursor: t.pending ? 'default' : 'pointer' }}
            disabled={t.pending}
            title={t.pending ? 'Uploading…' : t.unavailable ? `${t.name} — not available on your device yet` : `Open ${t.name}`}
            onClick={() => !t.pending && onOpen(t)}
          >
            {t.pending ? 'Uploading…' : t.name}
          </button>
          {!readOnly && onRemove && !t.pending && (
            <button
              onClick={() => onRemove(t.id)}
              title="Remove tag"
              className="opacity-50 hover:opacity-100 leading-none px-0.5"
            >
              ×
            </button>
          )}
        </span>
      ))}
      {!readOnly && onAdd && (
        <div className="relative">
          <button
            onClick={() => setPicking((v) => !v)}
            title="Tag a speech doc, flow, opponent, or judge"
            className="text-[10px] px-1.5 py-0.5 rounded-full transition"
            style={{ background: 'transparent', color: 'var(--nav-inactive-color)', border: '1px dashed var(--border-subtle)' }}
          >
            + Tag
          </button>
          {picking && (
            <div className="absolute left-0 top-full mt-1 z-50" style={{ width: 260 }}>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search to tag…"
                className="input w-full text-xs mb-1"
              />
              <div className="relative">
                <MentionPicker
                  query={query}
                  onSelect={(item) => { setPicking(false); setQuery(''); onAdd(item); }}
                  onClose={() => setPicking(false)}
                />
              </div>
            </div>
          )}
        </div>
      )}
      {error && <span className="text-[10px] text-danger">{error}</span>}
    </div>
  );
}
