import React, { useMemo } from 'react';
import { useApp } from '../store/appStore';
import { PendingMention } from '../types';

interface Props {
  query: string;
  onSelect: (item: PendingMention) => void;
  onClose: () => void;
}

export default function MentionPicker({ query, onSelect, onClose }: Props) {
  const { db, flowsIndex, teamMembers, currentUser } = useApp();
  const q = query.toLowerCase();

  // Speech doc recents from localStorage (these are the "cases" shown in the sidebar)
  const speechDocs = useMemo(() => {
    try {
      const raw = localStorage.getItem('warroom-speech-doc-recents');
      if (!raw) return [];
      const recents: { path: string; name: string }[] = JSON.parse(raw);
      return recents
        .filter((r) => !q || r.name.toLowerCase().includes(q))
        .slice(0, 6)
        .map((r) => ({
          type: 'speechdoc' as const,
          id: r.path,
          name: r.name,
          sub: 'Speech Doc',
          data: { filePath: r.path },
        }));
    } catch {
      return [];
    }
  }, [q]);

  const cases = useMemo(() => {
    try {
      return Object.values(db.cases)
        .filter((c) => !q || c.name.toLowerCase().includes(q))
        .slice(0, 6)
        .map((c) => ({
          type: 'case' as const,
          id: c.id,
          name: c.name,
          sub: `Case · ${c.side?.toUpperCase() ?? ''}`,
          data: {
            case: c,
            blocks: Object.fromEntries(
              (c.blocks ?? [])
                .map((id) => {
                  const b = db.blocks[id];
                  if (!b) return null;
                  const cardObjects = (b.cards ?? []).map((cid) => db.cards[cid]).filter(Boolean);
                  return [id, { ...b, cardObjects }];
                })
                .filter((x): x is [string, any] => x !== null)
            ),
          },
        }));
    } catch {
      return [];
    }
  }, [db.cases, db.blocks, db.cards, q]);

  const blocks = useMemo(() =>
    Object.values(db.blocks)
      .filter((b) => !q || b.title.toLowerCase().includes(q))
      .slice(0, 4)
      .map((b) => ({
        type: 'block' as const,
        id: b.id,
        name: b.title,
        sub: `Block · ${b.type}`,
        data: { block: b, cards: b.cards.map((id) => db.cards[id]).filter(Boolean) },
      })),
    [db.blocks, db.cards, q]
  );

  const flows = useMemo(() =>
    flowsIndex
      .filter((f) => !q || f.name.toLowerCase().includes(q))
      .slice(0, 4)
      .map((f) => ({
        type: 'flow' as const,
        id: f.id,
        name: f.name,
        sub: `Flow · ${f.event.toUpperCase()}`,
        data: null,
      })),
    [flowsIndex, q]
  );

  const opponents = useMemo(() =>
    Object.values(db.opponents)
      .filter((o) => !q || o.teamName.toLowerCase().includes(q) || o.school.toLowerCase().includes(q))
      .slice(0, 4)
      .map((o) => ({
        type: 'opponent' as const,
        id: o.id,
        name: o.teamName,
        sub: `Opponent · ${o.school}`,
        data: { opponent: o },
      })),
    [db.opponents, q]
  );

  const tournaments = useMemo(() =>
    Object.values(db.tournaments)
      .filter((t) => !q || t.name.toLowerCase().includes(q))
      .slice(0, 4)
      .map((t) => ({
        type: 'tournament' as const,
        id: t.id,
        name: t.name,
        sub: `Tournament · ${t.date ?? ''}`,
        data: { tournament: t },
      })),
    [db.tournaments, q]
  );

  const members = useMemo(() =>
    teamMembers
      .filter((m) => m.user_id !== currentUser?.id)
      .filter((m) => !q || m.display_name.toLowerCase().includes(q))
      .slice(0, 4)
      .map((m) => ({
        type: 'member' as const,
        id: m.user_id,
        name: m.display_name,
        sub: `Member · ${m.role}`,
        data: { userId: m.user_id, displayName: m.display_name },
      })),
    [teamMembers, currentUser?.id, q]
  );

  const judges = useMemo(() =>
    Object.values(db.judges ?? {})
      .filter((j) => !q || j.name.toLowerCase().includes(q) || j.institution.toLowerCase().includes(q))
      .slice(0, 4)
      .map((j) => ({
        type: 'judge' as const,
        id: j.id,
        name: j.name,
        sub: `Judge · ${j.institution}`,
        data: { judge: j },
      })),
    [db.judges, q]
  );

  const all = [...speechDocs, ...cases, ...blocks, ...flows, ...opponents, ...tournaments, ...members, ...judges];
  if (all.length === 0) return null;

  return (
    <div
      className="absolute bottom-full left-0 right-0 mb-1 rounded-md shadow-lg overflow-hidden z-50 max-h-72 overflow-y-auto"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)' }}
    >
      {members.length > 0 && (
        <Section label="People">
          {members.map((item) => <Item key={item.id} item={item} onSelect={onSelect} />)}
        </Section>
      )}
      {speechDocs.length > 0 && (
        <Section label="Speech Docs">
          {speechDocs.map((item) => <Item key={item.id} item={item} onSelect={onSelect} />)}
        </Section>
      )}
      {cases.length > 0 && (
        <Section label="Cases">
          {cases.map((item) => <Item key={item.id} item={item} onSelect={onSelect} />)}
        </Section>
      )}
      {blocks.length > 0 && (
        <Section label="Blocks">
          {blocks.map((item) => <Item key={item.id} item={item} onSelect={onSelect} />)}
        </Section>
      )}
      {flows.length > 0 && (
        <Section label="Flows">
          {flows.map((item) => <Item key={item.id} item={item} onSelect={onSelect} />)}
        </Section>
      )}
      {opponents.length > 0 && (
        <Section label="Opponents">
          {opponents.map((item) => <Item key={item.id} item={item} onSelect={onSelect} />)}
        </Section>
      )}
      {tournaments.length > 0 && (
        <Section label="Tournaments">
          {tournaments.map((item) => <Item key={item.id} item={item} onSelect={onSelect} />)}
        </Section>
      )}
      {judges.length > 0 && (
        <Section label="Judges">
          {judges.map((item) => <Item key={item.id} item={item} onSelect={onSelect} />)}
        </Section>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-3 py-1 text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'var(--nav-inactive-color)' }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const TYPE_ICONS: Record<string, string> = {
  case: '📁', block: '📄', flow: '⬜', opponent: '🥊', member: '👤', speechdoc: '📝', tournament: '🏆', judge: '👨‍⚖️',
};

function Item({ item, onSelect }: { item: any; onSelect: (i: PendingMention) => void }) {
  return (
    <button
      className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-sm transition"
      style={{ color: 'var(--ink)', background: 'transparent' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      onClick={() => onSelect({ type: item.type, id: item.id, name: item.name, data: item.data })}
    >
      <span className="text-base leading-none shrink-0">{TYPE_ICONS[item.type] ?? '📎'}</span>
      <span className="flex-1 truncate font-medium">{item.name}</span>
      <span className="text-[10px] shrink-0" style={{ color: 'var(--nav-inactive-color)' }}>{item.sub}</span>
    </button>
  );
}
