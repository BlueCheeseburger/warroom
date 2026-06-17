import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../store/appStore';
import MentionPicker from './MentionPicker';
import { humanizeGeminiError } from '../utils/geminiError';
import { linkifyText } from '../lib/linkify';
import { POLICY_COLS, PF_PRO_FIRST_COLS, PF_CON_FIRST_COLS, NUM_ROWS, makeDefaultData } from './FlowView';
import type { View } from '../store/appStore';

// ─── Model lists (kept in sync with Settings.tsx) ─────────────────────────────
const GEMINI_MODEL_OPTIONS = [
  { value: 'flash-lite', label: '2.5 Flash Lite' },
  { value: 'flash',      label: '2.5 Flash' },
  { value: 'flash-35',   label: '3.5 Flash' },
];
const OPENAI_MODEL_OPTIONS = [
  { value: 'gpt-4.1-nano', label: '4.1 nano' },
  { value: 'gpt-4.1-mini', label: '4.1 mini' },
  { value: 'gpt-4.1',      label: '4.1' },
];
const ANTHROPIC_MODEL_OPTIONS = [
  { value: 'claude-3-5-haiku-20241022', label: 'Haiku 3.5' },
  { value: 'claude-sonnet-4-6',         label: 'Sonnet 4.6' },
  { value: 'claude-opus-4-8',           label: 'Opus 4.8' },
];
function modelOptionsFor(provider: 'gemini' | 'openai' | 'anthropic') {
  return provider === 'openai' ? OPENAI_MODEL_OPTIONS
       : provider === 'anthropic' ? ANTHROPIC_MODEL_OPTIONS
       : GEMINI_MODEL_OPTIONS;
}

// ─── App navigation map (for the navigate_app agent tool) ─────────────────────
// Top-level destinations that need no target entity.
const NAV_TOP_LEVEL: Record<string, View> = {
  home: { kind: 'home' },
  library: { kind: 'library' },
  cases: { kind: 'library' },
  tournaments: { kind: 'tournaments' },
  opponents: { kind: 'opponents' },
  settings: { kind: 'settings' },
  topics: { kind: 'topics' },
  docs: { kind: 'docs' },
  documentation: { kind: 'docs' },
  logos: { kind: 'logos' },
  'find-cards': { kind: 'logos' },
  'open-ev': { kind: 'open-ev' },
  'open-evidence': { kind: 'open-ev' },
  'google-scholar': { kind: 'google-scholar' },
  gdrive: { kind: 'gdrive' },
  'google-drive': { kind: 'gdrive' },
  'speech-doc': { kind: 'speech-doc' },
};

// Resolve a flow's column headers from its stored data.
function flowColumns(data: any): string[] {
  if (data?.customColumns?.length) return data.customColumns;
  if ((data?.event ?? 'policy') === 'pf')
    return data?.pfOrder === 'con-first' ? PF_CON_FIRST_COLS : PF_PRO_FIRST_COLS;
  return POLICY_COLS;
}

// Exact → contains → reverse-contains match. Returns first hit or undefined.
function fuzzyFind<T>(items: T[], query: string, nameOf: (t: T) => string): T | undefined {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return undefined;
  const named = items.map((i) => [i, (nameOf(i) ?? '').toLowerCase()] as const);
  return (named.find(([, n]) => n === q)
       ?? named.find(([, n]) => n.includes(q))
       ?? named.find(([, n]) => n && q.includes(n)))?.[0];
}

// ─── Gemini logo ──────────────────────────────────────────────────────────────

export function GeminiIcon({ size = 13, color }: { size?: number; color?: string }) {
  const id = React.useId().replace(/:/g, '');
  if (color) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C10.9 7.92 7.92 10.9 2 12C7.92 13.1 10.9 16.08 12 22C13.1 16.08 16.08 13.1 22 12C16.08 10.9 13.1 7.92 12 2Z"
          fill={color} />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`gem-${id}`} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#4285F4" />
          <stop offset="40%"  stopColor="#89B4F8" />
          <stop offset="70%"  stopColor="#9168C0" />
          <stop offset="100%" stopColor="#4285F4" />
        </linearGradient>
      </defs>
      <path d="M12 2C10.9 7.92 7.92 10.9 2 12C7.92 13.1 10.9 16.08 12 22C13.1 16.08 16.08 13.1 22 12C16.08 10.9 13.1 7.92 12 2Z"
        fill={`url(#gem-${id})`} />
    </svg>
  );
}

// ─── OpenAI (ChatGPT) icon ────────────────────────────────────────────────────

export function OpenAIIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.843-3.369 2.02-1.168a.076.076 0 0 1 .071 0l4.83 2.786a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.402-.676zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  );
}

// ─── Anthropic (Claude) icon ──────────────────────────────────────────────────

export function ClaudeIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.304 1.273H13.99L7.992 16.603h3.46l1.236-3.332h5.823l1.237 3.332h3.506L17.304 1.273zM13.68 10.603l1.898-5.116 1.898 5.116H13.68zM6.696 1.273H3.253L0 16.603h3.32l.66-3.14h3.506l.66 3.14h3.32L8.013 1.273H6.696zm-.857 9.33H3.73L4.99 4.57l1.849 6.033z" />
    </svg>
  );
}

// ─── Dynamic AI provider icon ─────────────────────────────────────────────────

export function AIProviderIcon({ provider, size = 13, color }: {
  provider: 'gemini' | 'openai' | 'anthropic';
  size?: number;
  color?: string;
}) {
  if (provider === 'openai') {
    return <span style={{ color: color ?? 'currentColor', display: 'inline-flex', alignItems: 'center' }}><OpenAIIcon size={size} /></span>;
  }
  if (provider === 'anthropic') {
    return <span style={{ color: color ?? '#D97757', display: 'inline-flex', alignItems: 'center' }}><ClaudeIcon size={size} /></span>;
  }
  return <GeminiIcon size={size} color={color} />;
}

// ─── Gemini loading spinner ───────────────────────────────────────────────────

export function GeminiSpinner({ size = 22 }: { size?: number }) {
  const id = React.useId().replace(/:/g, '');
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      style={{ animation: 'gemini-pulse 1.8s ease-in-out infinite' }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <style>{`
        @keyframes gemini-pulse {
          0%   { opacity: 0.4; transform: scale(0.88) rotate(0deg); }
          50%  { opacity: 1;   transform: scale(1.08) rotate(180deg); }
          100% { opacity: 0.4; transform: scale(0.88) rotate(360deg); }
        }
      `}</style>
      <defs>
        <linearGradient id={`spin-${id}`} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#4285F4" />
          <stop offset="40%"  stopColor="#89B4F8" />
          <stop offset="70%"  stopColor="#9168C0" />
          <stop offset="100%" stopColor="#4285F4" />
        </linearGradient>
      </defs>
      <path
        d="M12 2C10.9 7.92 7.92 10.9 2 12C7.92 13.1 10.9 16.08 12 22C13.1 16.08 16.08 13.1 22 12C16.08 10.9 13.1 7.92 12 2Z"
        fill={`url(#spin-${id})`}
      />
    </svg>
  );
}

// ─── Thinking dots (message bubble loading state) ────────────────────────────

function ThinkingDots() {
  return (
    <span className="flex items-center gap-[3px] py-1 px-0.5">
      <style>{`
        @keyframes thinking-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.35; }
          40%            { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          style={{
            display: 'inline-block',
            width: 5, height: 5,
            borderRadius: '50%',
            background: 'var(--nav-inactive-color)',
            animation: `thinking-bounce 1.2s ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

// ─── Context window indicator ─────────────────────────────────────────────────

const GEMINI_CTX_TOKENS = 1_000_000; // Gemini 2.5 Flash context window

function estimateTokens(history: GeminiMsg[]): number {
  return Math.round(
    history.reduce((acc, m) => acc + (m.text?.length ?? 0) / 4, 0)
  );
}

function ContextArc({ tokens }: { tokens: number }) {
  const pct = Math.min(tokens / GEMINI_CTX_TOKENS, 1);
  const R = 8;
  const C = 2 * Math.PI * R;
  const dash = pct * C;
  const color = pct < 0.5 ? '#4285F4' : pct < 0.8 ? '#f59e0b' : '#ef4444';
  const pctInt = Math.round(pct * 100);
  return (
    <div
      title={`~${Math.round(tokens / 1000)}k tokens · ${pctInt}% of context window used`}
      style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'default' }}
    >
      <svg width="18" height="18" viewBox="0 0 20 20" style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
        <circle cx="10" cy="10" r={R} fill="none" stroke="var(--border-side)" strokeWidth="2.5" />
        <circle cx="10" cy="10" r={R} fill="none" stroke={color} strokeWidth="2.5"
          strokeDasharray={`${dash} ${C}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.4s ease' }} />
      </svg>
      <span className="text-[9px]" style={{ color: 'var(--nav-inactive-color)', fontVariantNumeric: 'tabular-nums', minWidth: 22, textAlign: 'right' }}>
        {pctInt}%
      </span>
    </div>
  );
}

// ─── Type icons ───────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, string> = {
  case: '📁', block: '⬜', flow: '📋', opponent: '🔍', member: '👤', image: '🖼', speechdoc: '📝', judge: '👨‍⚖️',
};

// ─── Attachment serializer for Gemini context ─────────────────────────────────

function serializeAttachment(att: any): string {
  if (!att?.data) return '';
  // Include warroom_id so Gemini can emit back-links using @[Name](warroom:type:id) syntax
  const idTag = att.id ? ` | warroom_id:${att.type}:${att.id}` : '';
  if (att.type === 'case') {
    const c = att.data.case;
    const blocks = Object.values(att.data.blocks ?? {}) as any[];
    const blockTexts = blocks.map((b: any) => {
      const cards: any[] = (b.cardObjects ?? []).slice(0, 8);
      const cardTexts = cards.map((card: any) =>
        `    [${card.tag ?? ''}] ${card.cite ?? ''}: ${(card.body ?? '').slice(0, 400)}`
      ).join('\n');
      return `  Block: ${b.title} | warroom_id:block:${b.id}\n${cardTexts || '    (no cards)'}`;
    }).join('\n\n');
    return `[Case: ${c?.name ?? att.name} (${c?.side?.toUpperCase() ?? ''})${idTag}]\n${blockTexts || '  (no blocks)'}`;
  }
  if (att.type === 'block') {
    const b = att.data.block;
    const cards: any[] = (att.data.cards ?? []).slice(0, 8);
    const cardTexts = cards.map((card: any) =>
      `  [${card.tag ?? ''}] ${card.cite ?? ''}: ${(card.body ?? '').slice(0, 400)}`
    ).join('\n');
    return `[Block: ${b?.title ?? att.name}${idTag}]\n${cardTexts || '  (no cards)'}`;
  }
  if (att.type === 'flow') {
    const d = att.data;
    if (!d?.sheets?.length) return `[Flow: ${att.name}${idTag}] (no sheets loaded — use read_flow to inspect)`;
    const sheetSummaries = d.sheets.map((sh: any, si: number) => {
      const cols: string[] = sh.columns ?? [];
      const cells: Record<string, string> = sh.cells ?? {};
      const colHeaders = cols.length ? cols.join(' | ') : '(no columns)';
      const filledRows: string[] = [];
      Object.entries(cells).forEach(([key, val]) => {
        if (!val) return;
        const [r, c] = key.split('-').map(Number);
        filledRows.push(`    row ${r + 1}, col "${cols[c] ?? c + 1}": ${String(val).slice(0, 200)}`);
      });
      return `  Sheet ${si + 1} "${sh.name ?? `Sheet ${si + 1}`}" — columns: ${colHeaders}\n${filledRows.join('\n') || '    (empty)'}`;
    }).join('\n');
    return `[Flow: ${att.name}${idTag}] (editable via edit_flow_cell — use sheet name to target tabs)\n${sheetSummaries}`;
  }
  if (att.type === 'opponent') {
    const o = att.data?.opponent ?? att.data;
    return `[Opponent: ${o?.teamName ?? att.name} (${o?.school ?? ''})${idTag}] Notes: ${o?.notes ?? '(none)'}`;
  }
  if (att.type === 'judge') {
    const j = att.data?.judge ?? att.data;
    const paradigmSnippet = j?.paradigm ? j.paradigm.slice(0, 1500) : '(not fetched — use search_judge to load paradigm)';
    const record = (j?.record ?? []).slice(0, 5).map((r: any) =>
      `  ${r.tournament} ${r.round}: ${r.aff} v ${r.neg} → ${r.vote} (${r.result})`
    ).join('\n');
    return `[Judge: ${j?.name ?? att.name} (${j?.institution ?? ''})${idTag}]\nParadigm: ${paradigmSnippet}\nNotes: ${j?.notes || '(none)'}\nRecent rounds:\n${record || '  (none saved)'}`;
  }
  if (att.type === 'member') {
    return `[Teammate: ${att.name}]`;
  }
  return `[Attachment: ${att.name}${idTag}]`;
}

// ─── Skills are now .md files in electron/skills/ and userData/warroom/skills/
//     Loaded on demand via the get_skill tool — nothing hardcoded here anymore.

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderMarkdown(text: string, onNav?: NavFn): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Fenced code block ─────────────────────────────────────────────────
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim(); // e.g. "python"
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // consume closing ```
      nodes.push(
        <div key={blockKey++} style={{ margin: '0.5em 0', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border-side)' }}>
          {lang && (
            <div style={{
              padding: '2px 8px', fontSize: 10, fontFamily: 'monospace',
              background: 'var(--bg-main)', color: 'var(--nav-inactive-color)',
              borderBottom: '1px solid var(--border-side)',
            }}>{lang}</div>
          )}
          <pre style={{
            margin: 0, padding: '8px 10px',
            background: 'rgba(0,0,0,0.25)',
            fontSize: 11, lineHeight: 1.55, fontFamily: 'monospace',
            overflowX: 'auto', whiteSpace: 'pre', wordBreak: 'normal',
            maxWidth: '100%',
          }}>
            <code>{codeLines.join('\n')}</code>
          </pre>
        </div>
      );
      continue;
    }

    // ── Heading (# ## ###) ────────────────────────────────────────────────
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingStyle: React.CSSProperties = {
        fontWeight: 700,
        margin: '0.6em 0 0.2em',
        fontSize: level === 1 ? 14 : level === 2 ? 13 : 12,
        color: 'var(--ink)',
      };
      nodes.push(<div key={blockKey++} style={headingStyle}>{renderInline(headingMatch[2], onNav)}</div>);
      i++;
      continue;
    }

    // ── Bullet / numbered list item ───────────────────────────────────────
    const bulletMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)/);
    if (bulletMatch) {
      const indent = Math.floor(bulletMatch[1].length / 2);
      nodes.push(
        <div key={blockKey++} style={{ display: 'flex', gap: 6, margin: '0.15em 0', paddingLeft: indent * 12 }}>
          <span style={{ opacity: 0.5, flexShrink: 0, marginTop: 1 }}>•</span>
          <span>{renderInline(bulletMatch[3], onNav)}</span>
        </div>
      );
      i++;
      continue;
    }

    // ── Blank line ────────────────────────────────────────────────────────
    if (line.trim() === '') {
      // Add a small gap only if not already at start
      if (nodes.length > 0) {
        nodes.push(<div key={blockKey++} style={{ height: '0.35em' }} />);
      }
      i++;
      continue;
    }

    // ── Paragraph line ────────────────────────────────────────────────────
    nodes.push(
      <div key={blockKey++} style={{ margin: 0, lineHeight: 1.55 }}>
        {renderInline(line, onNav)}
      </div>
    );
    i++;
  }

  return nodes;
}

// Warroom deep-link chip — rendered inline when Gemini emits @[Name](warroom:type:id)
function WarroomLinkChip({ label, type, id, onNav }: {
  label: string; type: string; id: string; onNav?: (v: any) => void;
}) {
  const navView: any =
    type === 'case'     ? { kind: 'case',     caseId: id }      :
    type === 'block'    ? { kind: 'block',    blockId: id }      :
    type === 'opponent' ? { kind: 'opponent', opponentId: id }   :
    type === 'flow'     ? { kind: 'flow',     flowId: id }       :
    type === 'judge'    ? { kind: 'judge',    judgeId: id }      :
    null;
  const icon = TYPE_ICONS[type] ?? '📎';
  return (
    <button
      onClick={() => navView && onNav?.(navView)}
      title={navView ? `Open ${label}` : label}
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full mx-0.5 align-baseline transition"
      style={{
        background: 'var(--bg-card)',
        color: 'var(--nav-inactive-color)',
        border: '1px solid var(--border-side)',
        cursor: navView ? 'pointer' : 'default',
        verticalAlign: 'middle',
        lineHeight: 1,
        fontWeight: 500,
      }}
      onMouseEnter={(e) => { if (navView) (e.currentTarget as HTMLElement).style.borderColor = '#4285F4'; }}
      onMouseLeave={(e) => { if (navView) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-side)'; }}
    >
      <span style={{ fontSize: 10 }}>{icon}</span>
      <span>{label}</span>
      {navView && (
        <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" style={{ opacity: 0.4, flexShrink: 0 }}>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
      )}
    </button>
  );
}

type NavFn = (v: any) => void;

function renderInline(line: string, onNav?: NavFn): React.ReactNode[] {
  // Split on @[Name](warroom:type:id) first, then standard markdown tokens
  const tokenRe = /(@\[[^\]]+\]\(warroom:[^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
  const parts = line.split(tokenRe);
  const result: React.ReactNode[] = [];
  parts.forEach((part, i) => {
    if (!part) return;
    // Warroom deep-link: @[Name](warroom:type:id)
    const wlMatch = part.match(/^@\[([^\]]+)\]\(warroom:([^:)]+):([^)]+)\)$/);
    if (wlMatch) {
      result.push(
        <WarroomLinkChip key={i} label={wlMatch[1]} type={wlMatch[2]} id={wlMatch[3]} onNav={onNav} />
      );
      return;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      result.push(<strong key={i}>{part.slice(2, -2)}</strong>);
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      result.push(<em key={i}>{part.slice(1, -1)}</em>);
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      result.push(
        <code key={i} className="text-[11px] px-1 rounded"
          style={{ background: 'var(--bg-main)', fontFamily: 'monospace' }}>
          {part.slice(1, -1)}
        </code>
      );
    } else {
      // Plain text: linkify bare URLs and markdown links
      result.push(...linkifyText(part, i));
    }
  });
  return result;
}

// ─── Message type ─────────────────────────────────────────────────────────────

type ToolName =
  | 'search_logos'
  | 'search_openevidence'
  | 'save_card_to_library'
  | 'fetch_article'
  | 'get_skill'
  | 'read_attachment'
  | 'search_tabroom_tournament'
  | 'get_tournament_details'
  | 'save_tournament_to_app'
  | 'search_judge'
  | 'write_skill'
  | 'navigate_app'
  | 'list_flows'
  | 'read_flow'
  | 'edit_flow_cell'
  | 'read_speech_doc';

interface ToolStep {
  id: string;
  tool: ToolName;
  label: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
}

interface GeminiMsg {
  id: string;
  role: 'user' | 'model';
  text: string;
  attachments?: any[];
  streaming?: boolean;
  error?: boolean;
  toolSteps?: ToolStep[];
}

// ─── Agent steps block (Claude-style collapsible tool use UI) ─────────────────

function AgentStepsBlock({ steps, streaming, onCancelStep }: {
  steps: ToolStep[];
  streaming?: boolean;
  onCancelStep?: (stepId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hoveredStepId, setHoveredStepId] = React.useState<string | null>(null);

  const checkIcon = () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );

  const xIcon = (color = '#ef4444') => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );

  const saveTools   = new Set<ToolName>(['save_card_to_library', 'save_tournament_to_app', 'write_skill']);
  const skillTools  = new Set<ToolName>(['get_skill', 'read_attachment']);
  // App actions — navigation + flow editing. Shown with their own compass/grid indicator.
  const actionTools = new Set<ToolName>(['navigate_app', 'list_flows', 'read_flow', 'edit_flow_cell', 'read_speech_doc']);
  // fetch_article + all search/lookup tools are "searchSteps" — shown in the search pill
  const searchSteps = steps.filter((s) => !saveTools.has(s.tool) && !skillTools.has(s.tool) && !actionTools.has(s.tool));
  const saveSteps   = steps.filter((s) => saveTools.has(s.tool));
  const skillSteps  = steps.filter((s) => skillTools.has(s.tool));
  const actionSteps = steps.filter((s) => actionTools.has(s.tool));

  const actionIcon = (tool: ToolName, color = 'currentColor', animate = false) => {
    const common = { width: 11, height: 11, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
      style: animate ? { animation: 'skill-pulse 1.4s ease-in-out infinite' } : undefined };
    if (tool === 'navigate_app') {
      // compass
      return (<svg {...common}><circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" /></svg>);
    }
    // grid / table — flow ops
    return (<svg {...common}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /></svg>);
  };

  const bookIcon = (color = 'currentColor', animate = false) => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      style={animate ? { animation: 'skill-pulse 1.4s ease-in-out infinite' } : undefined}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
    </svg>
  );

  if (streaming) {
    return (
      <div className="mb-2 space-y-0.5">
        <style>{`
          @keyframes step-spin  { to { transform: rotate(360deg); } }
          @keyframes skill-pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.4; transform:scale(0.82); } }
        `}</style>

        {/* ── Skill steps — book icon, blue tint, no cancel ── */}
        {skillSteps.map((step) => (
          <div key={step.id} className="flex items-center gap-2 text-xs pl-0.5 py-0.5">
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, flexShrink: 0 }}>
              {step.status === 'running'
                ? bookIcon('#4285F4', true)
                : step.status === 'error'
                  ? xIcon()
                  : bookIcon('#4285F4')}
            </span>
            <span style={{
              color: step.status === 'running' ? '#4285F4' : 'var(--nav-inactive-color)',
              opacity: step.status === 'error' ? 0.7 : 1,
            }}>
              {step.label}
            </span>
          </div>
        ))}

        {/* ── App action steps (navigation / flow editing) — compass/grid, no cancel ── */}
        {actionSteps.map((step) => (
          <div key={step.id} className="flex items-center gap-2 text-xs pl-0.5 py-0.5">
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, flexShrink: 0 }}>
              {step.status === 'running'
                ? actionIcon(step.tool, '#8b5cf6', true)
                : step.status === 'error'
                  ? xIcon()
                  : actionIcon(step.tool, '#8b5cf6')}
            </span>
            <span style={{
              color: step.status === 'running' ? '#8b5cf6' : 'var(--nav-inactive-color)',
              opacity: step.status === 'error' ? 0.7 : 1,
            }}>
              {step.label}
            </span>
          </div>
        ))}

        {/* ── Search / fetch steps — spinner, cancel on hover ── */}
        {searchSteps.map((step) => (
          <div
            key={step.id}
            className="flex items-center gap-2 text-xs pl-0.5 py-0.5"
            onMouseEnter={() => setHoveredStepId(step.id)}
            onMouseLeave={() => setHoveredStepId(null)}
          >
            {/* Fixed 14×14 icon slot — prevents text shifting on hover */}
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, flexShrink: 0 }}>
              {step.status === 'running'
                ? hoveredStepId === step.id
                  ? (
                    <button
                      onClick={() => onCancelStep?.(step.id)}
                      title="Exclude this from response"
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 14, height: 14,
                        background: 'var(--bg-card)', border: '1px solid var(--border-side)',
                        borderRadius: '50%', cursor: 'pointer', padding: 0,
                      }}
                    >
                      {xIcon('var(--nav-inactive-color)')}
                    </button>
                  )
                  : (
                    <span style={{
                      display: 'inline-block', width: 11, height: 11,
                      border: '1.5px solid var(--border-side)',
                      borderTopColor: 'var(--nav-inactive-color)',
                      borderRadius: '50%',
                      animation: 'step-spin 0.7s linear infinite',
                    }} />
                  )
                : step.status === 'error'
                  ? xIcon()
                  : step.status === 'cancelled'
                    ? xIcon('#6b7280')
                    : checkIcon()}
            </span>
            <span style={{
              color: step.status === 'running' ? 'var(--ink)' : 'var(--nav-inactive-color)',
              textDecoration: step.status === 'cancelled' ? 'line-through' : undefined,
              opacity: step.status === 'cancelled' ? 0.5 : 1,
            }}>
              {step.label}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // Done mode: skills inline, searches collapsible pill, saves inline
  const doneSearchCount = searchSteps.filter((s) => s.status === 'done').length;
  return (
    <div className="mb-2 text-xs">
      {/* Skill loads — small inline chips */}
      {skillSteps.length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 mb-1.5">
          {skillSteps.map((step) => (
            <div key={step.id} className="flex items-center gap-1 py-0.5" style={{
              color: step.status === 'error' ? '#ef4444' : 'var(--nav-inactive-color)',
              opacity: step.status === 'error' ? 0.7 : 1,
            }}>
              {bookIcon(step.status === 'error' ? '#ef4444' : '#4285F4')}
              <span style={{ fontSize: 10 }}>{step.label}</span>
            </div>
          ))}
        </div>
      )}
      {/* App action steps (navigation / flow editing) — inline lines */}
      {actionSteps.map((step) => (
        <div key={step.id} className="flex items-center gap-1.5 py-0.5" style={{
          color: step.status === 'error' ? '#ef4444' : 'var(--nav-inactive-color)',
          opacity: step.status === 'error' ? 0.7 : 1,
        }}>
          {step.status === 'error' ? xIcon() : actionIcon(step.tool, '#8b5cf6')}
          <span>{step.label}</span>
        </div>
      ))}
      {/* Search steps — collapsible pill */}
      {searchSteps.length > 0 && (
        <>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg mb-1 transition"
            style={{ background: 'var(--bg-main)', border: '1px solid var(--border-side)', color: 'var(--nav-inactive-color)', cursor: 'pointer' }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            Searched {doneSearchCount} source{doneSearchCount !== 1 ? 's' : ''}
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
              style={{ transform: expanded ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {expanded && (
            <div className="pl-3 mb-1 space-y-0.5">
              {searchSteps.map((step) => (
                <div key={step.id} className="flex items-center gap-1.5 py-0.5" style={{
                  color: 'var(--nav-inactive-color)', opacity: step.status === 'cancelled' ? 0.45 : 1,
                }}>
                  {step.status === 'error' ? xIcon() : step.status === 'cancelled' ? xIcon('#6b7280') : checkIcon()}
                  <span style={{ textDecoration: step.status === 'cancelled' ? 'line-through' : undefined }}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {/* Save steps */}
      {saveSteps.map((step) => (
        <div key={step.id} className="flex items-center gap-1.5 py-0.5" style={{ color: 'var(--nav-inactive-color)' }}>
          <span>{step.tool === 'save_tournament_to_app' ? '🏆' : step.tool === 'write_skill' ? '📖' : '📚'}</span>
          <span>{step.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Slash command picker (skills) ────────────────────────────────────────────

// Custom stroke-icon glyphs (lucide-style), one per built-in skill.
const SKILL_GLYPHS: Record<string, React.ReactNode> = {
  // Crossed swords — competitive, technical policy debate
  cx_debate: (
    <>
      <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
      <line x1="13" y1="19" x2="19" y2="13" />
      <line x1="16" y1="16" x2="20" y2="20" />
      <polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" />
      <line x1="5" y1="14" x2="9" y2="18" />
      <line x1="7" y1="17" x2="4" y2="20" />
    </>
  ),
  // Two speech bubbles — Public Forum, paired/conversational
  pf_debate: (
    <>
      <path d="M13 8a2 2 0 0 1-2 2H6l-3 3V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2z" />
      <path d="M17 9h2a2 2 0 0 1 2 2v8l-3-3h-5a2 2 0 0 1-2-2" />
    </>
  ),
  // Scales of justice — LD value/philosophy framework
  ld_debate: (
    <>
      <path d="M12 3v18" />
      <path d="M7 21h10" />
      <path d="M3 7h4c2 0 4-1 5-2 1 1 3 2 5 2h4" />
      <path d="m6 7-3 7c.8.6 1.8 1 3 1s2.2-.4 3-1z" />
      <path d="m18 7-3 7c.8.6 1.8 1 3 1s2.2-.4 3-1z" />
    </>
  ),
  // Scissors — card cutting
  card_cutting: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </>
  ),
  // Open book — user manual
  user_manual: (
    <>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </>
  ),
  // Stacked layers — technical architecture docs
  documentation: (
    <>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </>
  ),
  // Wrench — skill builder
  skill_builder: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  ),
};

// Generic glyph for custom (user-added) skills — a document with a spark
const CUSTOM_SKILL_GLYPH: React.ReactNode = (
  <>
    <path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10z" />
    <polyline points="13 3 13 10 20 10" />
  </>
);

const SKILL_META: Record<string, { color: string; desc: string }> = {
  cx_debate:    { color: '#ef4444', desc: 'CX / Policy debate format & strategy' },
  pf_debate:    { color: '#3b82f6', desc: 'Public Forum format & strategy' },
  ld_debate:    { color: '#8b5cf6', desc: 'Lincoln-Douglas format & strategy' },
  card_cutting: { color: '#f59e0b', desc: 'Cut evidence cards from articles or URLs' },
  user_manual:  { color: '#10b981', desc: 'How to use Warroom features' },
  documentation:{ color: '#6366f1', desc: 'Warroom technical architecture' },
  skill_builder:{ color: '#f97316', desc: 'Create or update a custom skill' },
};

function SkillIcon({ name, source }: { name: string; source: string }) {
  const meta = SKILL_META[name];
  const color = meta?.color ?? '#4285F4';
  const glyph = SKILL_GLYPHS[name] ?? CUSTOM_SKILL_GLYPH;
  return (
    <span
      className="flex items-center justify-center rounded-md shrink-0"
      style={{ width: 26, height: 26, background: `${color}1f` }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color}
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {glyph}
      </svg>
    </span>
  );
}

function SlashCommandPicker({
  query, skills, onSelect, onClose,
}: {
  query: string;
  skills: { name: string; source: string }[];
  onSelect: (name: string) => void;
  onClose: () => void;
}) {
  const q = query.toLowerCase();
  const filtered = skills.filter((s) => !q || s.name.toLowerCase().includes(q));
  if (filtered.length === 0) return null;
  return (
    <div
      className="absolute bottom-full left-0 right-0 mb-1 rounded-md shadow-lg z-50 overflow-hidden"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)' }}
    >
      <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest font-semibold"
        style={{ color: 'var(--nav-inactive-color)' }}>
        Skills
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
        {filtered.map((s) => {
          const meta = SKILL_META[s.name];
          return (
            <button
              key={s.name}
              className="w-full text-left px-3 py-2 flex items-center gap-2.5 transition"
              style={{ color: 'var(--ink)', background: 'transparent' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              onClick={() => onSelect(s.name)}
            >
              <SkillIcon name={s.name} source={s.source} />
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm font-medium leading-tight">
                  /{s.name}{s.source === 'user' ? <span className="ml-1.5 text-[10px] font-normal" style={{ color: '#4285F4' }}>custom</span> : null}
                </span>
                {meta?.desc && (
                  <span className="text-[11px] leading-snug" style={{ color: 'var(--nav-inactive-color)' }}>
                    {meta.desc}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <div className="pb-1" />
    </div>
  );
}

// ─── Attach menu item ─────────────────────────────────────────────────────────

function AttachMenuItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button className="w-full text-left px-3 py-2 flex items-center gap-2 text-xs transition"
      style={{ color: 'var(--ink)', background: 'transparent' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      onClick={onClick}>
      <span className="text-sm">{icon}</span>{label}
    </button>
  );
}

// ─── Conversation list ────────────────────────────────────────────────────────

interface Conversation {
  id: string;
  title: string;
  history: GeminiMsg[];
}

function newConversation(): Conversation {
  return { id: crypto.randomUUID(), title: 'New chat', history: [] };
}

// ─── Panel ────────────────────────────────────────────────────────────────────

const CONV_META_KEY = 'warroom-gemini-conversations';
const convHistoryKey = (id: string) => `warroom-gemini-conv-${id}`;

function loadConversations(): Conversation[] {
  try {
    const meta: Array<{ id: string; title: string }> = JSON.parse(localStorage.getItem(CONV_META_KEY) ?? '[]');
    if (meta.length > 0) {
      return meta.map((m) => ({
        id: m.id,
        title: m.title,
        history: (() => {
          try { return JSON.parse(localStorage.getItem(convHistoryKey(m.id)) ?? '[]'); } catch { return []; }
        })(),
      }));
    }
  } catch {}
  return [newConversation()];
}

export function saveGeminiConversationsMeta(convs: Conversation[]) {
  try {
    localStorage.setItem(CONV_META_KEY, JSON.stringify(convs.map((c) => ({ id: c.id, title: c.title }))));
    window.dispatchEvent(new StorageEvent('storage', { key: CONV_META_KEY }));
  } catch {}
}

export default function GeminiPanel() {
  const { geminiOpen, setGeminiOpen, geminiActiveId, setGeminiActiveId } = useApp();
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeId, setActiveId] = useState<string>(() => loadConversations()[0]?.id ?? '');
  const [showList, setShowList] = useState(false);
  const [apiProvider, setApiProvider] = useState<'gemini' | 'openai' | 'anthropic'>('gemini');

  useEffect(() => {
    window.warroom?.storage.read('app_settings').then((s: any) => {
      if (s?.apiProvider) setApiProvider(s.apiProvider);
    }).catch(() => {});
    function onSettingsChange(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.apiProvider !== undefined) setApiProvider(detail.apiProvider);
    }
    window.addEventListener('warroom-settings-change', onSettingsChange);
    return () => window.removeEventListener('warroom-settings-change', onSettingsChange);
  }, []);

  const active = conversations.find((c) => c.id === activeId) ?? conversations[0];

  // Honour incoming activeId from home card
  useEffect(() => {
    if (geminiActiveId && conversations.find((c) => c.id === geminiActiveId)) {
      setActiveId(geminiActiveId);
      setGeminiActiveId(null);
    }
  }, [geminiActiveId, conversations]);

  // Persist metadata whenever conversations change
  useEffect(() => {
    saveGeminiConversationsMeta(conversations);
  }, [conversations]);

  if (!geminiOpen) return null;

  function createChat() {
    const c = newConversation();
    setConversations((prev) => [c, ...prev]);
    setActiveId(c.id);
    setShowList(false);
  }

  function selectChat(id: string) {
    setActiveId(id);
    setShowList(false);
  }

  function deleteChat(id: string) {
    try { localStorage.removeItem(convHistoryKey(id)); } catch {}
    const next = conversations.filter((c) => c.id !== id);
    if (next.length === 0) {
      const fresh = newConversation();
      setConversations([fresh]);
      setActiveId(fresh.id);
    } else {
      setConversations(next);
      if (id === activeId) setActiveId(next[0].id);
    }
  }

  function onHistoryChange(id: string, history: GeminiMsg[], firstMsg?: string) {
    try { localStorage.setItem(convHistoryKey(id), JSON.stringify(history)); } catch {}
    // Defer setConversations so it never runs inside a setState updater (which would cause
    // React 18's "Cannot update a component while rendering" fatal error → black screen).
    // NOTE: saveGeminiConversationsMeta is intentionally NOT called here — it dispatches a
    // storage event synchronously, which would call setState in GeminiHomeCard during React's
    // render phase and crash the app. The useEffect below handles persisting after commit.
    setTimeout(() => {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          // Only update title if firstMsg is provided AND is a real title
          const newTitle = firstMsg != null
            ? firstMsg
            : (c.title === 'New chat' || c.title === '…') ? c.title : c.title;
          return { ...c, history, title: newTitle };
        })
      );
    }, 0);
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-main)' }}>
      {/* Header */}
      <div className="h-10 flex items-center gap-1.5 px-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border-side)', background: 'var(--bg-titlebar)' }}>
        {/* Chat list toggle */}
        <PanelBtn title="Chat history" onClick={() => setShowList((v) => !v)} active={showList}>
          <ListIcon />
        </PanelBtn>
        <AIProviderIcon provider={apiProvider} size={13} />
        <span className="text-xs font-semibold flex-1 truncate" style={{ color: 'var(--ink)' }}>
          {active.title}
        </span>
        {/* Context window indicator — only shown above 50% */}
        {estimateTokens(active.history) / GEMINI_CTX_TOKENS > 0.5 && (
          <ContextArc tokens={estimateTokens(active.history)} />
        )}
        {/* New chat */}
        <PanelBtn title="New chat" onClick={createChat}>
          <NewChatIcon />
        </PanelBtn>
        {/* Close */}
        <PanelBtn title="Close" onClick={() => setGeminiOpen(false)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </PanelBtn>
      </div>

      {/* Conversation list drawer */}
      {showList && (
        <div className="shrink-0 overflow-y-auto scroll-thin max-h-52"
          style={{ borderBottom: '1px solid var(--border-side)', background: 'var(--bg-card)' }}>
          {conversations.map((c) => (
            <div key={c.id}
              className="flex items-center gap-2 px-3 py-2 cursor-pointer group"
              style={{
                background: c.id === activeId ? 'var(--nav-active-bg)' : 'transparent',
                borderBottom: '1px solid var(--border-side)',
              }}
              onClick={() => selectChat(c.id)}
              onMouseEnter={(e) => { if (c.id !== activeId) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
              onMouseLeave={(e) => { if (c.id !== activeId) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <AIProviderIcon provider={apiProvider} size={11} />
              <span className="text-xs flex-1 truncate" style={{ color: 'var(--ink)' }}>{c.title}</span>
              {conversations.length > 1 && (
                <button
                  className="opacity-0 group-hover:opacity-100 text-[10px] px-1 rounded transition-opacity"
                  style={{ color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }}
                  title="Delete chat"
                >✕</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Active body */}
      <div className="flex-1 min-h-0">
        <GeminiBody
          key={active.id}
          conversationId={active.id}
          initialHistory={active.history}
          onHistoryChange={onHistoryChange}
        />
      </div>
    </div>
  );
}

function PanelBtn({ title, onClick, active, children }: {
  title: string; onClick: () => void; active?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="w-6 h-6 flex items-center justify-center rounded-md transition shrink-0"
      style={{
        color: active ? 'var(--nav-active-color)' : 'var(--nav-inactive-color)',
        background: active ? 'var(--nav-active-bg)' : 'transparent',
        border: 'none', cursor: 'pointer',
      }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}

function NewChatIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function MicIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}


// ─── Body ─────────────────────────────────────────────────────────────────────

// ─── Build tournament/round context string for system prompt injection ───────────

function buildAppIndex(db: any, flowsIndex: any[]): string {
  const sections: string[] = [];

  // Cases
  const cases = Object.values(db.cases ?? {}) as any[];
  if (cases.length > 0) {
    sections.push('[CASES — reference by name; use warroom_id to link back]\n' +
      cases.map((c: any) => `  case:"${c.name}" side:${c.side?.toUpperCase() ?? '?'} blocks:${(c.blocks ?? []).length} | warroom_id:case:${c.id}`).join('\n'));
  }

  // Blocks
  const blocks = Object.values(db.blocks ?? {}) as any[];
  if (blocks.length > 0) {
    sections.push('[BLOCKS]\n' +
      blocks.map((b: any) => `  block:"${b.title}" type:${b.type ?? '?'} cards:${(b.cards ?? []).length} | warroom_id:block:${b.id}`).join('\n'));
  }

  // Flows
  if (flowsIndex.length > 0) {
    sections.push('[FLOWS — editable via edit_flow_cell]\n' +
      flowsIndex.map((f: any) => `  flow:"${f.name}" event:${f.event} | warroom_id:flow:${f.id}`).join('\n'));
  }

  // Opponents
  const opponents = Object.values(db.opponents ?? {}) as any[];
  if (opponents.length > 0) {
    sections.push('[OPPONENTS]\n' +
      opponents.map((o: any) => `  opponent:"${o.teamName}" school:${o.school ?? '?'} | warroom_id:opponent:${o.id}`).join('\n'));
  }

  // Judges
  const judges = Object.values(db.judges ?? {}) as any[];
  if (judges.length > 0) {
    sections.push('[JUDGES]\n' +
      judges.map((j: any) => `  judge:"${j.name}" institution:${j.institution ?? '?'} | warroom_id:judge:${j.id}`).join('\n'));
  }

  // Tournaments + rounds
  const tournaments = Object.values(db.tournaments ?? {}) as any[];
  if (tournaments.length > 0) {
    const tLines: string[] = ['[TOURNAMENTS & ROUNDS]'];
    for (const t of tournaments) {
      const roundIds: string[] = t.rounds ?? [];
      const rounds = roundIds.map((id: string) => db.rounds?.[id]).filter(Boolean) as any[];
      const wins   = rounds.filter((r: any) => r.result === 'win').length;
      const losses = rounds.filter((r: any) => r.result === 'loss').length;
      const loc    = t.location ? ` | ${t.location}` : '';
      tLines.push(`  tournament:"${t.name}" event:${t.event_type ?? 'policy'}${loc} | ${t.start ?? t.date ?? '?'} | ${wins}W-${losses}L | warroom_id:tournament:${t.id}`);
      for (const r of rounds) {
        const opp    = r.opponentId ? (db.opponents?.[r.opponentId]?.teamName ?? r.opponentName ?? 'TBD') : (r.opponentName ?? 'TBD');
        const judge  = r.judgeName ? ` judge:${r.judgeName}` : '';
        tLines.push(`    R${r.number}: ${(r.side ?? '?').toUpperCase()} vs ${opp} | ${r.result ?? 'pending'}${judge}${r.isBye ? ' (BYE)' : ''}`);
      }
    }
    sections.push(tLines.join('\n'));
  }

  if (sections.length === 0) return '';
  return '[APP INDEX — the user may refer to any item below by name. Match case-insensitively and use the warroom_id to link back with @[Name](warroom:type:id).]\n\n' + sections.join('\n\n');
}

function GeminiBody({ conversationId, initialHistory, onHistoryChange }: {
  conversationId: string;
  initialHistory: GeminiMsg[];
  onHistoryChange: (id: string, history: GeminiMsg[], firstMsg?: string) => void;
}) {
  const { update, agentSearchFns, db, setView, flowsIndex } = useApp();
  const [history, setHistory] = useState<GeminiMsg[]>(initialHistory);
  const [composerText, setComposerText] = useState('');
  const [pendingMentions, setPendingMentions] = useState<any[]>([]);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [showSlashPicker, setShowSlashPicker] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [availableSkills, setAvailableSkills] = useState<{ name: string; source: string }[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [tokenSaving, setTokenSaving] = useState(false);
  const [geminiModel, setGeminiModel] = useState('flash');
  const [openaiModel, setOpenaiModel] = useState('gpt-4.1-mini');
  const [anthropicModel, setAnthropicModel] = useState('claude-sonnet-4-6');
  const [apiProvider, setApiProvider] = useState<'gemini' | 'openai' | 'anthropic'>('gemini');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [dictationStatus, setDictationStatus] = useState<'idle' | 'transcribing'>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);

  // Load available skills once on mount (for slash command picker)
  useEffect(() => {
    (window.warroom as any)?.skills?.list()
      .then((r: any) => { if (r?.ok) setAvailableSkills(r.skills ?? []); })
      .catch(() => {});
  }, []);

  // Load token saving default and model from settings on mount, keep in sync
  useEffect(() => {
    window.warroom?.storage.read('app_settings').then((s: any) => {
      if (s?.tokenSavingDefault !== undefined) {
        setTokenSaving(!!s.tokenSavingDefault);
      } else {
        setTokenSaving(s?.geminiModel === 'flash-lite');
      }
      if (s?.geminiModel) setGeminiModel(s.geminiModel);
      if (s?.openaiModel) setOpenaiModel(s.openaiModel);
      if (s?.anthropicModel) setAnthropicModel(s.anthropicModel);
      if (s?.apiProvider) setApiProvider(s.apiProvider);
    }).catch(() => {});

    function onSettingsChange(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.tokenSavingDefault !== undefined) setTokenSaving(!!detail.tokenSavingDefault);
      if (detail?.geminiModel !== undefined) setGeminiModel(detail.geminiModel);
      if (detail?.openaiModel !== undefined) setOpenaiModel(detail.openaiModel);
      if (detail?.anthropicModel !== undefined) setAnthropicModel(detail.anthropicModel);
      if (detail?.apiProvider !== undefined) setApiProvider(detail.apiProvider);
    }
    window.addEventListener('warroom-settings-change', onSettingsChange);
    return () => window.removeEventListener('warroom-settings-change', onSettingsChange);
  }, []);

  useEffect(() => {
    if (!showModelPicker) return;
    function onMouseDown(e: MouseEvent) {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [showModelPicker]);

  async function saveModel(value: string) {
    setShowModelPicker(false);
    const s = await window.warroom?.storage.read('app_settings').catch(() => ({})) ?? {};
    if (apiProvider === 'gemini') {
      setGeminiModel(value);
      const isLite = value === 'flash-lite';
      setTokenSaving(isLite);
      await window.warroom?.storage.write('app_settings', { ...s, geminiModel: value, tokenSavingDefault: isLite });
      window.dispatchEvent(new CustomEvent('warroom-settings-change', { detail: { geminiModel: value, tokenSavingDefault: isLite } }));
    } else if (apiProvider === 'openai') {
      setOpenaiModel(value);
      await window.warroom?.storage.write('app_settings', { ...s, openaiModel: value });
      window.dispatchEvent(new CustomEvent('warroom-settings-change', { detail: { openaiModel: value } }));
    } else {
      setAnthropicModel(value);
      await window.warroom?.storage.write('app_settings', { ...s, anthropicModel: value });
      window.dispatchEvent(new CustomEvent('warroom-settings-change', { detail: { anthropicModel: value } }));
    }
  }

  const activeModel = apiProvider === 'gemini' ? geminiModel : apiProvider === 'openai' ? openaiModel : anthropicModel;
  const modelOpts = modelOptionsFor(apiProvider);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const cancelledStepIds = useRef<Set<string>>(new Set());
  const onCancelStepRef = useRef<((stepId: string) => void) | null>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [history]);


  useEffect(() => {
    if (!showMentionPicker && !showAttachMenu && !showSlashPicker) return;
    function onMouseDown(e: MouseEvent) {
      if (composerRef.current && !composerRef.current.contains(e.target as Node)) {
        setShowMentionPicker(false); setShowAttachMenu(false); setShowSlashPicker(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [showMentionPicker, showAttachMenu, showSlashPicker]);

  function handleComposerChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setComposerText(val);
    const cursor = e.target.selectionStart ?? val.length;
    // @ mention picker
    const mentionMatch = val.slice(0, cursor).match(/@(\w*)$/);
    if (mentionMatch) { setShowMentionPicker(true); setMentionQuery(mentionMatch[1]); }
    else { setShowMentionPicker(false); setMentionQuery(''); }
    // / slash skill picker — only when "/" is at the very start of the text
    const slashMatch = val.match(/^\/(\w*)$/);
    if (slashMatch) { setShowSlashPicker(true); setSlashQuery(slashMatch[1]); }
    else { setShowSlashPicker(false); setSlashQuery(''); }
  }

  function handleSlashSelect(skillName: string) {
    setShowSlashPicker(false);
    setSlashQuery('');
    // Replace the "/query" with "/skill_name " — user types their message after it
    setComposerText(`/${skillName} `);
    setTimeout(() => {
      textareaRef.current?.focus();
      const pos = skillName.length + 2; // after "/<name> "
      textareaRef.current?.setSelectionRange(pos, pos);
    }, 0);
  }

  async function handleMentionSelect(item: any) {
    setShowMentionPicker(false);
    // Capture cursor and text BEFORE any awaits — async ops below would make these stale
    const cursor = textareaRef.current?.selectionStart ?? composerText.length;
    const textAtSelect = composerText;

    let data = item.data;
    if (item.type === 'flow') {
      try { data = await window.warroom?.storage.read(`flow_data_${item.id}`); } catch {}
    } else if (item.type === 'speechdoc' && item.data?.filePath) {
      try {
        const res = await (window.warroom as any)?.speechdoc?.extract(item.data.filePath);
        if (res?.ok) {
          data = { filePath: item.data.filePath, full: res.data.full, tokenSaving: res.data.tokenSaving };
        }
      } catch {}
    }
    setPendingMentions((prev) => prev.find((p) => p.id === item.id) ? prev : [...prev, { ...item, data }]);
    const before = textAtSelect.slice(0, cursor).replace(/@\w*$/, `@${item.name.replace(/\s/g, '_')} `);
    const newText = before + textAtSelect.slice(cursor);
    const newCursorPos = before.length;
    setComposerText(newText);
    setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  }

  async function compressImage(src: string): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1200;
        const scale = img.width > MAX ? MAX / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = src;
    });
  }

  async function addImageAttachment(src: string, name: string) {
    const compressed = await compressImage(src);
    setPendingMentions((prev) => [...prev, { type: 'image', id: crypto.randomUUID(), name, data: { src: compressed } }]);
  }

  async function handleAttachment() {
    setShowAttachMenu(false);
    try {
      const path = await window.warroom?.dialog.openFile(['png', 'jpg', 'jpeg', 'gif', 'webp', 'docx']);
      if (!path) return;
      const ext = path.split('.').pop()?.toLowerCase() ?? '';
      const name = path.split(/[\\/]/).pop() ?? 'file';
      if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
        const result = await window.warroom?.fs.readFileBytes(path);
        if (!result?.ok || !result.base64) return;
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png';
        await addImageAttachment(`data:${mime};base64,${result.base64}`, name);
      } else if (ext === 'docx') {
        // Extract immediately on attach — cache lives until send/remove
        const res = await (window.warroom as any)?.speechdoc?.extract(path);
        if (!res?.ok) return;
        setPendingMentions((prev) => [
          ...prev,
          { type: 'speechdoc', id: crypto.randomUUID(), name, data: { filePath: path, full: res.data.full, tokenSaving: res.data.tokenSaving } },
        ]);
      }
    } catch {}
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItem = items.find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') await addImageAttachment(reader.result, `screenshot_${Date.now()}.png`);
    };
    reader.readAsDataURL(file);
  }

  // ─── Dictation ───────────────────────────────────────────────────────────────

  async function startDictation() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (chunks.length === 0) { setIsRecording(false); return; }
        setIsRecording(false);
        setDictationStatus('transcribing');
        const blob = new Blob(chunks, { type: recorder.mimeType });
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
        const geminiMime = recorder.mimeType.split(';')[0] || 'audio/webm';
        try {
          const res = await (window.warroom as any)?.dictation?.transcribe(btoa(bin), geminiMime);
          if (res?.ok && res.data) {
            setComposerText((prev) => (prev ? prev + ' ' : '') + res.data.trim());
          }
        } catch {}
        setDictationStatus('idle');
      };
      recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
    } catch { setIsRecording(false); }
  }

  function stopDictation() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    recorderRef.current = null;
  }

  // ─── Unified send (handles attachments + tool-calling loop) ─────────────────

  const AGENT_CASE_ID  = '__agent__';
  const AGENT_BLOCK_ID = '__agent_inbox__';
  const MAX_TURNS = 12;

  async function send(overrideContent?: string) {
    const content = overrideContent ?? (composerText.trim() || pendingMentions.map((m) => `@${m.name}`).join(' '));
    if (!content || streaming) return;
    setError('');
    setStreaming(true);

    const isFirst = history.length === 0;
    // 2.5 models: embed title tag inside the agent response (same call, no overhead).
    // 3.5 Flash: fire a separate flash-lite title call in parallel with the main call.
    const useEmbeddedTitle = isFirst && geminiModel !== 'flash-35';

    // ── Build rich user parts (images, speech docs, attachments) ──────────────
    const hasSpeechDoc = pendingMentions.some((a) => a.type === 'speechdoc');
    const userParts: any[] = [{ text: content }];
    for (const att of pendingMentions) {
      if (att.type === 'image' && att.data?.src) {
        const b64 = att.data.src.replace(/^data:[^;]+;base64,/, '');
        const mimeMatch = att.data.src.match(/^data:([^;]+)/);
        userParts.push({ inlineData: { mimeType: mimeMatch?.[1] ?? 'image/jpeg', data: b64 } });
      } else if (att.type === 'speechdoc') {
        const docText = tokenSaving ? (att.data?.tokenSaving || att.data?.full) : att.data?.full;
        const modeNote = (tokenSaving && !!att.data?.tokenSaving)
          ? ' [TOKEN SAVING ON — underlined text, cites, and headings only]'
          : ' [FULL CONTENT]';
        if (docText) userParts.push({ text: `[Speech Doc: ${att.name}${modeNote}]\n${docText}` });
      } else {
        const ctx = serializeAttachment(att);
        if (ctx) userParts.push({ text: ctx });
      }
    }
    for (const att of pendingMentions) {
      if (att.type === 'speechdoc' && att.data?.filePath) {
        (window.warroom as any)?.speechdoc?.clearCache(att.data.filePath);
      }
    }

    const userMsg: GeminiMsg = {
      id: crypto.randomUUID(), role: 'user', text: content,
      attachments: pendingMentions.map((m) =>
        m.type === 'speechdoc' ? { ...m, _tokenSavingUsed: tokenSaving && !!m.data?.tokenSaving } : m
      ),
    };
    const modelId = crypto.randomUUID();
    const modelMsg: GeminiMsg = { id: modelId, role: 'model', text: '', streaming: true, toolSteps: [] };

    setHistory((prev) => {
      const next = [...prev, userMsg, modelMsg];
      onHistoryChange(conversationId, next, isFirst ? '…' : undefined);
      return next;
    });
    setComposerText(''); setPendingMentions([]);

    // Build full app index (injected into system_instruction via IPC)
    const userContext = buildAppIndex(db, flowsIndex);

    // Build agent messages: history as plain text, current message with full parts
    let agentMsgs: any[] = [
      ...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      { role: 'user' as const, parts: userParts },
    ];

    // Inject speech doc context into system prompt if present
    if (hasSpeechDoc) {
      agentMsgs = [
        { role: 'user' as const, parts: [{ text: tokenSaving
          ? '[System: Token saving is ON. Attached speech docs only include underlined text, cites, and headings.]'
          : '[System: Token saving is OFF. Attached speech docs include full document content.]' }] },
        { role: 'model' as const, parts: [{ text: 'Understood.' }] },
        ...agentMsgs,
      ];
    }

    // 3.5 Flash: kick off flash-lite title call in parallel with the main request,
    // using just the user message for context (no need to wait for model response).
    const parallelTitlePromise = (isFirst && geminiModel === 'flash-35')
      ? window.warroom.chat.generateGeminiTitle([
          ...history.map((m: GeminiMsg) => ({ role: m.role, parts: [{ text: m.text }] })),
          { role: 'user', parts: [{ text: content }] },
        ])
      : null;

    // Inject "reading" steps for each attachment so the book icon shows during streaming
    const attachmentReadSteps: ToolStep[] = pendingMentions.map((att) => ({
      id: crypto.randomUUID(),
      tool: 'read_attachment' as ToolName,
      label: `Reading: ${att.name}`,
      status: 'running' as const,
    }));
    let steps: ToolStep[] = [...attachmentReadSteps];
    cancelledStepIds.current.clear();
    const syncSteps = (nextSteps: ToolStep[], extraUpdates?: Partial<GeminiMsg>) =>
      setHistory((prev) => prev.map((m) =>
        m.id === modelId ? { ...m, toolSteps: nextSteps, ...extraUpdates } : m
      ));
    onCancelStepRef.current = (stepId: string) => {
      cancelledStepIds.current.add(stepId);
      steps = steps.map((s) => s.id === stepId ? { ...s, status: 'cancelled' } : s);
      syncSteps(steps);
    };
    // Show attachment reading steps immediately
    if (attachmentReadSteps.length > 0) syncSteps(steps);

    try {
      let finalText = '';
      let embeddedTitle = '';
      let producedText = false;
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const res = await window.warroom.chat.geminiAgentTurn(agentMsgs, useEmbeddedTitle, userContext || undefined);
        if (!res.ok) throw new Error(res.error ?? 'Agent error');

        // Mark attachment reading steps done once Gemini first responds
        if (turn === 0 && attachmentReadSteps.length > 0) {
          steps = steps.map((s) =>
            s.tool === 'read_attachment' ? { ...s, status: 'done' } : s
          );
          syncSteps(steps);
        }

        const result = res.data!;

        if (result.type === 'text') {
          finalText = result.text ?? '';
          producedText = true;
          if (useEmbeddedTitle && result.title) embeddedTitle = result.title as string;
          break;
        }

        // ── Tool calls (parallel) ──────────────────────────────────────────────
        const calls: Array<{ name: string; args: Record<string, any> }> = (result as any).calls ?? [];
        agentMsgs = [...agentMsgs, result.modelContent]; // append model's functionCall turn

        // Helper: execute a single named tool call, returns { name, functionResult }
        const executeCall = async (name: string, args: Record<string, any>): Promise<{ name: string; functionResult: string }> => {
          if (name === 'search_logos') {
            const stepId = crypto.randomUUID();
            steps = [...steps, { id: stepId, tool: 'search_logos', label: `Searching Logos for "${args.query}"`, status: 'running' }];
            syncSteps(steps);
            let toolResult = '';
            try {
              const fn = agentSearchFns.logos;
              if (!fn) throw new Error('Logos webview not ready');
              toolResult = await fn(args.query);
              if (cancelledStepIds.current.has(stepId)) {
                steps = steps.map((s) => s.id === stepId ? { ...s, status: 'cancelled' } : s);
                syncSteps(steps);
                return { name, functionResult: 'Search excluded by user.' };
              }
              steps = steps.map((s) => s.id === stepId ? { ...s, status: 'done' } : s);
            } catch (e: any) {
              if (cancelledStepIds.current.has(stepId)) {
                steps = steps.map((s) => s.id === stepId ? { ...s, status: 'cancelled' } : s);
                syncSteps(steps);
                return { name, functionResult: 'Search excluded by user.' };
              }
              toolResult = `Error searching Logos: ${e.message}`;
              steps = steps.map((s) => s.id === stepId ? { ...s, status: 'error' } : s);
            }
            syncSteps(steps);
            return { name, functionResult: toolResult };

          } else if (name === 'search_openevidence') {
            const stepId = crypto.randomUUID();
            steps = [...steps, { id: stepId, tool: 'search_openevidence', label: `Searching Open Ev for "${args.query}"`, status: 'running' }];
            syncSteps(steps);
            let toolResult = '';
            try {
              const fn = agentSearchFns.openev;
              if (!fn) throw new Error('Open Ev webview not ready');
              toolResult = await fn(args.query);
              if (cancelledStepIds.current.has(stepId)) {
                steps = steps.map((s) => s.id === stepId ? { ...s, status: 'cancelled' } : s);
                syncSteps(steps);
                return { name, functionResult: 'Search excluded by user.' };
              }
              steps = steps.map((s) => s.id === stepId ? { ...s, status: 'done' } : s);
            } catch (e: any) {
              if (cancelledStepIds.current.has(stepId)) {
                steps = steps.map((s) => s.id === stepId ? { ...s, status: 'cancelled' } : s);
                syncSteps(steps);
                return { name, functionResult: 'Search excluded by user.' };
              }
              toolResult = `Error searching Open Ev: ${e.message}`;
              steps = steps.map((s) => s.id === stepId ? { ...s, status: 'error' } : s);
            }
            syncSteps(steps);
            return { name, functionResult: toolResult };

          } else if (name === 'save_card_to_library') {
            const stepId = crypto.randomUUID();
            steps = [...steps, { id: stepId, tool: 'save_card_to_library', label: `Saving "${args.tag}" to library…`, status: 'running' }];
            syncSteps(steps);
            try {
              const now = new Date().toISOString();
              const cardId = crypto.randomUUID();
              const year = Number(args.year) || new Date().getFullYear();
              const body = (args.body ?? '').trim();
              const cite = (args.cite ?? '').trim();
              const tag  = (args.tag  ?? 'Untitled Card').trim();
              if (!body) throw new Error('Card body is empty — Warroom AI sent a summary instead of the full text');
              await update((db) => {
                const existingCase = db.cases[AGENT_CASE_ID];
                const agentCase = existingCase
                  ? (existingCase.blocks.includes(AGENT_BLOCK_ID) ? existingCase : { ...existingCase, blocks: [...existingCase.blocks, AGENT_BLOCK_ID] })
                  : { id: AGENT_CASE_ID, name: 'Agent Saves', side: 'aff' as const, blocks: [AGENT_BLOCK_ID] };
                const existingBlock = db.blocks[AGENT_BLOCK_ID];
                const agentBlock = existingBlock
                  ? existingBlock
                  : { id: AGENT_BLOCK_ID, caseId: AGENT_CASE_ID, title: 'Agent Inbox', type: 'text', cards: [] as string[], createdAt: now, updatedAt: now };
                return {
                  ...db,
                  cases:  { ...db.cases,  [AGENT_CASE_ID]:  agentCase },
                  blocks: { ...db.blocks, [AGENT_BLOCK_ID]: { ...agentBlock, cards: [...agentBlock.cards, cardId], updatedAt: now } },
                  cards:  { ...db.cards,  [cardId]: { id: cardId, blockId: AGENT_BLOCK_ID, tag, cite, body, year, flagged: new Date().getFullYear() - year > 4, createdAt: now } },
                };
              });
              steps = steps.map((s) => s.id === stepId ? { ...s, label: `Saved "${tag}" to library`, status: 'done' } : s);
              syncSteps(steps);
              return { name, functionResult: 'Card saved successfully to Agent Inbox.' };
            } catch (e: any) {
              steps = steps.map((s) => s.id === stepId ? { ...s, label: `Error saving: ${e.message}`, status: 'error' } : s);
              syncSteps(steps);
              return { name, functionResult: `Error saving card: ${e.message}` };
            }

          } else if (name === 'get_skill') {
            const skillName = (args.skill_name ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
            const stepId = crypto.randomUUID();
            steps = [...steps, { id: stepId, tool: 'get_skill', label: `Loading skill: ${skillName}`, status: 'running' }];
            syncSteps(steps);
            try {
              const res = await (window.warroom as any).skills.read(skillName);
              if (!res.ok) {
                steps = steps.map((s) => s.id === stepId ? { ...s, status: 'error' } : s);
                syncSteps(steps);
                return { name, functionResult: `Skill "${skillName}" not found. Built-in skills: cx_debate, pf_debate, ld_debate, card_cutting, user_manual, documentation.` };
              }
              steps = steps.map((s) => s.id === stepId ? { ...s, label: `Loaded skill: ${skillName}`, status: 'done' } : s);
              syncSteps(steps);
              return { name, functionResult: res.content };
            } catch (e: any) {
              steps = steps.map((s) => s.id === stepId ? { ...s, status: 'error' } : s);
              syncSteps(steps);
              return { name, functionResult: `Error loading skill: ${e.message}` };
            }

          } else if (name === 'fetch_article') {
            const stepId = crypto.randomUUID();
            let domain = args.url ?? '';
            try { domain = new URL(args.url).hostname.replace(/^www\./, ''); } catch {}
            steps = [...steps, { id: stepId, tool: 'fetch_article', label: `Reading article: ${domain}`, status: 'running' }];
            syncSteps(steps);
            try {
              const res = await (window.warroom as any).agent.fetchArticle(args.url);
              if (cancelledStepIds.current.has(stepId)) {
                steps = steps.map((s) => s.id === stepId ? { ...s, status: 'cancelled' } : s);
                syncSteps(steps);
                return { name, functionResult: 'Article fetch excluded by user.' };
              }
              if (!res.ok) {
                steps = steps.map((s) => s.id === stepId ? { ...s, status: 'error' } : s);
                syncSteps(steps);
                return { name, functionResult: `Could not fetch that URL: ${res.error ?? 'unknown error'}` };
              }
              steps = steps.map((s) => s.id === stepId ? { ...s, status: 'done' } : s);
              syncSteps(steps);
              return { name, functionResult: res.text ? `Article content from ${args.url}:\n\n${res.text}` : 'The page loaded but contained no readable text.' };
            } catch (e: any) {
              steps = steps.map((s) => s.id === stepId ? { ...s, status: 'error' } : s);
              syncSteps(steps);
              return { name, functionResult: `Error fetching URL: ${e.message}` };
            }

          } else if (name === 'search_tabroom_tournament') {
            const stepId = crypto.randomUUID();
            steps = [...steps, { id: stepId, tool: 'search_tabroom_tournament', label: `Searching Tabroom for "${args.name}"`, status: 'running' }];
            syncSteps(steps);
            try {
              const res = await (window.warroom as any).tabroom.searchTournaments(args.name);
              if (cancelledStepIds.current.has(stepId)) {
                steps = steps.map((s) => s.id === stepId ? { ...s, status: 'cancelled' } : s);
                syncSteps(steps);
                return { name, functionResult: 'Search excluded by user.' };
              }
              if (!res.ok || !res.results?.length) {
                steps = steps.map((s) => s.id === stepId ? { ...s, status: 'error' } : s);
                syncSteps(steps);
                return { name, functionResult: res.error ?? 'No tournaments found matching that name.' };
              }
              steps = steps.map((s) => s.id === stepId ? { ...s, status: 'done' } : s);
              syncSteps(steps);
              const list = res.results.map((t: any) =>
                `ID: ${t.id} | ${t.name} | ${t.start ?? '?'} – ${t.end ?? '?'} | ${t.location || 'no location'}`
              ).join('\n');
              return { name, functionResult: `Found ${res.results.length} tournament(s):\n${list}` };
            } catch (e: any) {
              steps = steps.map((s) => s.id === stepId ? { ...s, status: 'error' } : s);
              syncSteps(steps);
              return { name, functionResult: `Error searching Tabroom: ${e.message}` };
            }

          } else if (name === 'get_tournament_details') {
            const stepId = crypto.randomUUID();
            steps = [...steps, { id: stepId, tool: 'get_tournament_details', label: `Fetching tournament details (ID ${args.tabroom_id})`, status: 'running' }];
            syncSteps(steps);
            try {
              const res = await window.warroom.tabroom.fetchTournament(args.tabroom_id);
              if (cancelledStepIds.current.has(stepId)) {
                steps = steps.map((s) => s.id === stepId ? { ...s, status: 'cancelled' } : s);
                syncSteps(steps);
                return { name, functionResult: 'Lookup excluded by user.' };
              }
              if (!res.success || !res.tournament) {
                steps = steps.map((s) => s.id === stepId ? { ...s, status: 'error' } : s);
                syncSteps(steps);
                return { name, functionResult: res.error ?? 'Could not fetch tournament details.' };
              }
              steps = steps.map((s) => s.id === stepId ? { ...s, status: 'done' } : s);
              syncSteps(steps);
              const t = res.tournament;
              const events = (t.events ?? []).map((e: any) => e.name ?? e.abbreviation ?? '').filter(Boolean).join(', ');
              return { name, functionResult: `Tournament: ${t.name}\nDates: ${t.start ?? '?'} – ${t.end ?? '?'}\nLocation: ${[t.city, t.state].filter(Boolean).join(', ') || 'N/A'}\nEvents: ${events || 'N/A'}\nTabroom ID: ${t.tabroom_id}` };
            } catch (e: any) {
              steps = steps.map((s) => s.id === stepId ? { ...s, status: 'error' } : s);
              syncSteps(steps);
              return { name, functionResult: `Error fetching details: ${e.message}` };
            }

          } else if (name === 'save_tournament_to_app') {
            const stepId = crypto.randomUUID();
            steps = [...steps, { id: stepId, tool: 'save_tournament_to_app', label: `Saving tournament (ID ${args.tabroom_id}) to app…`, status: 'running' }];
            syncSteps(steps);
            try {
              const res = await window.warroom.tabroom.fetchTournament(args.tabroom_id);
              if (!res.success || !res.tournament) {
                steps = steps.map((s) => s.id === stepId ? { ...s, status: 'error' } : s);
                syncSteps(steps);
                return { name, functionResult: res.error ?? 'Could not fetch tournament data from Tabroom.' };
              }
              const t = res.tournament;
              const now = new Date().toISOString();
              const newId = crypto.randomUUID();
              await update((db) => ({
                ...db,
                tournaments: {
                  ...db.tournaments,
                  [newId]: {
                    id: newId,
                    name: t.name ?? 'Unnamed Tournament',
                    date: t.start ?? now.slice(0, 10),
                    start: t.start ?? undefined,
                    end: t.end ?? undefined,
                    location: [t.city, t.state].filter(Boolean).join(', ') || undefined,
                    event_type: (t.events?.[0]?.abbreviation ?? 'policy').toLowerCase(),
                    rounds: [],
                    tabroom_id: t.tabroom_id,
                  },
                },
              }));
              steps = steps.map((s) => s.id === stepId ? { ...s, label: `Saved "${t.name ?? 'tournament'}" to app`, status: 'done' } : s);
              syncSteps(steps);
              return { name, functionResult: `Tournament "${t.name}" saved successfully. It now appears in your Tournaments list.` };
            } catch (e: any) {
              steps = steps.map((s) => s.id === stepId ? { ...s, status: 'error' } : s);
              syncSteps(steps);
              return { name, functionResult: `Error saving tournament: ${e.message}` };
            }

          } else if (name === 'search_judge') {
            const stepId = crypto.randomUUID();
            steps = [...steps, { id: stepId, tool: 'search_judge', label: `Looking up paradigm for "${args.name}"`, status: 'running' }];
            syncSteps(steps);
            try {
              const res = await window.warroom.tabroom.fetchParadigmByName(args.name);
              if (cancelledStepIds.current.has(stepId)) {
                steps = steps.map((s) => s.id === stepId ? { ...s, status: 'cancelled' } : s);
                syncSteps(steps);
                return { name, functionResult: 'Lookup excluded by user.' };
              }
              if (!res.ok) {
                steps = steps.map((s) => s.id === stepId ? { ...s, status: 'error' } : s);
                syncSteps(steps);
                return { name, functionResult: res.error ?? `No Tabroom profile found for "${args.name}".` };
              }
              steps = steps.map((s) => s.id === stepId ? { ...s, status: 'done' } : s);
              syncSteps(steps);
              // Format tournament history record
              const record: any[] = res.record ?? [];
              const recordText = record.length > 0
                ? '\n\nTournament History (most recent first):\n' +
                  record.slice(0, 40).map((r: any) =>
                    `- ${r.tournament} (${r.date}) — ${r.event}, ${r.round}: ${r.aff} vs ${r.neg}${r.vote ? `, voted ${r.vote}` : ''}`
                  ).join('\n')
                : '\n\nNo judging record found on Tabroom.';
              if (!res.paradigm) return { name, functionResult: `Found ${args.name} on Tabroom (ID ${res.personId}) but they haven't written a paradigm yet.${recordText}` };
              return { name, functionResult: `Paradigm for ${args.name} (Tabroom ID ${res.personId}):\n\n${res.paradigm}${recordText}` };
            } catch (e: any) {
              steps = steps.map((s) => s.id === stepId ? { ...s, status: 'error' } : s);
              syncSteps(steps);
              return { name, functionResult: `Error looking up judge: ${e.message}` };
            }

          } else if (name === 'write_skill') {
            const skillName   = (args.skill_name ?? '').trim();
            const content     = args.content ?? '';
            const description = args.description ?? '';
            const stepId = crypto.randomUUID();
            steps = [...steps, { id: stepId, tool: 'write_skill', label: `Saving skill: ${skillName}`, status: 'running' }];
            syncSteps(steps);
            try {
              const res = await (window.warroom as any).skills.write(skillName, content);
              if (!res.ok) {
                steps = steps.map((s) => s.id === stepId ? { ...s, status: 'error' } : s);
                syncSteps(steps);
                return { name, functionResult: `Error saving skill: ${res.error}` };
              }
              steps = steps.map((s) => s.id === stepId ? { ...s, label: `Saved skill: ${res.data.name}`, status: 'done' } : s);
              syncSteps(steps);
              return { name, functionResult: `Skill "${res.data.name}" saved successfully (${res.data.sizeBytes} bytes). ${description} The user can load it with get_skill("${res.data.name}") or by asking you to load it by name.` };
            } catch (e: any) {
              steps = steps.map((s) => s.id === stepId ? { ...s, status: 'error' } : s);
              syncSteps(steps);
              return { name, functionResult: `Error: ${e.message}` };
            }

          } else if (name === 'navigate_app') {
            const dest = String(args.destination ?? '').trim().toLowerCase();
            const target = String(args.target_name ?? '').trim();
            const stepId = crypto.randomUUID();
            steps = [...steps, { id: stepId, tool: 'navigate_app', label: `Navigating to ${dest}${target ? ` "${target}"` : ''}…`, status: 'running' }];
            syncSteps(steps);
            try {
              let view: View | null = null;
              let resolved = dest;
              if (dest === 'case') {
                const c: any = fuzzyFind(Object.values(db.cases ?? {}), target, (x: any) => x.name);
                if (!c) throw new Error(`No case named "${target}" found.`);
                view = { kind: 'case', caseId: c.id }; resolved = `case "${c.name}"`;
              } else if (dest === 'block') {
                const b: any = fuzzyFind(Object.values(db.blocks ?? {}), target, (x: any) => x.title);
                if (!b) throw new Error(`No block named "${target}" found.`);
                view = { kind: 'block', blockId: b.id }; resolved = `block "${b.title}"`;
              } else if (dest === 'opponent') {
                const o: any = fuzzyFind(Object.values(db.opponents ?? {}), target, (x: any) => x.teamName);
                if (!o) throw new Error(`No opponent named "${target}" found.`);
                view = { kind: 'opponent', opponentId: o.id }; resolved = `opponent "${o.teamName}"`;
              } else if (dest === 'tournament') {
                const t: any = fuzzyFind(Object.values(db.tournaments ?? {}), target, (x: any) => x.name);
                if (!t) throw new Error(`No tournament named "${target}" found.`);
                view = { kind: 'tournament', tournamentId: t.id }; resolved = `tournament "${t.name}"`;
              } else if (dest === 'flow' || dest === 'flows') {
                if (target) {
                  const f = fuzzyFind(flowsIndex, target, (x) => x.name) ?? flowsIndex.find((x) => x.id === target);
                  if (!f) throw new Error(`No flow named "${target}" found.`);
                  view = { kind: 'flow', flowId: f.id }; resolved = `flow "${f.name}"`;
                } else if (flowsIndex.length > 0) {
                  view = { kind: 'flow', flowId: flowsIndex[0].id }; resolved = `flow "${flowsIndex[0].name}"`;
                } else {
                  view = { kind: 'flow' }; resolved = 'Flows (none exist yet)';
                }
              } else if (NAV_TOP_LEVEL[dest]) {
                view = NAV_TOP_LEVEL[dest];
              } else {
                throw new Error(`Unknown destination "${dest}". Valid: home, library, tournaments, opponents, settings, topics, docs, logos, open-ev, gdrive, speech-doc, or case/block/opponent/tournament/flow with a target_name.`);
              }
              setView(view);
              steps = steps.map((s) => s.id === stepId ? { ...s, label: `Opened ${resolved}`, status: 'done' } : s);
              syncSteps(steps);
              return { name, functionResult: `Navigated to ${resolved}.` };
            } catch (e: any) {
              steps = steps.map((s) => s.id === stepId ? { ...s, label: `Navigation failed`, status: 'error' } : s);
              syncSteps(steps);
              return { name, functionResult: `Could not navigate: ${e.message}` };
            }

          } else if (name === 'list_flows') {
            const stepId = crypto.randomUUID();
            steps = [...steps, { id: stepId, tool: 'list_flows', label: 'Listing flows', status: 'running' }];
            syncSteps(steps);
            steps = steps.map((s) => s.id === stepId ? { ...s, status: 'done' } : s);
            syncSteps(steps);
            if (flowsIndex.length === 0) return { name, functionResult: 'There are no flows yet. The user can create one from the Flows section in the sidebar.' };
            const list = flowsIndex.map((f) => `- "${f.name}" (${f.event}, id:${f.id})`).join('\n');
            return { name, functionResult: `The user has ${flowsIndex.length} flow(s):\n${list}` };

          } else if (name === 'read_flow') {
            const q = String(args.flow ?? '').trim();
            const stepId = crypto.randomUUID();
            steps = [...steps, { id: stepId, tool: 'read_flow', label: `Reading flow "${q}"`, status: 'running' }];
            syncSteps(steps);
            try {
              const meta = fuzzyFind(flowsIndex, q, (x) => x.name) ?? flowsIndex.find((x) => x.id === q);
              if (!meta) throw new Error(`No flow named "${q}" found. Use list_flows to see available flows.`);
              const data: any = await window.warroom.storage.read(`flow_data_${meta.id}`);
              const cols = flowColumns(data);
              steps = steps.map((s) => s.id === stepId ? { ...s, label: `Read flow "${meta.name}"`, status: 'done' } : s);
              syncSteps(steps);
              if (!data?.sheets?.length) {
                return { name, functionResult: `Flow "${meta.name}" (${meta.event}) is empty. Columns: ${cols.join(' | ')}. Sheets: (none created yet — editing a cell will create the default layout).` };
              }
              const out: string[] = [`Flow "${meta.name}" (${meta.event}). Columns: ${cols.map((c, i) => `${i + 1}.${c}`).join('  ')}`];
              data.sheets.forEach((sh: any, si: number) => {
                const cells = sh.cells ?? {};
                const rowsWithContent: string[] = [];
                for (let r = 0; r < NUM_ROWS; r++) {
                  const parts: string[] = [];
                  cols.forEach((c, ci) => {
                    const v = cells[`${r}-${ci}`];
                    if (v && String(v).trim()) parts.push(`${c}: ${v}`);
                  });
                  if (parts.length) rowsWithContent.push(`  Row ${r + 1} — ${parts.join(' | ')}`);
                }
                out.push(`\nSheet ${si + 1}: "${sh.name}"${rowsWithContent.length ? '\n' + rowsWithContent.join('\n') : ' (empty)'}`);
              });
              return { name, functionResult: out.join('\n') };
            } catch (e: any) {
              steps = steps.map((s) => s.id === stepId ? { ...s, label: 'Read flow failed', status: 'error' } : s);
              syncSteps(steps);
              return { name, functionResult: `Could not read flow: ${e.message}` };
            }

          } else if (name === 'read_speech_doc') {
            const query = String(args.name ?? '').trim().toLowerCase().replace(/\.docx$/i, '');
            const stepId = crypto.randomUUID();
            steps = [...steps, { id: stepId, tool: 'read_speech_doc', label: `Reading "${args.name}"`, status: 'running' }];
            syncSteps(steps);
            try {
              const raw = localStorage.getItem('warroom-speech-doc-recents');
              const recents: { path: string; name: string }[] = raw ? JSON.parse(raw) : [];
              const match = recents.find((r) =>
                r.name.toLowerCase().replace(/\.docx$/i, '').includes(query) ||
                query.includes(r.name.toLowerCase().replace(/\.docx$/i, ''))
              );
              if (!match) {
                steps = steps.map((s) => s.id === stepId ? { ...s, label: `"${args.name}" not found in recent docs`, status: 'error' } : s);
                syncSteps(steps);
                return { name, functionResult: `No recent speech doc matching "${args.name}" found. The file must be opened in the Speech Doc viewer at least once before it can be read. Recent docs available: ${recents.map((r) => r.name).join(', ') || '(none)'}` };
              }
              const res = await (window.warroom as any)?.speechdoc?.extract(match.path);
              if (!res?.ok) throw new Error(res?.error ?? 'Extraction failed');
              const text = (tokenSaving && res.data?.tokenSaving) ? res.data.tokenSaving : res.data?.full;
              if (!text?.trim()) throw new Error('File appears to be empty or could not be parsed');
              steps = steps.map((s) => s.id === stepId ? { ...s, label: `Read "${match.name}"`, status: 'done' } : s);
              syncSteps(steps);
              return { name, functionResult: `[Speech Doc: ${match.name}]\n${text}` };
            } catch (e: any) {
              steps = steps.map((s) => s.id === stepId ? { ...s, label: `Failed to read "${args.name}"`, status: 'error' } : s);
              syncSteps(steps);
              return { name, functionResult: `Could not read speech doc: ${e.message}` };
            }

          } else if (name === 'edit_flow_cell') {
            const q = String(args.flow ?? '').trim();
            // Reuse an existing step for this flow if one was already created (parallel batch)
            const existingFlowStep = steps.find((s) => s.tool === 'edit_flow_cell' && (s as any)._flowQ === q);
            let stepId: string;
            if (existingFlowStep) {
              stepId = existingFlowStep.id;
              const cur = (existingFlowStep as any)._cellCount ?? 1;
              steps = steps.map((s) => s.id === stepId ? { ...s, label: `Editing "${q}" — ${cur + 1} cells`, status: 'running', _cellCount: cur + 1 } as any : s);
            } else {
              stepId = crypto.randomUUID();
              steps = [...steps, { id: stepId, tool: 'edit_flow_cell', label: `Editing "${q}"`, status: 'running', _flowQ: q, _cellCount: 1 } as any];
            }
            syncSteps(steps);
            try {
              const meta = fuzzyFind(flowsIndex, q, (x) => x.name) ?? flowsIndex.find((x) => x.id === q);
              if (!meta) throw new Error(`No flow named "${q}" found. Use list_flows first.`);

              // Load stored data, or build the default layout if the flow was never opened.
              let data: any = await window.warroom.storage.read(`flow_data_${meta.id}`);
              if (!data?.sheets?.length) {
                const ev: 'policy' | 'pf' = meta.event === 'pf' ? 'pf' : 'policy';
                data = makeDefaultData(ev, 'stock-issues', 'pro-first');
              }
              const cols = flowColumns(data);

              // Resolve sheet: by 1-based index or by name; default first sheet.
              let sheetIdx = 0;
              if (args.sheet != null && String(args.sheet).trim() !== '') {
                const sArg = String(args.sheet).trim();
                const asNum = Number(sArg);
                if (Number.isInteger(asNum) && asNum >= 1 && asNum <= data.sheets.length) {
                  sheetIdx = asNum - 1;
                } else {
                  const lc = sArg.toLowerCase();
                  let found = data.sheets.findIndex((sh: any) => (sh.name ?? '').toLowerCase() === lc);
                  if (found < 0) found = data.sheets.findIndex((sh: any) => (sh.name ?? '').toLowerCase().includes(lc));
                  if (found < 0) throw new Error(`No sheet "${sArg}" in flow "${meta.name}". Sheets: ${data.sheets.map((sh: any) => sh.name).join(', ')}.`);
                  sheetIdx = found;
                }
              }

              // Resolve column: by 1-based index or by header name.
              let colIdx = -1;
              const colArg = String(args.column ?? '').trim();
              const colNum = Number(colArg);
              if (Number.isInteger(colNum) && colNum >= 1 && colNum <= cols.length) {
                colIdx = colNum - 1;
              } else {
                colIdx = cols.findIndex((c) => c.toLowerCase() === colArg.toLowerCase());
                if (colIdx < 0) colIdx = cols.findIndex((c) => c.toLowerCase().includes(colArg.toLowerCase()));
              }
              if (colIdx < 0) throw new Error(`No column "${colArg}" in flow "${meta.name}". Columns: ${cols.join(', ')}.`);

              // Resolve row: 1-based.
              const rowNum = Math.floor(Number(args.row));
              if (!Number.isInteger(rowNum) || rowNum < 1 || rowNum > NUM_ROWS) {
                throw new Error(`Row must be between 1 and ${NUM_ROWS}.`);
              }
              const rowIdx = rowNum - 1;

              const sheet = data.sheets[sheetIdx];
              sheet.cells = { ...(sheet.cells ?? {}), [`${rowIdx}-${colIdx}`]: String(args.value ?? '') };

              await window.warroom.storage.write(`flow_data_${meta.id}`, data);
              // Tell an open FlowView to reload so the edit shows live.
              window.dispatchEvent(new CustomEvent('warroom-flow-updated', { detail: { flowId: meta.id } }));

              const cellCount = (steps.find((s) => s.id === stepId) as any)?._cellCount ?? 1;
              steps = steps.map((s) => s.id === stepId ? { ...s, label: `Edited "${meta.name}" (${cellCount} cell${cellCount !== 1 ? 's' : ''})`, status: 'done' } as any : s);
              syncSteps(steps);
              return { name, functionResult: `Set ${cols[colIdx]} (column ${colIdx + 1}), row ${rowNum} on sheet "${sheet.name}" of flow "${meta.name}" to: "${String(args.value ?? '')}".` };
            } catch (e: any) {
              steps = steps.map((s) => s.id === stepId ? { ...s, label: `Flow edit failed — ${e.message.slice(0, 60)}`, status: 'error' } : s);
              syncSteps(steps);
              return { name, functionResult: `Could not edit flow cell: ${e.message}` };
            }

          } else {
            return { name, functionResult: `Unknown tool: ${name}` };
          }
        };

        // Run all tool calls in parallel, collect all responses
        const responses = await Promise.all(calls.map(({ name, args }) => executeCall(name, args)));

        // Send all function responses back in one user turn (required by Gemini API)
        agentMsgs = [...agentMsgs, {
          role: 'user',
          parts: responses.map(({ name, functionResult }) => ({
            functionResponse: { name, response: { result: functionResult } },
          })),
        }];
      }

      // If the loop hit MAX_TURNS while still making tool calls, the model never gave
      // a written answer. Say so honestly instead of rendering a bogus "Done." with no
      // result (and discarding the work silently).
      if (!producedText && !finalText) {
        finalText = "I ran out of steps before I could finish this. The work above is what I gathered — try narrowing the request or asking me to continue.";
      }

      // Determine title before touching history state so it travels with the correct snapshot.
      // For embedded titles (2.5 models) and the fallback we already have the value synchronously.
      // For flash-35 parallel titles we update in a follow-up call once the promise resolves.
      const fallbackTitle = content.slice(0, 40) + (content.length > 40 ? '…' : '');
      const synchronousTitle = isFirst ? (embeddedTitle || (parallelTitlePromise ? null : fallbackTitle)) : null;

      // Render final response — title is bundled into the same onHistoryChange call so both
      // the history snapshot and the title are always written together (no race condition).
      setHistory((prev) => {
        const agentFinalHistory = prev.map((m) =>
          m.id === modelId ? { ...m, text: finalText || 'Done.', streaming: false, toolSteps: steps } : m
        );
        onHistoryChange(conversationId, agentFinalHistory, synchronousTitle ?? undefined);
        return agentFinalHistory;
      });

      // flash-35 only: parallel title promise resolves after the main call; update title once done.
      if (isFirst && parallelTitlePromise) {
        parallelTitlePromise
          .then((r: any) => {
            const title = (r?.ok && r.data && r.data !== 'New chat') ? r.data : fallbackTitle;
            // Use functional setHistory so we have the correct current snapshot.
            setHistory((prev) => {
              onHistoryChange(conversationId, prev, title);
              return prev;
            });
          })
          .catch(() => {
            setHistory((prev) => {
              onHistoryChange(conversationId, prev, fallbackTitle);
              return prev;
            });
          });
      }
    } catch (e: any) {
      const friendly = humanizeGeminiError(e.message);
      setHistory((prev) => {
        const next = prev.map((m) =>
          m.id === modelId ? { ...m, text: friendly, streaming: false, error: true, toolSteps: steps } : m
        );
        onHistoryChange(conversationId, next);
        return next;
      });
      setError(friendly);
    } finally {
      setStreaming(false);
      onCancelStepRef.current = null;
    }
  }

  // ─── Edit / Retry ────────────────────────────────────────────────────────────

  function editMessage(msgId: string) {
    const idx = history.findIndex((m) => m.id === msgId);
    if (idx === -1) return;
    const msg = history[idx];
    setComposerText(msg.text);
    if (msg.attachments?.length) setPendingMentions(msg.attachments);
    const trimmed = history.slice(0, idx);
    setHistory(trimmed);
    onHistoryChange(conversationId, trimmed);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  async function retryMessage(msgId: string) {
    if (streaming) return;
    const idx = history.findIndex((m) => m.id === msgId);
    if (idx === -1) return;
    const msg = history[idx];
    const trimmed = history.slice(0, idx);
    setHistory(trimmed);
    onHistoryChange(conversationId, trimmed);
    if (msg.attachments?.length) setPendingMentions(msg.attachments);
    // Pass content directly — avoids React state timing issue
    send(msg.text);
  }

  function copyMessage(id: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => prev === id ? null : prev), 1500);
    }).catch(() => {});
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto scroll-thin px-3 py-3 space-y-3">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 pb-8">
            <AIProviderIcon provider={apiProvider} size={36} />
            <div className="text-center space-y-1">
              <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                Warroom AI
              </div>
              <div className="text-xs max-w-[200px] leading-relaxed" style={{ color: 'var(--nav-inactive-color)' }}>
                Debate research, argument analysis, evidence scouting. Attach cases, blocks, or images.
              </div>
            </div>
            <div className="flex flex-col gap-1.5 w-full px-2">
              {[
                { icon: '🔍', label: 'Find cards on [argument]' },
                { icon: '✂️', label: 'Cut cards from [URL]' },
                { icon: '🕵️', label: 'Scout [team name]' },
                { icon: '👨‍⚖️', label: 'Look up judge [name]' },
                { icon: '🏆', label: 'Save tournament [name] to my app' },
                { icon: '📋', label: 'Summarize my @case' },
                { icon: '⚔️', label: 'What blocks should I read against [position]?' },
                { icon: '📊', label: 'Add [argument] to my flow' },
                { icon: '📖', label: 'Save [topic] as a skill' },
                { icon: '❓', label: 'How do I [feature]?' },
              ].map(({ icon, label }) => (
                <button
                  key={label}
                  className="flex items-center gap-2 w-full text-left px-3 py-1.5 rounded-lg text-[11px] font-medium transition-opacity hover:opacity-80"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)', color: 'var(--nav-inactive-color)', cursor: 'pointer' }}
                  onClick={() => setComposerText(label.replace(/\[.*?\]/g, '').trim() + ' ')}
                >
                  <span>{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : history.map((m) => (
          <div key={m.id} className={`flex flex-col gap-1 group/msg ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            {m.role === 'model' && (
              <div className="flex items-center gap-1.5 mb-0.5">
                <AIProviderIcon provider={apiProvider} size={12} />
                <span className="text-[10px] font-semibold" style={{ color: 'var(--nav-active-color)' }}>Warroom AI</span>
              </div>
            )}
            {/* Tool steps (agent mode) */}
            {m.role === 'model' && m.toolSteps && m.toolSteps.length > 0 && (
              <AgentStepsBlock
                steps={m.toolSteps}
                streaming={m.streaming}
                onCancelStep={m.streaming ? (stepId) => onCancelStepRef.current?.(stepId) : undefined}
              />
            )}
            {/* Message bubble — hide for agent messages that are still running with steps */}
            {(m.role === 'user' || !m.streaming || !m.toolSteps?.length || m.text) && (
            <div
              className="max-w-[90%] px-3 py-2 rounded-xl text-sm leading-relaxed"
              style={m.role === 'user'
                ? { background: '#0077ed', color: '#fff', whiteSpace: 'pre-wrap' }
                : m.error
                  ? { background: 'var(--bg-card)', color: '#ef4444', border: '1px solid var(--border-side)' }
                  : { background: 'var(--bg-card)', color: 'var(--ink)', border: '1px solid var(--border-side)' }}
            >
              {m.streaming && !m.text
                ? <ThinkingDots />
                : m.role === 'user'
                  ? (m.text || (m.streaming ? '' : '…'))
                  : renderMarkdown(m.text || (m.streaming ? '' : '…'), setView)
              }
              {m.streaming && m.text && (
                <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle rounded-sm animate-pulse"
                  style={{ background: 'var(--nav-active-color)' }} />
              )}
            </div>
            )}
            {/* Edit / Copy / Retry buttons — only on non-streaming user messages */}
            {m.role === 'user' && !m.streaming && (
              <div className="flex gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                <button
                  title="Edit"
                  onClick={() => editMessage(m.id)}
                  className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition"
                  style={{ color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                  Edit
                </button>
                <button
                  title="Copy"
                  onClick={() => copyMessage(m.id, m.text)}
                  className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition"
                  style={{ color: copiedId === m.id ? 'var(--nav-active-color)' : 'var(--nav-inactive-color)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  {copiedId === m.id
                    ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  }
                  {copiedId === m.id ? 'Copied' : 'Copy'}
                </button>
                <button
                  title="Retry"
                  onClick={() => retryMessage(m.id)}
                  className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition"
                  style={{ color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none', cursor: streaming ? 'not-allowed' : 'pointer', opacity: streaming ? 0.4 : 1 }}
                  onMouseEnter={(e) => { if (!streaming) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.27"/>
                  </svg>
                  Retry
                </button>
              </div>
            )}
            {/* Copy button on model messages */}
            {m.role === 'model' && !m.streaming && m.text && (
              <div className="flex gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                <button
                  title="Copy"
                  onClick={() => copyMessage(m.id, m.text)}
                  className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition"
                  style={{ color: copiedId === m.id ? 'var(--nav-active-color)' : 'var(--nav-inactive-color)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  {copiedId === m.id
                    ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  }
                  {copiedId === m.id ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
            {m.role === 'user' && m.attachments && m.attachments.length > 0 && (
              <div className="flex flex-wrap gap-1 max-w-[90%] justify-end">
                {m.attachments.map((att: any) => {
                  if (att.type === 'image' && att.data?.src) {
                    return (
                      <img key={att.id} src={att.data.src} alt={att.name}
                        className="rounded-lg object-cover max-h-32 max-w-[160px] border"
                        style={{ borderColor: 'var(--border-side)' }} />
                    );
                  }
                  // Determine if this attachment can navigate to a view
                  const navView: any =
                    att.type === 'case'      ? { kind: 'case', caseId: att.id } :
                    att.type === 'block'     ? { kind: 'block', blockId: att.id } :
                    att.type === 'opponent'  ? { kind: 'opponent', opponentId: att.id } :
                    att.type === 'flow'      ? { kind: 'flow', flowId: att.id } :
                    att.type === 'judge'     ? { kind: 'judge', judgeId: att.id } :
                    att.type === 'speechdoc' && att.data?.filePath ? { kind: 'speech-doc', docPath: att.data.filePath } :
                    null;
                  return (
                    <button
                      key={att.id}
                      onClick={() => navView && setView(navView)}
                      title={navView ? `Open ${att.name}` : att.name}
                      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full transition"
                      style={{
                        background: 'var(--bg-card)',
                        color: 'var(--nav-inactive-color)',
                        border: '1px solid var(--border-side)',
                        cursor: navView ? 'pointer' : 'default',
                        textDecoration: 'none',
                      }}
                      onMouseEnter={(e) => { if (navView) (e.currentTarget as HTMLElement).style.borderColor = '#4285F4'; }}
                      onMouseLeave={(e) => { if (navView) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-side)'; }}
                    >
                      {att.name}
                      {att.type === 'speechdoc' && (
                        <span style={{ color: att._tokenSavingUsed ? '#4285F4' : 'var(--nav-inactive-color)', fontWeight: 600 }}>
                          · {att._tokenSavingUsed ? 'filtered' : 'full'}
                        </span>
                      )}
                      {navView && (
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ opacity: 0.4, flexShrink: 0 }}>
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div ref={composerRef} className="shrink-0 px-3 pt-2 pb-3 space-y-2"
        style={{ borderTop: '1px solid var(--border-side)' }}>
        {pendingMentions.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: 'var(--label-color)' }}>Attaching</span>
            {pendingMentions.map((m) => (
              <div key={m.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)' }}>
                {m.type === 'image' && m.data?.src
                  ? <img src={m.data.src} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                  : <span className="text-base leading-none shrink-0">{TYPE_ICONS[m.type] ?? '📎'}</span>}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate" style={{ color: 'var(--ink)' }}>{m.name}</div>
                  {m.type === 'speechdoc' && (m.data?.full || m.data?.tokenSaving) ? (
                    <div className="text-[10px] mt-0.5 flex items-center gap-1" style={{ color: tokenSaving ? '#4285F4' : 'var(--nav-inactive-color)' }}>
                      {tokenSaving
                        ? (() => {
                            const filteredTokens = Math.round((m.data.tokenSaving?.length ?? 0) / 4);
                            const fullTokens = Math.round((m.data.full?.length ?? 0) / 4);
                            const saved = fullTokens > 0 && m.data.tokenSaving
                              ? Math.round(((fullTokens - filteredTokens) / fullTokens) * 100)
                              : null;
                            return `Filtered · ~${filteredTokens.toLocaleString()} tokens${saved !== null && saved > 0 ? ` · ${saved}% saved` : ''}`;
                          })()
                        : `Full · ~${Math.round((m.data.full?.length ?? 0) / 4).toLocaleString()} tokens`}
                    </div>
                  ) : (
                    <div className="text-[10px] capitalize mt-0.5" style={{ color: 'var(--nav-inactive-color)' }}>{m.type}</div>
                  )}
                </div>
                <button onClick={() => {
                  if (m.type === 'speechdoc' && m.data?.filePath) {
                    (window.warroom as any)?.speechdoc?.clearCache(m.data.filePath);
                  }
                  setPendingMentions((p) => p.filter((x) => x.id !== m.id));
                }} style={{ background: 'transparent', border: 'none', color: 'var(--nav-inactive-color)', cursor: 'pointer' }}>×</button>
              </div>
            ))}
          </div>
        )}
        {error && <p className="text-xs" style={{ color: '#ef4444' }}>{linkifyText(error, 'err')}</p>}
        <div className="relative">
          {showMentionPicker && (
            <MentionPicker query={mentionQuery} onSelect={handleMentionSelect}
              onClose={() => setShowMentionPicker(false)} />
          )}
          {showSlashPicker && (
            <SlashCommandPicker
              query={slashQuery}
              skills={availableSkills}
              onSelect={handleSlashSelect}
              onClose={() => setShowSlashPicker(false)}
            />
          )}
          {showAttachMenu && (
            <div className="absolute bottom-full left-0 mb-1 rounded-md shadow-lg overflow-hidden z-50"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)', minWidth: 180 }}>
              <AttachMenuItem icon="🔖" label="Cases, flows & more" onClick={() => {
                setShowAttachMenu(false); setShowMentionPicker(true); setMentionQuery('');
                setTimeout(() => textareaRef.current?.focus(), 0);
              }} />
              <AttachMenuItem icon="📎" label="Attachment" onClick={handleAttachment} />
              {pendingMentions.some((m) => m.type === 'speechdoc') && (
                <div style={{ borderTop: '1px solid var(--border-side)' }}>
                  <button
                    className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-xs transition"
                    style={{ color: 'var(--ink)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    onClick={() => setTokenSaving((v) => !v)}
                    title="Send only underlined text, card cites, and headings — skip small non-underlined body text. Reduces tokens sent to the model."
                  >
                    <span>Token saving</span>
                    <span
                      className="w-3.5 h-3.5 rounded-sm flex items-center justify-center shrink-0"
                      style={{ border: `1.5px solid ${tokenSaving ? '#4285F4' : 'var(--border-med)'}`, background: tokenSaving ? '#4285F4' : 'transparent' }}
                    >
                      {tokenSaving && (
                        <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                          <path d="M1.5 5L4 7.5L8.5 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </span>
                  </button>
                </div>
              )}
              <div className="px-3 py-1.5 text-[10px]"
                style={{ color: 'var(--nav-inactive-color)', borderTop: '1px solid var(--border-side)' }}>
                Tip: paste an image from clipboard
              </div>
            </div>
          )}
          <textarea ref={textareaRef} className="input w-full resize-none text-sm" rows={2}
            placeholder="Ask Warroom AI… @ to attach · / for skills"
            value={composerText} onChange={handleComposerChange}
            onFocus={() => setShowAttachMenu(false)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              if (e.key === 'Escape') { setShowMentionPicker(false); setShowAttachMenu(false); setShowSlashPicker(false); }
            }} />
        </div>
        <div className="flex items-center gap-2">
          {/* Attach button */}
          <button
            title="Attach"
            onClick={() => { setShowAttachMenu((v) => !v); setShowMentionPicker(false); }}
            className="w-6 h-6 flex items-center justify-center rounded-md transition"
            style={{ color: 'var(--nav-inactive-color)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          {/* Mic / dictation button */}
          <style>{`@keyframes mic-pulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>
          <button
            title={isRecording ? 'Stop dictation' : dictationStatus === 'transcribing' ? 'Transcribing…' : 'Dictate'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={isRecording ? stopDictation : dictationStatus === 'idle' ? startDictation : undefined}
            disabled={dictationStatus === 'transcribing'}
            className="w-6 h-6 flex items-center justify-center rounded-md transition"
            style={{
              background: isRecording ? 'rgba(239,68,68,0.1)' : 'transparent',
              border: isRecording ? '1.5px solid #ef4444' : '1.5px solid transparent',
              cursor: dictationStatus === 'transcribing' ? 'default' : 'pointer',
              color: isRecording ? '#ef4444' : dictationStatus === 'transcribing' ? '#4285F4' : 'var(--nav-inactive-color)',
              animation: isRecording || dictationStatus === 'transcribing' ? 'mic-pulse 1.2s ease-in-out infinite' : undefined,
            }}
            onMouseEnter={(e) => { if (!isRecording && dictationStatus === 'idle') { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; } }}
            onMouseLeave={(e) => { if (!isRecording && dictationStatus === 'idle') { (e.currentTarget as HTMLElement).style.background = 'transparent'; } }}
          >
            <MicIcon size={14} />
          </button>
          {/* Model picker */}
          <div className="relative ml-auto mr-1" ref={modelPickerRef}>
            <button
              onClick={() => setShowModelPicker((v) => !v)}
              title="Switch model"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition"
              style={{
                color: 'var(--nav-inactive-color)',
                border: '1px solid var(--border-side)',
                background: showModelPicker ? 'var(--nav-hover-bg)' : 'transparent',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = showModelPicker ? 'var(--nav-hover-bg)' : 'transparent'; }}
            >
              <AIProviderIcon provider={apiProvider} size={10} />
              <span>{modelOpts.find((o) => o.value === activeModel)?.label ?? activeModel}</span>
              <svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1.5 3L4 5.5L6.5 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            {showModelPicker && (
              <div
                className="absolute bottom-full left-0 mb-1 rounded-md shadow-lg z-50 py-1"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-side)', minWidth: 130 }}
              >
                {modelOpts.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => saveModel(o.value)}
                    className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition whitespace-nowrap"
                    style={{
                      background: activeModel === o.value ? 'var(--nav-active-bg)' : 'transparent',
                      color: activeModel === o.value ? 'var(--ink)' : 'var(--nav-inactive-color)',
                      fontWeight: activeModel === o.value ? 600 : 400,
                    }}
                    onMouseEnter={(e) => { if (activeModel !== o.value) (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover-bg)'; }}
                    onMouseLeave={(e) => { if (activeModel !== o.value) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    {activeModel === o.value ? <span style={{ color: 'var(--accent)' }}>✓</span> : <span style={{ width: 10, display: 'inline-block' }} />}
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Send button with gradient */}
          <button
            className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg font-medium transition"
            style={{
              background: streaming ? 'var(--bg-card)' : 'linear-gradient(135deg,#4285F4,#9168c0)',
              color: streaming ? 'var(--nav-inactive-color)' : '#fff',
              border: 'none', cursor: streaming ? 'not-allowed' : 'pointer', opacity: streaming ? 0.7 : 1,
            }}
            onClick={() => send()}
            disabled={streaming || (!composerText.trim() && pendingMentions.length === 0)}
          >
            {streaming ? '…' : <><AIProviderIcon provider={apiProvider} size={11} color="#fff" />&nbsp;Send</>}
          </button>
        </div>
      </div>
    </div>
  );
}
