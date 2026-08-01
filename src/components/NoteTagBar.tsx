import React from 'react';

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
  /** Shown to the TAGGER themself (not a viewer) — e.g. "won't be reachable by teammates". */
  warning?: string;
}

/** Read-only-capable row of tag chips. Tags are added by typing @ in the note
 * textarea (see SharedNotesEditor) — this just displays/opens/removes them. */
export default function NoteTagBar({
  tags, onOpen, onRemove, readOnly, error,
}: {
  tags: DisplayTag[];
  onOpen: (tag: DisplayTag) => void;
  onRemove?: (id: string) => void;
  readOnly?: boolean;
  error?: string | null;
}) {
  if (tags.length === 0 && !error) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span key={t.id}
          className="inline-flex items-center gap-1 text-[10px] pl-1.5 pr-1 py-0.5 rounded-full"
          style={{
            background: 'var(--bg-card)',
            color: t.unavailable ? 'var(--nav-inactive-color)' : 'var(--ink-color)',
            border: t.warning ? '1px solid #d97706' : '1px solid var(--border-side)',
            opacity: t.pending ? 0.6 : 1,
          }}
        >
          <span style={{ fontSize: 10 }}>{t.warning ? '⚠️' : TAG_ICONS[t.type] ?? '📎'}</span>
          <button
            className="truncate max-w-[120px]"
            style={{ cursor: t.pending ? 'default' : 'pointer' }}
            disabled={t.pending}
            title={t.pending ? 'Uploading…' : t.warning ? t.warning : t.unavailable ? `${t.name} — not available on your device yet` : `Open ${t.name}`}
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
      {error && <span className="text-[10px] text-danger">{error}</span>}
    </div>
  );
}
