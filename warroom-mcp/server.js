#!/usr/bin/env node
/**
 * warroom-mcp — exposes Warroom's data and tools as an MCP server.
 *
 * Reads from the same userData directory the Electron app writes to, so
 * Claude always sees live data: current topic, saved cards, tournaments, etc.
 *
 * Tools mirror the in-app Warroom Agent:
 *   get_warroom_context   — topic, event, tournament/round history (same as system prompt)
 *   get_skill             — load a skill .md file by name
 *   search_library        — fuzzy search saved cards
 *   get_cases / get_blocks / get_cards — browse the card library
 *   get_opponents         — saved opponent scouting notes
 *   get_tournaments       — saved tournament records
 *   save_card             — write a new card to the library
 *   fetch_article         — fetch readable text from a URL
 *   search_tabroom_tournament — search Tabroom by tournament name
 *   search_judge          — look up a judge paradigm on Tabroom
 *
 * Missing vs in-app agent (require Electron webview):
 *   search_logos, search_openevidence — use the in-app agent for those.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { z } from 'zod';

// ─── Paths ─────────────────────────────────────────────────────────────────────
// DATA_DIR  — where Warroom stores db.json, topics.json, app_settings, etc.
// SKILLS_DIR — where the bundled skill .md files live

const DATA_DIR = process.env.WARROOM_DATA_DIR
  ?? join(homedir(), 'Library', 'Application Support', 'warroom', 'warroom');

// Dev: skills live in the source tree. Prod: they'd be in the skills subdir of userData.
const SKILLS_DIR = process.env.WARROOM_SKILLS_DIR
  ?? join(homedir(), 'Downloads', 'warroom', 'electron', 'skills');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readJson(name) {
  try {
    const text = await fs.readFile(join(DATA_DIR, name), 'utf-8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeJson(name, data) {
  const p = join(DATA_DIR, name);
  const tmp = p + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, p);
}

async function readSkill(name) {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  if (!safe) return null;
  for (const dir of [SKILLS_DIR, join(DATA_DIR, 'skills')]) {
    try { return await fs.readFile(join(dir, `${safe}.md`), 'utf-8'); } catch {}
  }
  return null;
}

// ─── Context builder (mirrors geminiAgentTurn in main.ts) ─────────────────────

const EVENT_MAP = {
  hspolicy:  { label: 'High School Policy (CX)',         topics: ['policy'] },
  ndtceda:   { label: 'College Policy (NDT/CEDA)',        topics: ['policy'] },
  hspf:      { label: 'High School Public Forum (PF)',    topics: ['pf']     },
  hspf_high: { label: 'High School Public Forum (PF)',    topics: ['pf']     },
  hsld:      { label: 'High School Lincoln-Douglas (LD)', topics: ['ld']     },
  nfald:     { label: 'College LD (NFA-LD)',              topics: ['ld']     },
};

async function buildContext() {
  const [topics, settings, db] = await Promise.all([
    readJson('topics.json'),
    readJson('app_settings'),
    readJson('db.json'),
  ]);

  const parts = [];

  // ── Event + topic prefix (same logic as geminiAgentTurn) ──────────────────
  const eventInfo = settings?.debateEvent ? EVENT_MAP[settings.debateEvent] : undefined;
  if (eventInfo) {
    const lines = [`User's debate event: ${eventInfo.label}`];
    if (eventInfo.topics.includes('policy') && topics?.policy?.current && !topics.policy.current.includes('not found')) {
      lines.push(`Current Policy/CX Topic (${topics.policy.season ?? 'current season'}): ${topics.policy.current}`);
    }
    if (eventInfo.topics.includes('pf') && topics?.pf?.current && !topics.pf.current.includes('not found')) {
      lines.push(`Current PF Topic (${topics.pf.period ?? 'current period'}): ${topics.pf.current}`);
    }
    if (eventInfo.topics.includes('ld') && topics?.ld?.current && !topics.ld.current.includes('not found')) {
      lines.push(`Current LD Topic (${topics.ld.period ?? 'current period'}): ${topics.ld.current}`);
    }
    parts.push(lines.join('\n'));
  }

  // ── Tournament/round context (mirrors buildTournamentContext in GeminiPanel) ─
  if (db) {
    const tournaments = Object.values(db.tournaments ?? {});
    if (tournaments.length > 0) {
      const lines = ["[User's saved tournaments & rounds — use for schedule/record questions]"];
      for (const t of tournaments) {
        const roundIds = t.rounds ?? [];
        const rounds = roundIds.map(id => db.rounds?.[id]).filter(Boolean);
        const wins   = rounds.filter(r => r.result === 'win').length;
        const losses = rounds.filter(r => r.result === 'loss').length;
        const loc    = t.location ? ` | ${t.location}` : '';
        const tbId   = t.tabroom_id ? ` | Tabroom ID: ${t.tabroom_id}` : '';
        lines.push(`\nTournament: ${t.name} (${t.event_type ?? 'policy'}${loc}${tbId}) | ${t.start ?? t.date ?? '?'} | Record: ${wins}W-${losses}L`);
        for (const r of rounds) {
          const opp    = r.opponentId
            ? (db.opponents?.[r.opponentId]?.teamName ?? r.opponentName ?? 'TBD')
            : (r.opponentName ?? 'TBD');
          const judge  = r.judgeName ? ` | Judge: ${r.judgeName}` : '';
          const room   = r.room ? ` | Room: ${r.room}` : '';
          const result = r.result ?? 'pending';
          lines.push(`  R${r.number}: ${(r.side ?? '?').toUpperCase()} vs ${opp} | ${result}${judge}${room}${r.isBye ? ' (BYE)' : ''}`);
        }
      }
      parts.push(lines.join('\n'));
    }
  }

  return parts.join('\n\n');
}

// ─── Tabroom helpers (mirrors main.ts implementations) ─────────────────────────

function tbSplitName(query) {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return { first: '', last: tokens[0] ?? '' };
  return { first: tokens[0], last: tokens.slice(1).join(' ') };
}

async function tbRunParadigmSearch(first, last) {
  const params = new URLSearchParams();
  if (first) params.set('search_first', first);
  if (last)  params.set('search_last',  last);
  const res = await fetch(`https://www.tabroom.com/index/paradigm.mhtml?${params.toString()}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`Tabroom HTTP ${res.status}`);
  const html = await res.text();

  const results = [];
  const seen = new Set();

  // Multi-match: results table with paradigm.mhtml?judge_person_id=ID links
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowM;
  while ((rowM = rowRe.exec(html)) !== null) {
    const row = rowM[1];
    const idM = row.match(/paradigm\.mhtml\?judge_person_id=(\d+)/);
    if (!idM) continue;
    const personId = idM[1];
    if (seen.has(personId)) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m =>
      m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s{2,}/g, ' ').trim()
    );
    const name = `${cells[0] ?? ''} ${cells[1] ?? ''}`.trim();
    if (!name) continue;
    seen.add(personId);
    results.push({ personId, name, institution: cells[2] ?? '' });
  }

  // Single exact match: Tabroom renders the paradigm page directly
  if (results.length === 0) {
    const prefM = html.match(/show_past_prefs\.mhtml\?judge_person_id=(\d+)/);
    if (prefM) {
      const personId = prefM[1];
      const h3 = html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
      const name = h3
        ? h3[1].replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim()
        : `${first} ${last}`.trim();
      results.push({ personId, name, institution: '' });
    }
  }

  return results;
}

async function tbFetchParadigm(personId) {
  const res = await fetch(`https://www.tabroom.com/index/paradigm.mhtml?judge_person_id=${encodeURIComponent(personId)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!res.ok) return null;
  const html = await res.text();

  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');

  const fullText = clean
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ').trim();

  // Extract text between "Paradigm Statement" and "Full Judging Record" (or disclaimer)
  const STMT_MARKER   = 'Paradigm Statement';
  const RECORD_MARKER = 'Full Judging Record';
  const DISC_MARKER   = 'The paradigms published on Tabroom.com';

  const stmtIdx   = fullText.indexOf(STMT_MARKER);
  const recordIdx = fullText.indexOf(RECORD_MARKER);
  const discIdx   = fullText.indexOf(DISC_MARKER);
  const endIdx    = (recordIdx > stmtIdx && recordIdx > 0) ? recordIdx : discIdx;

  if (stmtIdx >= 0 && endIdx > stmtIdx) {
    let between = fullText.slice(stmtIdx + STMT_MARKER.length, endIdx).trim();
    between = between.replace(/Last reviewed on\b.{0,60}?\b(?:PDT|PST|MDT|MST|CDT|CST|EDT|EST|UTC)\b\s*/i, '').trim();
    if (between.length > 10) return between.slice(0, 4000);
  }

  return null;
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'warroom',
  version: '0.1.0',
});

// ── get_warroom_context ───────────────────────────────────────────────────────
server.tool(
  'get_warroom_context',
  `Get the user's current Warroom context: debate event, current NSDA topic(s), and saved tournament/round records.
Call this at the start of any debate-related conversation to ground yourself in the same context the in-app Warroom AI receives.`,
  {},
  async () => {
    const context = await buildContext();
    return {
      content: [{
        type: 'text',
        text: context || '(No Warroom context found — make sure the app has been run at least once and WARROOM_DATA_DIR is correct.)',
      }],
    };
  }
);

// ── get_skill ─────────────────────────────────────────────────────────────────
server.tool(
  'get_skill',
  `Load a Warroom skill file by name to get specialized knowledge.
ALWAYS call before answering questions about: debate format/rules/strategy (cx_debate, pf_debate, ld_debate), card cutting (card_cutting), app features (user_manual), app architecture (documentation).
Built-in skills: cx_debate, pf_debate, ld_debate, card_cutting, user_manual, documentation.`,
  { skill_name: z.string().describe('Skill name without .md extension') },
  async ({ skill_name }) => {
    const content = await readSkill(skill_name);
    if (!content) {
      return {
        content: [{
          type: 'text',
          text: `Skill "${skill_name}" not found. Built-in skills: cx_debate, pf_debate, ld_debate, card_cutting, user_manual, documentation.`,
        }],
      };
    }
    return { content: [{ type: 'text', text: content }] };
  }
);

// ── search_library ─────────────────────────────────────────────────────────────
server.tool(
  'search_library',
  'Search all saved debate cards in the Warroom library. Returns matching cards with tag, cite, and body.',
  {
    query: z.string().describe('Text to search for in card tags, cites, and bodies'),
    limit: z.number().optional().describe('Max results (default 10)'),
  },
  async ({ query, limit = 10 }) => {
    const db = await readJson('db.json');
    if (!db) return { content: [{ type: 'text', text: 'No library data found.' }] };
    const q = query.toLowerCase();
    const cards = Object.values(db.cards ?? {});
    const matches = cards
      .filter(c =>
        (c.tag ?? '').toLowerCase().includes(q) ||
        (c.cite ?? '').toLowerCase().includes(q) ||
        (c.body ?? '').toLowerCase().includes(q)
      )
      .slice(0, limit);
    if (matches.length === 0) return { content: [{ type: 'text', text: `No cards found matching "${query}".` }] };
    const text = matches.map(c =>
      `#### ${c.tag}\n**${c.cite}**\n${(c.body ?? '').slice(0, 600)}`
    ).join('\n\n---\n\n');
    return { content: [{ type: 'text', text: `Found ${matches.length} card(s):\n\n${text}` }] };
  }
);

// ── get_cases ──────────────────────────────────────────────────────────────────
server.tool(
  'get_cases',
  'List all cases in the Warroom library with names, sides, and block counts.',
  {},
  async () => {
    const db = await readJson('db.json');
    if (!db) return { content: [{ type: 'text', text: 'No data found.' }] };
    const cases = Object.values(db.cases ?? {});
    if (cases.length === 0) return { content: [{ type: 'text', text: 'No cases in library.' }] };
    const text = cases.map(c =>
      `${c.name} (${(c.side ?? '').toUpperCase()}) — ${(c.blocks ?? []).length} block(s) | id: ${c.id}`
    ).join('\n');
    return { content: [{ type: 'text', text: text }] };
  }
);

// ── get_blocks ─────────────────────────────────────────────────────────────────
server.tool(
  'get_blocks',
  'Get blocks for a case (or all blocks). Returns block titles and card counts.',
  { case_id: z.string().optional().describe('Case ID to filter by (omit for all)') },
  async ({ case_id }) => {
    const db = await readJson('db.json');
    if (!db) return { content: [{ type: 'text', text: 'No data found.' }] };
    let blocks = Object.values(db.blocks ?? {});
    if (case_id) blocks = blocks.filter(b => b.caseId === case_id);
    if (blocks.length === 0) return { content: [{ type: 'text', text: 'No blocks found.' }] };
    const text = blocks.map(b =>
      `${b.title} — ${(b.cards ?? []).length} card(s) | id: ${b.id}`
    ).join('\n');
    return { content: [{ type: 'text', text: text }] };
  }
);

// ── get_cards ──────────────────────────────────────────────────────────────────
server.tool(
  'get_cards',
  'Get all cards inside a specific block.',
  { block_id: z.string().describe('Block ID') },
  async ({ block_id }) => {
    const db = await readJson('db.json');
    if (!db) return { content: [{ type: 'text', text: 'No data found.' }] };
    const block = db.blocks?.[block_id];
    if (!block) return { content: [{ type: 'text', text: `Block ${block_id} not found.` }] };
    const cards = (block.cards ?? []).map(id => db.cards?.[id]).filter(Boolean);
    if (cards.length === 0) return { content: [{ type: 'text', text: 'No cards in this block.' }] };
    const text = cards.map(c =>
      `#### ${c.tag}\n**${c.cite}**\n${c.body}`
    ).join('\n\n---\n\n');
    return { content: [{ type: 'text', text: `${block.title} (${cards.length} cards):\n\n${text}` }] };
  }
);

// ── get_opponents ──────────────────────────────────────────────────────────────
server.tool(
  'get_opponents',
  'List saved opponent teams with scouting notes.',
  { query: z.string().optional().describe('Filter by team name or school (case-insensitive)') },
  async ({ query }) => {
    const db = await readJson('db.json');
    if (!db) return { content: [{ type: 'text', text: 'No data found.' }] };
    let opponents = Object.values(db.opponents ?? {});
    if (query) {
      const q = query.toLowerCase();
      opponents = opponents.filter(o =>
        (o.teamName ?? '').toLowerCase().includes(q) ||
        (o.school ?? '').toLowerCase().includes(q)
      );
    }
    if (opponents.length === 0) return { content: [{ type: 'text', text: 'No opponents found.' }] };
    const text = opponents.map(o =>
      `**${o.teamName}** (${o.school ?? ''})\nNotes: ${o.notes ?? '(none)'}`
    ).join('\n\n');
    return { content: [{ type: 'text', text: text }] };
  }
);

// ── get_tournaments ────────────────────────────────────────────────────────────
server.tool(
  'get_tournaments',
  "Get the user's saved tournament records with round-by-round results.",
  {},
  async () => {
    const db = await readJson('db.json');
    if (!db) return { content: [{ type: 'text', text: 'No data found.' }] };
    const tournaments = Object.values(db.tournaments ?? {});
    if (tournaments.length === 0) return { content: [{ type: 'text', text: 'No tournaments saved.' }] };
    const lines = [];
    for (const t of tournaments) {
      const roundIds = t.rounds ?? [];
      const rounds = roundIds.map(id => db.rounds?.[id]).filter(Boolean);
      const wins   = rounds.filter(r => r.result === 'win').length;
      const losses = rounds.filter(r => r.result === 'loss').length;
      lines.push(`**${t.name}** (${t.event_type ?? 'policy'}) | ${t.start ?? t.date ?? '?'} | ${wins}W-${losses}L`);
      for (const r of rounds) {
        const opp    = r.opponentId
          ? (db.opponents?.[r.opponentId]?.teamName ?? r.opponentName ?? 'TBD')
          : (r.opponentName ?? 'TBD');
        const judge  = r.judgeName ? ` | Judge: ${r.judgeName}` : '';
        const room   = r.room ? ` | Room: ${r.room}` : '';
        lines.push(`  R${r.number}: ${(r.side ?? '?').toUpperCase()} vs ${opp} | ${r.result ?? 'pending'}${judge}${room}${r.isBye ? ' (BYE)' : ''}`);
      }
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── save_card ──────────────────────────────────────────────────────────────────
server.tool(
  'save_card',
  "Save a debate card to the Warroom library (Agent Inbox). The body must be the complete, verbatim card text — never a summary.",
  {
    tag:  z.string().describe('Short descriptive label for the card'),
    cite: z.string().describe('Full citation: author, publication, date'),
    body: z.string().describe('Complete verbatim card text'),
    year: z.number().int().describe('Publication year (4-digit integer)'),
  },
  async ({ tag, cite, body, year }) => {
    const db = await readJson('db.json');
    if (!db) return { content: [{ type: 'text', text: 'Could not load database.' }] };

    const AGENT_CASE_ID  = '__agent__';
    const AGENT_BLOCK_ID = '__agent_inbox__';
    const now    = new Date().toISOString();
    const cardId = crypto.randomUUID();

    // Mirror the same upsert logic as save_card_to_library in GeminiPanel
    const existingCase = db.cases?.[AGENT_CASE_ID];
    const agentCase = existingCase
      ? (existingCase.blocks?.includes(AGENT_BLOCK_ID)
          ? existingCase
          : { ...existingCase, blocks: [...(existingCase.blocks ?? []), AGENT_BLOCK_ID] })
      : { id: AGENT_CASE_ID, name: 'Agent Saves', side: 'aff', blocks: [AGENT_BLOCK_ID] };

    const existingBlock = db.blocks?.[AGENT_BLOCK_ID];
    const agentBlock = existingBlock
      ? existingBlock
      : { id: AGENT_BLOCK_ID, caseId: AGENT_CASE_ID, title: 'Agent Inbox', type: 'text', cards: [], createdAt: now, updatedAt: now };

    await writeJson('db.json', {
      ...db,
      cases:  { ...db.cases,  [AGENT_CASE_ID]:  agentCase },
      blocks: { ...db.blocks, [AGENT_BLOCK_ID]: { ...agentBlock, cards: [...(agentBlock.cards ?? []), cardId], updatedAt: now } },
      cards:  { ...db.cards,  [cardId]: {
        id: cardId, blockId: AGENT_BLOCK_ID, tag, cite, body, year,
        flagged: new Date().getFullYear() - year > 4,
        createdAt: now,
      }},
    });

    return { content: [{ type: 'text', text: `Saved "${tag}" to Agent Inbox (card id: ${cardId}).` }] };
  }
);

// ── fetch_article ──────────────────────────────────────────────────────────────
server.tool(
  'fetch_article',
  'Fetch readable plain text from a URL (for cutting cards from links or reading a source).',
  { url: z.string().describe('URL to fetch') },
  async ({ url }) => {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Warroom/1.0)',
        'Accept': 'text/html,application/xhtml+xml,text/plain',
      },
    });
    if (!res.ok) return { content: [{ type: 'text', text: `HTTP ${res.status} — could not fetch ${url}` }] };
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 20000);
    return { content: [{ type: 'text', text: text || 'No readable text found at this URL.' }] };
  }
);

// ── search_tabroom_tournament ──────────────────────────────────────────────────
server.tool(
  'search_tabroom_tournament',
  'Search Tabroom for tournaments by name. Returns IDs, dates, and locations.',
  { name: z.string().describe('Tournament name or partial name') },
  async ({ name }) => {
    const year = new Date().getFullYear();
    const url = `https://api.tabroom.com/v1/tourn/index?name=${encodeURIComponent(name.trim())}&start=${year - 1}-01-01`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return { content: [{ type: 'text', text: `Tabroom API error: HTTP ${res.status}` }] };
    const raw = await res.json();
    const list = Array.isArray(raw) ? raw : (raw?.tournaments ?? raw?.results ?? []);
    if (list.length === 0) return { content: [{ type: 'text', text: `No tournaments found matching "${name}".` }] };
    const text = list.slice(0, 12).map(t =>
      `ID: ${t.id ?? t.tourn_id} | ${t.name} | ${t.start ?? '?'} – ${t.end ?? '?'} | ${[t.city, t.state].filter(Boolean).join(', ')}`
    ).join('\n');
    return { content: [{ type: 'text', text: text }] };
  }
);

// ── search_judge ───────────────────────────────────────────────────────────────
server.tool(
  'search_judge',
  "Look up a judge on Tabroom by name and return their judging paradigm.",
  { name: z.string().describe('Judge full name or partial name') },
  async ({ name }) => {
    const { first, last } = tbSplitName(name);
    let results = await tbRunParadigmSearch(first, last);
    if (results.length === 0 && !first && last) {
      results = await tbRunParadigmSearch(last, '');
    }
    if (results.length === 0) {
      return { content: [{ type: 'text', text: `No Tabroom profile found for "${name}". Try a different name spelling.` }] };
    }
    const judge = results[0];
    const paradigm = await tbFetchParadigm(judge.personId);
    if (!paradigm) {
      return {
        content: [{
          type: 'text',
          text: `Found ${judge.name}${judge.institution ? ` (${judge.institution})` : ''} on Tabroom (ID ${judge.personId}) but no paradigm has been written yet.`,
        }],
      };
    }
    return {
      content: [{
        type: 'text',
        text: `Paradigm for ${judge.name}${judge.institution ? ` (${judge.institution})` : ''}:\n\n${paradigm}`,
      }],
    };
  }
);

// ─── Start ────────────────────────────────────────────────────────────────────

// Keep the process alive on uncaught errors so Claude doesn't show "disconnected".
// Errors inside tool handlers are already caught; this guards against anything else.
process.on('uncaughtException', (err) => {
  process.stderr.write(`[warroom-mcp] uncaughtException: ${err.message}\n`);
});
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[warroom-mcp] unhandledRejection: ${reason}\n`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
