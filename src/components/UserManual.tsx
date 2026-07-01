import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { useApp } from '../store/appStore';
import { useInPageFind, FindBar } from './useInPageFind';
import { LoadingState } from './Spinner';

const AI_HINT_KEY = 'warroom-manual-ai-hint-dismissed';

function slug(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Flatten ReactMarkdown heading children to a plain string (for ids + TOC).
function childText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(childText).join('');
  if (React.isValidElement(children)) return childText((children.props as any).children);
  return '';
}

// Markdown element overrides — mirror the Documentation page's typography so the
// two pages look like siblings (no dependency on a Tailwind typography plugin).
const MD_COMPONENTS = {
  h1: ({ children }: any) => (
    <h1 id={`man-${slug(childText(children))}`} className="text-lg font-bold text-ink mt-8 mb-3 first:mt-0">{children}</h1>
  ),
  h2: ({ children }: any) => (
    <h2 id={`man-${slug(childText(children))}`} className="text-base font-semibold text-ink mt-8 mb-3">{children}</h2>
  ),
  h3: ({ children }: any) => (
    <h3 id={`man-${slug(childText(children))}`} className="text-sm font-semibold text-ink mt-4 mb-1.5">{children}</h3>
  ),
  p: ({ children }: any) => <p className="text-sm text-ink/70 leading-relaxed mb-2">{children}</p>,
  ul: ({ children }: any) => <ul className="space-y-1 mb-3 pl-5 list-disc">{children}</ul>,
  ol: ({ children }: any) => <ol className="space-y-1 mb-3 pl-5 list-decimal">{children}</ol>,
  li: ({ children }: any) => <li className="text-sm text-ink/70 leading-relaxed">{children}</li>,
  strong: ({ children }: any) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }: any) => <em className="italic">{children}</em>,
  hr: () => <hr className="my-6" style={{ borderColor: 'var(--border-subtle)' }} />,
  a: ({ children, href }: any) => <a href={href} className="underline" style={{ color: '#4285F4' }}>{children}</a>,
  code: ({ children }: any) => (
    <code className="px-1 py-0.5 rounded text-xs font-mono" style={{ background: 'var(--bg-elevated)', color: 'rgb(var(--ink-rgb))' }}>{children}</code>
  ),
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-2 pl-3 my-2 text-sm text-ink/60" style={{ borderColor: 'var(--border-med)' }}>{children}</blockquote>
  ),
};

export default function UserManual() {
  const { setView } = useApp();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [activeId, setActiveId] = useState('');
  const [hintDismissed, setHintDismissed] = useState(() => {
    try { return localStorage.getItem(AI_HINT_KEY) === '1'; } catch { return false; }
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const find = useInPageFind(scrollRef);

  useEffect(() => {
    (async () => {
      try {
        const res = await (window.warroom as any)?.skills?.read('user_manual');
        if (res?.ok && res.content) setContent(res.content);
        else setError(res?.error ?? 'Could not load the user manual.');
      } catch (e: any) {
        setError(e?.message ?? 'Could not load the user manual.');
      }
    })();
  }, []);

  // Build the TOC from the manual's "## " headings (skip the H1 title).
  const toc = useMemo(() => {
    if (!content) return [] as { id: string; label: string }[];
    return content.split('\n')
      .filter((l) => /^##\s+/.test(l))
      .map((l) => l.replace(/^##\s+/, '').trim())
      .map((label) => ({ id: slug(label), label }));
  }, [content]);

  // Track the active section while scrolling.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !content) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActiveId(e.target.id.replace('man-', ''));
      },
      { root: container, rootMargin: '0px 0px -70% 0px', threshold: 0 }
    );
    toc.forEach(({ id }) => {
      const el = container.querySelector(`#man-${id}`);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [content, toc]);

  function scrollTo(id: string) {
    setActiveId(id);
    document.getElementById(`man-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function dismissHint() {
    setHintDismissed(true);
    try { localStorage.setItem(AI_HINT_KEY, '1'); } catch { /* ignore */ }
  }

  return (
    <div className="relative flex h-full min-h-0" style={{ background: 'var(--bg-main)' }}>
      {find.open && (
        <FindBar query={find.query} setQuery={find.setQuery} idx={find.idx} count={find.count} step={find.step} close={find.close} />
      )}

      {/* "Ask Warroom AI" hint — points up toward the AI sparkle in the title bar
          (~52px from the window's right edge). Hidden while the find bar is open
          so the two top-right overlays never collide. */}
      {!hintDismissed && !find.open && (
        <div
          className="absolute z-40 flex items-center gap-2 rounded-lg px-3 py-2 shadow-xl"
          style={{ top: 14, right: 12, background: 'var(--bg-popover, var(--bg-elevated))', border: '1px solid var(--border-med)', maxWidth: 240 }}
        >
          {/* upward arrow aligned under the AI button */}
          <div style={{ position: 'absolute', top: -6, right: 34, width: 10, height: 10, transform: 'rotate(45deg)', background: 'var(--bg-popover, var(--bg-elevated))', borderTop: '1px solid var(--border-med)', borderLeft: '1px solid var(--border-med)' }} />
          <span style={{ fontSize: 16, lineHeight: 1 }}>✦</span>
          <span className="text-xs text-ink/80 leading-snug">Need help? Ask <strong>Warroom AI</strong> — the sparkle up there.</span>
          <button onClick={dismissHint} title="Dismiss"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', padding: 2, marginLeft: 2 }}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 2l10 10M12 2L2 12" /></svg>
          </button>
        </div>
      )}

      {/* Sidebar TOC */}
      <div className="w-44 shrink-0 flex flex-col py-6 px-3 overflow-y-auto scroll-thin" style={{ borderRight: '1px solid var(--border-side)' }}>
        <button
          className="flex items-center gap-1.5 text-xs mb-5 font-medium"
          style={{ color: 'var(--nav-inactive-color)', background: 'none', border: 'none', cursor: 'pointer' }}
          onClick={() => setView({ kind: 'settings' })}
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 15L7 10L12 5" />
          </svg>
          Settings
        </button>
        <div className="label mb-2" style={{ fontSize: 9 }}>Contents</div>
        <nav className="space-y-0.5">
          {toc.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className="w-full text-left px-2 py-1 rounded-lg text-xs transition"
              style={{
                background: activeId === s.id ? 'var(--item-selected-bg)' : 'transparent',
                color: activeId === s.id ? 'var(--item-selected-text)' : 'var(--nav-inactive-color)',
                border: 'none', cursor: 'pointer', fontWeight: activeId === s.id ? 600 : 400,
              }}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Main content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin px-8 py-8 max-w-3xl">
        <div className="label mb-1">Warroom</div>
        <h1 className="text-xl font-bold text-ink mb-0.5">User Manual</h1>
        <p className="text-xs mb-1" style={{ color: 'var(--nav-inactive-color)' }}>Last updated: 6/30/26</p>
        <p className="text-xs mb-8" style={{ color: 'var(--placeholder)' }}>
          Press <code className="px-1 py-0.5 rounded text-xs font-mono" style={{ background: 'var(--bg-elevated)' }}>⌘F</code> / <code className="px-1 py-0.5 rounded text-xs font-mono" style={{ background: 'var(--bg-elevated)' }}>Ctrl F</code> to search this page.
        </p>

        {error && <div className="text-sm text-danger">{error}</div>}
        {!content && !error && (
          <LoadingState className="mt-12" messages={['Loading the user manual…', 'Almost there…']} />
        )}
        {content && (
          <ReactMarkdown components={MD_COMPONENTS}>{content.replace(/^#[^\n]*\n+/, '')}</ReactMarkdown>
        )}
      </div>
    </div>
  );
}
