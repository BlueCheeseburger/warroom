import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useApp, View } from '../store/appStore';
import { SearchEntry, buildCheapIndex, buildChatIndex, buildFlowCellIndex, buildSpeechDocIndex, buildTopicsIndex, refreshSpeechDocKeywords, search } from '../lib/searchIndex';

const GROUP_ORDER: SearchEntry['type'][] = ['case', 'speechdoc', 'flow', 'opponent', 'judge', 'tournament', 'topic', 'chat'];
const GROUP_LABELS: Record<SearchEntry['type'], string> = {
  case: 'Cases',
  speechdoc: 'Speech Docs',
  flow: 'Flows',
  opponent: 'Opponents',
  judge: 'Judges',
  tournament: 'Tournaments',
  topic: 'Topics',
  chat: 'AI Chats',
};
const TYPE_ICON: Record<SearchEntry['type'], string> = {
  case: '📁',
  speechdoc: '📄',
  flow: '🗂',
  opponent: '👥',
  judge: '⚖️',
  tournament: '🏆',
  topic: '📌',
  chat: '💬',
};
const MAX_PER_GROUP = 4;

export default function SearchPalette() {
  const { db, flowsIndex, setView, searchOpen, setSearchOpen, setPendingSearchQuery, setPendingFindQuery, setPendingDisclosureQuery } = useApp();

  const [query, setQuery] = useState('');
  const [allEntries, setAllEntries] = useState<SearchEntry[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedItemRef = useRef<HTMLDivElement>(null);

  // Build index when palette opens
  useEffect(() => {
    if (!searchOpen) {
      setQuery('');
      setSelectedIdx(0);
      return;
    }
    // Focus input
    setTimeout(() => inputRef.current?.focus(), 10);

    // Build cheap index synchronously (cases, opponents, judges, flows,
    // tournaments) + speech docs + AI chats (all from localStorage / DB).
    const cheap = buildCheapIndex(db, flowsIndex);
    const speechEntries = buildSpeechDocIndex();
    const chatEntries = buildChatIndex();
    setAllEntries([...cheap, ...speechEntries, ...chatEntries]);

    // Build async sources: flow cells (storage) + topics (IPC)
    const aborted = { current: false };
    (async () => {
      const cellEntries: SearchEntry[] = [];
      for (const flow of flowsIndex) {
        if (aborted.current) break;
        try {
          const entry = await buildFlowCellIndex(flow.id, flow.name, flow.event);
          if (entry) cellEntries.push(entry);
        } catch {}
      }
      const topicEntries = await buildTopicsIndex().catch(() => []);
      // Self-heal: distill keywords for any speech doc not cached yet (handles
      // docs added since launch / first run before the startup pass finished).
      const docsChanged = await refreshSpeechDocKeywords().catch(() => false);
      const freshSpeechEntries = docsChanged ? buildSpeechDocIndex() : null;
      if (!aborted.current) {
        setAllEntries(prev => {
          // Replace cheap flow entries with full-cell ones, add topics, and
          // refresh speech-doc entries if their keywords just changed.
          let base = prev.filter(e => e.type !== 'flow' && e.type !== 'topic');
          if (freshSpeechEntries) {
            base = base.filter(e => e.type !== 'speechdoc').concat(freshSpeechEntries);
          }
          return [...base, ...cellEntries, ...topicEntries];
        });
      }
    })();

    return () => { aborted.current = true; };
  }, [searchOpen, db, flowsIndex]);

  // Auto-scroll selected into view
  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  function close() {
    setSearchOpen(false);
    setQuery('');
    setSelectedIdx(0);
  }

  const filtered = query.trim() ? search(allEntries, query) : allEntries;

  // Group results
  const grouped: Record<SearchEntry['type'], SearchEntry[]> = {} as any;
  for (const type of GROUP_ORDER) grouped[type] = [];
  for (const entry of filtered) {
    if (grouped[entry.type] && grouped[entry.type].length < MAX_PER_GROUP) {
      grouped[entry.type].push(entry);
    }
  }

  // Flat list for keyboard nav
  const flatResults: SearchEntry[] = [];
  for (const type of GROUP_ORDER) flatResults.push(...grouped[type]);

  function openEntry(entry: SearchEntry) {
    const q = query.trim();
    if (q) {
      // Hand the matched term to the destination so it can highlight/jump to it.
      if (entry.type === 'case' || entry.type === 'speechdoc') setPendingFindQuery(q);
      else if (entry.type === 'opponent') setPendingDisclosureQuery(q);
    }
    setView(entry.view);
    close();
  }

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, flatResults.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      if (flatResults[selectedIdx]) openEntry(flatResults[selectedIdx]);
      return;
    }
  }, [flatResults, selectedIdx]);

  // Reset selected when results change
  useEffect(() => { setSelectedIdx(0); }, [query]);

  if (!searchOpen) return null;

  const hasResults = flatResults.length > 0;
  const showNoResults = query.trim() && !hasResults;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={close}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.45)',
          zIndex: 9998,
        }}
      />

      {/* Palette card */}
      <div
        style={{
          position: 'fixed',
          top: 120,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100%',
          maxWidth: 620,
          maxHeight: 540,
          zIndex: 9999,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-med)',
          borderRadius: 12,
          boxShadow: '0 8px 40px rgba(0,0,0,0.28)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 14px',
            height: 48,
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none"
            stroke="var(--ink-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0 }}>
            <circle cx="8.5" cy="8.5" r="5"/>
            <path d="M12.5 12.5L17 17"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search cases, flows, opponents..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 14,
              color: 'var(--ink)',
              fontFamily: 'inherit',
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--ink-muted)',
                padding: 2,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M2 2l10 10M12 2L2 12"/>
              </svg>
            </button>
          )}
        </div>

        {/* Results area */}
        <div
          ref={listRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            minHeight: 0,
          }}
        >
          {showNoResults && (
            <div style={{
              padding: '20px 16px',
              fontSize: 13,
              color: 'var(--ink-muted)',
              textAlign: 'center',
            }}>
              No results for &ldquo;{query}&rdquo;
            </div>
          )}

          {hasResults && (() => {
            let globalIdx = 0;
            return GROUP_ORDER.map(type => {
              const entries = grouped[type];
              if (!entries.length) return null;
              const groupStartIdx = globalIdx;
              globalIdx += entries.length;
              return (
                <div key={type}>
                  {/* Section header */}
                  <div style={{
                    fontSize: 9,
                    textTransform: 'uppercase',
                    letterSpacing: '0.2em',
                    fontWeight: 700,
                    color: 'var(--placeholder)',
                    padding: '6px 12px',
                  }}>
                    {GROUP_LABELS[type]}
                  </div>
                  {entries.map((entry, i) => {
                    const idx = groupStartIdx + i;
                    const isSelected = idx === selectedIdx;
                    return (
                      <ResultRow
                        key={entry.id}
                        entry={entry}
                        isSelected={isSelected}
                        ref={isSelected ? selectedItemRef : undefined}
                        onClick={() => openEntry(entry)}
                        onMouseEnter={() => setSelectedIdx(idx)}
                      />
                    );
                  })}
                </div>
              );
            });
          })()}
        </div>

        {/* External search footer */}
        <div
          style={{
            borderTop: '1px solid var(--border-subtle)',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--ink-muted)', marginRight: 2 }}>Search in:</span>
          <ExternalButton
            label={`Logos${query ? ` "${query}"` : ''}`}
            onClick={() => {
              setView({ kind: 'logos' });
              if (query) setPendingSearchQuery(query);
              close();
            }}
          />
          <ExternalButton
            label={`Google Scholar${query ? ` "${query}"` : ''}`}
            onClick={() => {
              setView({ kind: 'google-scholar' });
              if (query) setPendingSearchQuery(query);
              close();
            }}
          />
          <ExternalButton
            label={`Open Evidence${query ? ` "${query}"` : ''}`}
            onClick={() => {
              setView({ kind: 'open-ev' });
              if (query) setPendingSearchQuery(query);
              close();
            }}
          />
        </div>
      </div>
    </>
  );
}

// ── Result row ────────────────────────────────────────────────────────────────

const ResultRow = React.forwardRef<HTMLDivElement, {
  entry: SearchEntry;
  isSelected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}>(function ResultRow({ entry, isSelected, onClick, onMouseEnter }, ref) {
  return (
    <div
      ref={ref}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      style={{
        height: 38,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 12px',
        cursor: 'pointer',
        background: isSelected ? 'var(--nav-active-bg)' : 'transparent',
        color: isSelected ? 'var(--nav-active-color)' : 'var(--ink)',
      }}
    >
      <span style={{ fontSize: 14, flexShrink: 0 }}>{TYPE_ICON[entry.type]}</span>
      <span style={{
        fontSize: 13,
        fontWeight: 500,
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: isSelected ? 'var(--nav-active-color)' : 'var(--ink)',
      }}>
        {entry.title}
      </span>
      {entry.subtitle && (
        <span style={{
          fontSize: 11,
          color: isSelected ? 'var(--nav-active-color)' : 'var(--placeholder)',
          flexShrink: 0,
          marginLeft: 'auto',
          opacity: isSelected ? 0.85 : 1,
        }}>
          {entry.subtitle}
        </span>
      )}
    </div>
  );
});

// ── External search button ────────────────────────────────────────────────────

function ExternalButton({ label, onClick }: { label: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        fontSize: 11,
        padding: '3px 8px',
        borderRadius: 6,
        border: '1px solid var(--border-subtle)',
        background: hovered ? 'var(--nav-hover-bg)' : 'transparent',
        color: hovered ? 'var(--ink)' : 'var(--ink-muted)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'background 0.1s, color 0.1s',
      }}
    >
      {label}
    </button>
  );
}
