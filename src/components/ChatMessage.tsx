import React from 'react';
import { ChatMessage as ChatMessageType } from '../types';
import { useApp } from '../store/appStore';
import type { FlowMeta } from '../store/appStore';

interface Props {
  message: ChatMessageType;
  isSelf: boolean;
  onEdit: (id: string, currentContent: string) => void;
  onDelete: (id: string) => void;
}

export default function ChatMessage({ message, isSelf, onEdit, onDelete }: Props) {
  const { setView, update, flowsIndex, setFlowsIndex } = useApp();
  const [hovered, setHovered] = React.useState(false);
  const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const hasAttachments = message.attachments && message.attachments.length > 0;

  return (
    <div
      className={`flex flex-col gap-1 ${isSelf ? 'items-end' : 'items-start'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Sender name (others only) */}
      {!isSelf && (
        <span className="text-[11px] font-semibold px-0.5" style={{ color: 'var(--nav-active-color)' }}>
          {message.sender_name}
        </span>
      )}

      {/* Bubble */}
      <div
        className="w-fit max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed"
        style={isSelf
          ? { background: '#0077ed', color: '#ffffff', overflowWrap: 'break-word', wordBreak: 'break-word' }
          : { background: 'var(--bg-card)', color: 'var(--ink)', border: '1px solid var(--border-side)', overflowWrap: 'break-word', wordBreak: 'break-word' }}
      >
        <MessageText content={message.content} />
      </div>

      {/* Round reference pill */}
      {message.round_ref_id && message.round_ref_label && (
        <button
          className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1 transition"
          style={{ background: 'var(--bg-card)', color: 'var(--nav-active-color)', border: '1px solid var(--border-side)' }}
          onClick={() => setView({ kind: 'round', roundId: message.round_ref_id! })}
        >
          <RoundIcon />
          {message.round_ref_label}
        </button>
      )}

      {/* Attachment chips */}
      {hasAttachments && (
        <div className="flex flex-wrap gap-1.5 max-w-[85%]">
          {message.attachments!.map((att) =>
            att.type === 'image'
              ? <ImageAttachment key={att.id} attachment={att} />
              : <AttachmentChip key={att.id} attachment={att} isSelf={isSelf}
                  onImportFlow={async (a) => {
                    // A live flow shares a pointer — open the *same* flow id and
                    // mark it live so this device joins the realtime session,
                    // instead of importing a frozen copy under a new id.
                    if (a.data?.live && a.data?.flowId) {
                      const id = a.data.flowId as string;
                      const meta: FlowMeta = { id, name: a.name, event: a.data?.event ?? 'policy', live: true, teamId: a.data?.teamId };
                      const exists = flowsIndex.some((f) => f.id === id);
                      const next = exists ? flowsIndex.map((f) => (f.id === id ? { ...f, ...meta } : f)) : [...flowsIndex, meta];
                      setFlowsIndex(next);
                      await window.warroom.storage.write('flows_index', next);
                      if (!exists) await window.warroom.storage.write(`flow_data_${id}`, a.data ?? {});
                      setView({ kind: 'flow', flowId: id });
                      return;
                    }
                    const newId = crypto.randomUUID();
                    const meta: FlowMeta = { id: newId, name: a.name, event: a.data?.event ?? 'policy' };
                    const next = [...flowsIndex, meta];
                    setFlowsIndex(next);
                    await window.warroom.storage.write('flows_index', next);
                    await window.warroom.storage.write(`flow_data_${newId}`, a.data ?? {});
                    setView({ kind: 'flow', flowId: newId });
                  }}
                  onImportCase={async (a) => {
                    if (!a.data?.case) return;
                    const newCaseId = crypto.randomUUID();
                    const blocks: Record<string, any> = {};
                    Object.values((a.data.blocks ?? {}) as any).forEach((b: any) => {
                      blocks[b.id] = { ...b, caseId: newCaseId };
                    });
                    await update((db) => ({
                      ...db,
                      cases: { ...db.cases, [newCaseId]: { ...a.data.case, id: newCaseId, name: `${a.data.case.name} (shared)` } },
                      blocks: { ...db.blocks, ...blocks },
                    }));
                    setView({ kind: 'case', caseId: newCaseId });
                  }}
                  onImportOpponent={async (a) => {
                    if (!a.data?.opponent) return;
                    const newId = crypto.randomUUID();
                    await update((db) => ({
                      ...db,
                      opponents: { ...db.opponents, [newId]: { ...a.data.opponent, id: newId } },
                    }));
                  }}
                  onImportTournament={async (a) => {
                    if (!a.data?.tournament) return;
                    const newId = crypto.randomUUID();
                    await update((db) => ({
                      ...db,
                      tournaments: { ...db.tournaments, [newId]: { ...a.data.tournament, id: newId, name: `${a.data.tournament.name} (shared)` } },
                    }));
                    setView({ kind: 'tournament', tournamentId: newId });
                  }}
                />
          )}
        </div>
      )}

      {/* Footer: edit/delete (own) + timestamp — buttons always in DOM to prevent layout shift */}
      <div className={`flex items-center h-5 gap-1 px-0.5 ${isSelf ? 'justify-end' : 'justify-start'}`}>
        {isSelf && (
          <>
            <button
              onClick={() => onEdit(message.id, message.content)}
              title="Edit"
              className="w-5 h-5 flex items-center justify-center rounded transition"
              style={{
                color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none',
                cursor: hovered ? 'pointer' : 'default',
                opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ink)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--nav-inactive-color)'; }}
            ><PencilIcon /></button>
            <button
              onClick={() => onDelete(message.id)}
              title="Delete"
              className="w-5 h-5 flex items-center justify-center rounded transition"
              style={{
                color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none',
                cursor: hovered ? 'pointer' : 'default',
                opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#ef4444'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--nav-inactive-color)'; }}
            ><TrashIcon /></button>
          </>
        )}
        <span className="text-[10px]" style={{ color: 'var(--nav-inactive-color)' }}>{time}</span>
        {(message as any).edited && (
          <span className="text-[9px]" style={{ color: 'var(--nav-inactive-color)' }}>(edited)</span>
        )}
      </div>
    </div>
  );
}

function MessageText({ content }: { content: string }) {
  // Render @mentions in bold
  const parts = content.split(/(@\S+)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('@') ? (
          <strong key={i}>{part}</strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function ImageAttachment({ attachment }: { attachment: any }) {
  const [lightbox, setLightbox] = React.useState(false);
  const src = attachment.data?.src;
  if (!src) return null;
  return (
    <>
      <img
        src={src}
        alt={attachment.name}
        className="rounded-xl cursor-pointer object-cover max-h-64"
        style={{ maxWidth: '100%', border: '1px solid var(--border-side)' }}
        onClick={() => setLightbox(true)}
        title="Click to view full size"
      />
      {lightbox && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.85)' }}
          onClick={() => setLightbox(false)}
        >
          <img src={src} alt={attachment.name} className="max-w-[90vw] max-h-[90vh] rounded-xl object-contain" />
        </div>
      )}
    </>
  );
}

const TYPE_ICONS: Record<string, string> = {
  flow: '⬜', case: '📁', block: '📄', opponent: '🥊', member: '👤', speechdoc: '📝', tournament: '🏆',
};
const TYPE_COLORS: Record<string, string> = {
  flow: '#7c3aed', case: '#0077ed', block: '#059669', speechdoc: '#d97706', opponent: '#dc2626', tournament: '#b45309',
};

export function AttachmentChip({ attachment, isSelf, onImportFlow, onImportCase, onImportOpponent, onImportTournament }: {
  attachment: any;
  isSelf: boolean;
  onImportFlow: (a: any) => void;
  onImportCase: (a: any) => void;
  onImportOpponent: (a: any) => void;
  onImportTournament: (a: any) => void;
}) {
  const { setView } = useApp();
  const [expanded, setExpanded] = React.useState(false);
  const [imported, setImported] = React.useState(false);
  const icon = TYPE_ICONS[attachment.type] ?? '📎';
  const accent = TYPE_COLORS[attachment.type] ?? '#6b7280';
  const canImport = !isSelf && (
    attachment.type === 'flow' || attachment.type === 'case' ||
    attachment.type === 'opponent' || attachment.type === 'tournament'
  );

  // Build a preview for every type that has data
  function renderPreview(): React.ReactNode | null {
    const d = attachment.data;
    if (!d) return null;

    if (attachment.type === 'case') {
      const c = d.case;
      const blocks: any[] = Object.values(d.blocks ?? {});
      if (!c && blocks.length === 0) return null;
      return (
        <div className="space-y-1">
          {c && <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: accent }}>{c.side?.toUpperCase() ?? '?'} case</div>}
          {blocks.slice(0, 6).map((b: any) => (
            <div key={b.id} className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--ink)' }}>
              <span style={{ opacity: 0.4 }}>—</span>
              <span className="truncate">{b.title}</span>
              <span style={{ opacity: 0.4, flexShrink: 0 }}>({(b.cards ?? []).length})</span>
            </div>
          ))}
          {blocks.length > 6 && <div className="text-[10px]" style={{ opacity: 0.4 }}>+{blocks.length - 6} more blocks</div>}
        </div>
      );
    }

    if (attachment.type === 'block') {
      const cards: any[] = d.cards ?? [];
      if (cards.length === 0) return null;
      return (
        <div className="space-y-1">
          {cards.slice(0, 5).map((card: any) => (
            <div key={card.id} className="text-[10px]" style={{ color: 'var(--ink)' }}>
              <span className="font-semibold">{card.tag}</span>
              {card.cite && <span style={{ opacity: 0.5 }}> — {card.cite}</span>}
            </div>
          ))}
          {cards.length > 5 && <div className="text-[10px]" style={{ opacity: 0.4 }}>+{cards.length - 5} more cards</div>}
        </div>
      );
    }

    if (attachment.type === 'opponent') {
      const o = d.opponent ?? d;
      return (
        <div className="space-y-1 text-[10px]" style={{ color: 'var(--ink)' }}>
          {o.school && <div style={{ opacity: 0.7 }}>{o.school}</div>}
          {o.notes && <div style={{ opacity: 0.6 }} className="line-clamp-3 whitespace-pre-wrap">{o.notes.slice(0, 200)}</div>}
          {!o.school && !o.notes && <div style={{ opacity: 0.4 }}>No notes yet</div>}
        </div>
      );
    }

    if (attachment.type === 'tournament') {
      const t = d.tournament ?? d;
      return (
        <div className="space-y-0.5 text-[10px]" style={{ color: 'var(--ink)' }}>
          {(t.start || t.end) && <div style={{ opacity: 0.7 }}>{[t.start, t.end].filter(Boolean).join(' – ')}</div>}
          {t.location && <div style={{ opacity: 0.7 }}>{t.location}</div>}
          {t.event_type && <div style={{ opacity: 0.5 }} className="capitalize">{t.event_type}</div>}
        </div>
      );
    }

    if (attachment.type === 'speechdoc') {
      const text = d.full || d.tokenSaving;
      if (!text) return null;
      return (
        <div className="text-[10px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--ink)', opacity: 0.7 }}>
          {text.slice(0, 1800)}
          {text.length > 1800 && <span style={{ opacity: 0.5 }}> …(truncated)</span>}
        </div>
      );
    }

    if (attachment.type === 'flow') {
      return <div className="text-[10px]" style={{ color: 'var(--ink)', opacity: 0.5 }}>Spreadsheet flow — import to open in app</div>;
    }

    return null;
  }

  const preview = renderPreview();
  const hasPreview = preview !== null;

  function handleImport() {
    if (attachment.type === 'flow') onImportFlow(attachment);
    else if (attachment.type === 'case') onImportCase(attachment);
    else if (attachment.type === 'opponent') onImportOpponent(attachment);
    else if (attachment.type === 'tournament') onImportTournament(attachment);
    setImported(true);
  }

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: `${accent}15`, border: `1px solid ${accent}40`, maxWidth: 252, minWidth: 160 }}
    >
      <style>{`
        @keyframes add-pulse {
          0%, 100% { box-shadow: 0 0 0 0 ${accent}55; }
          50%       { box-shadow: 0 0 0 3px ${accent}00; }
        }
      `}</style>

      {/* Header row */}
      <div
        className="flex items-center gap-1.5 px-2 py-1.5"
        style={{ cursor: hasPreview ? 'pointer' : 'default' }}
        onClick={() => hasPreview && setExpanded((v) => !v)}
      >
        <span className="text-[12px] leading-none shrink-0">{icon}</span>
        <span className="truncate flex-1 text-[11px] font-semibold leading-tight" style={{ color: 'var(--ink)' }}>
          {attachment.name}
        </span>
        {hasPreview && (
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            style={{ flexShrink: 0, opacity: 0.35, transform: expanded ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s', color: 'var(--ink)' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
        {/* Prominent always-visible + button */}
        {canImport && (
          <button
            onClick={(e) => { e.stopPropagation(); if (!imported) handleImport(); }}
            disabled={imported}
            title={imported ? 'Added to your library' : 'Add to your library'}
            style={{
              flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', gap: 2,
              background: imported ? `${accent}20` : accent,
              color: imported ? accent : '#fff',
              border: 'none',
              borderRadius: 5,
              fontSize: 9,
              fontWeight: 700,
              padding: '3px 7px',
              cursor: imported ? 'default' : 'pointer',
              animation: imported ? 'none' : `add-pulse 2s ease-in-out infinite`,
              transition: 'background 0.2s',
            }}
          >
            {imported
              ? <><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Added</>
              : <><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add</>
            }
          </button>
        )}
      </div>

      {/* Expanded preview */}
      {expanded && hasPreview && (
        <div
          className="px-2 pb-2 pt-1.5 max-h-52 overflow-y-auto scroll-thin"
          style={{ borderTop: `1px solid ${accent}25` }}
        >
          {preview}
          {/* Open-in-app shortcut for speech docs */}
          {attachment.type === 'speechdoc' && attachment.data?.filePath && (
            <button
              className="mt-2 text-[10px] font-semibold px-2 py-1 rounded"
              style={{ background: `${accent}20`, color: accent, border: 'none', cursor: 'pointer' }}
              onClick={() => setView({ kind: 'speech-doc', docPath: attachment.data.filePath })}
            >
              Open in Speech Doc Viewer →
            </button>
          )}
        </div>
      )}
    </div>
  );
}


function RoundIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
