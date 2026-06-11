import React, { useEffect, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { useApp } from '../store/appStore';

type TabType = 'policy' | 'pf' | 'ld';

interface StoredTopics {
  policy: {
    current: string;
    next: string | null;
    season: string;
    lastChecked: string;
  };
  pf: {
    current: string;
    period: string;
    potentialNext: string[] | null;
    lastChecked: string;
    brief: string | null;
    briefGeneratedAt: string | null;
  };
  ld: {
    current: string;
    period: string;
    potentialNext: string[] | null;
    lastChecked: string;
    brief: string | null;
    briefGeneratedAt: string | null;
  };
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TopicsScreen() {
  const { view, setView } = useApp();
  const initialTab: TabType = (view as any).tab ?? 'policy';
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [topics, setTopics] = useState<StoredTopics | null>(null);
  const [nextDates, setNextDates] = useState<{ pf: string | null; ld: string | null }>({ pf: null, ld: null });
  const [refreshing, setRefreshing] = useState(false);
  const [generatingBrief, setGeneratingBrief] = useState<'pf' | 'ld' | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);

  const loadTopics = useCallback(async () => {
    const stored = await window.warroom?.topics?.getStored?.();
    if (stored) setTopics(stored);
    const dates = await window.warroom?.topics?.getNextReleaseDates?.();
    if (dates) setNextDates(dates);
    const key = await window.warroom?.secure?.get('gemini');
    setHasApiKey(!!key);
  }, []);

  useEffect(() => { loadTopics(); }, [loadTopics]);

  // Update tab when view changes (e.g. from notification click)
  useEffect(() => {
    const tab = (view as any).tab;
    if (tab) setActiveTab(tab);
  }, [view]);

  // Listen for topics updates from main process
  useEffect(() => {
    const unsub = window.warroom?.topics?.onUpdated?.(() => loadTopics());
    return () => unsub?.();
  }, [loadTopics]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const scraped = await window.warroom?.topics?.scrape?.();
      if (scraped && !scraped.error) {
        const current = await window.warroom?.topics?.getStored?.();
        await window.warroom?.topics?.save?.({
          policy: { ...scraped.policy, lastChecked: new Date().toISOString() },
          pf: {
            ...scraped.pf,
            lastChecked: new Date().toISOString(),
            brief: current?.pf?.brief ?? null,
            briefGeneratedAt: current?.pf?.briefGeneratedAt ?? null,
          },
          ld: {
            ...scraped.ld,
            lastChecked: new Date().toISOString(),
            brief: current?.ld?.brief ?? null,
            briefGeneratedAt: current?.ld?.briefGeneratedAt ?? null,
          },
        });
        await loadTopics();
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function handleGenerateBrief(eventType: 'pf' | 'ld') {
    if (!topics) return;
    const resolution = eventType === 'pf' ? topics.pf.current : topics.ld.current;
    setGeneratingBrief(eventType);
    try {
      await window.warroom?.topics?.generateBrief?.({ eventType, resolution });
      await loadTopics();
    } finally {
      setGeneratingBrief(null);
    }
  }

  function switchTab(tab: TabType) {
    setActiveTab(tab);
    setView({ kind: 'topics', tab });
  }

  const tabs: { id: TabType; label: string }[] = [
    { id: 'policy', label: 'Policy' },
    { id: 'pf', label: 'Public Forum' },
    { id: 'ld', label: 'Lincoln-Douglas' },
  ];

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: 'var(--bg-main)' }}>
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b" style={{ borderColor: 'var(--border-side)' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--ink)' }}>NSDA Topics</h1>
            {topics?.policy.lastChecked && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--placeholder)' }}>
                Last checked {relativeTime(topics.policy.lastChecked)}
              </p>
            )}
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-med)',
              color: 'var(--ink)',
              cursor: refreshing ? 'wait' : 'pointer',
              opacity: refreshing ? 0.6 : 1,
            }}
          >
            {refreshing ? (
              <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="8 14" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.5 2.5A4.5 4.5 0 1 1 7 1.1"/>
                <path d="M10.5 1v1.5H9"/>
              </svg>
            )}
            {refreshing ? 'Checking…' : 'Refresh'}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold transition"
              style={{
                background: activeTab === tab.id ? 'var(--nav-active-bg)' : 'transparent',
                color: activeTab === tab.id ? 'var(--nav-active-color)' : 'var(--nav-inactive-color)',
                boxShadow: activeTab === tab.id ? 'var(--nav-active-shadow)' : 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 py-5 space-y-4 max-w-3xl">
        {!topics ? (
          <div className="text-sm" style={{ color: 'var(--placeholder)' }}>
            No topic data yet. Click Refresh to fetch current topics.
          </div>
        ) : (
          <>
            {activeTab === 'policy' && (
              <PolicyTab topics={topics} />
            )}
            {(activeTab === 'pf' || activeTab === 'ld') && (
              <PFLDTab
                eventType={activeTab}
                topics={topics}
                nextDates={nextDates}
                hasApiKey={hasApiKey}
                generatingBrief={generatingBrief}
                onGenerateBrief={handleGenerateBrief}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PolicyTab({ topics }: { topics: StoredTopics }) {
  return (
    <>
      {/* Current season */}
      <TopicCard
        label={`${topics.policy.season} Topic`}
        resolution={topics.policy.current}
        lastChecked={topics.policy.lastChecked}
      />

      {/* Next season if available */}
      {topics.policy.next && (
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-med)' }}>
          <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--placeholder)' }}>
            Next Season Topic (Announced)
          </div>
          <p className="text-sm leading-relaxed font-medium" style={{ color: 'var(--ink)' }}>
            {topics.policy.next}
          </p>
        </div>
      )}
    </>
  );
}

function PFLDTab({
  eventType, topics, nextDates, hasApiKey, generatingBrief, onGenerateBrief,
}: {
  eventType: 'pf' | 'ld';
  topics: StoredTopics;
  nextDates: { pf: string | null; ld: string | null };
  hasApiKey: boolean;
  generatingBrief: 'pf' | 'ld' | null;
  onGenerateBrief: (et: 'pf' | 'ld') => void;
}) {
  const data = eventType === 'pf' ? topics.pf : topics.ld;
  const nextDate = eventType === 'pf' ? nextDates.pf : nextDates.ld;

  return (
    <>
      {/* Current topic */}
      <TopicCard
        label={data.period ? `${data.period} Topic` : 'Current Topic'}
        resolution={data.current}
        lastChecked={data.lastChecked}
      />

      {/* Upcoming */}
      {nextDate && (
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-med)' }}>
          <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--placeholder)' }}>
            Next Topic
          </div>
          {data.potentialNext && data.potentialNext.length > 0 ? (
            <>
              <p className="text-xs mb-2" style={{ color: 'var(--placeholder)' }}>
                Currently being voted on (drops {new Date(nextDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}):
              </p>
              <ul className="space-y-2">
                {data.potentialNext.map((t, i) => (
                  <li key={i} className="text-sm leading-relaxed pl-3 border-l-2" style={{ color: 'var(--ink)', borderColor: 'var(--border-side)' }}>
                    {t}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm" style={{ color: 'var(--placeholder)' }}>
              Check back closer to {new Date(nextDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}.
            </p>
          )}
        </div>
      )}

      {/* Topic brief */}
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-med)' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--placeholder)' }}>
            Topic Brief
          </div>
          {data.brief && (
            <div className="flex items-center gap-2">
              {data.briefGeneratedAt && (
                <span className="text-xs" style={{ color: 'var(--placeholder)' }}>
                  Generated {formatDate(data.briefGeneratedAt)}
                </span>
              )}
              <button
                onClick={() => onGenerateBrief(eventType)}
                disabled={generatingBrief === eventType}
                className="text-xs px-2.5 py-1 rounded-lg font-medium transition"
                style={{
                  background: 'var(--bg-main)',
                  border: '1px solid var(--border-med)',
                  color: 'var(--ink)',
                  cursor: generatingBrief === eventType ? 'wait' : 'pointer',
                  opacity: generatingBrief === eventType ? 0.6 : 1,
                }}
              >
                {generatingBrief === eventType ? 'Regenerating…' : 'Regenerate'}
              </button>
            </div>
          )}
        </div>

        {generatingBrief === eventType ? (
          <div className="flex items-center gap-2 py-4" style={{ color: 'var(--placeholder)' }}>
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="10 18" strokeLinecap="round" />
            </svg>
            <span className="text-sm">Generating topic brief with Gemini…</span>
          </div>
        ) : data.brief ? (
          <div className="prose prose-sm max-w-none text-sm leading-relaxed topic-brief-content">
            <ReactMarkdown>{data.brief}</ReactMarkdown>
          </div>
        ) : hasApiKey ? (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: 'var(--placeholder)' }}>
              No brief yet. Generate a comprehensive analysis of this topic with Gemini.
            </p>
            <button
              onClick={() => onGenerateBrief(eventType)}
              className="btn-primary"
            >
              Generate Topic Brief
            </button>
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--placeholder)' }}>
            Add your Gemini API key in Settings to generate topic briefs.
          </p>
        )}
      </div>
    </>
  );
}

function TopicCard({ label, resolution, lastChecked }: { label: string; resolution: string; lastChecked: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-med)' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--placeholder)' }}>
          {label}
        </div>
        <span className="text-xs" style={{ color: 'var(--placeholder)' }}>
          Last checked {relativeTime(lastChecked)}
        </span>
      </div>
      <p className="text-base font-semibold leading-snug" style={{ color: 'var(--ink)' }}>
        {resolution}
      </p>
    </div>
  );
}
