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
 *   cross_ex_questions    — prep targeted cross-ex questions for a speech doc (mirrors in-app Cross-Ex Practice; splits Aff/Neg)
 *   cross_ex_trap_drill   — prep a cross-ex trap drill (mirrors in-app "Harder questions")
 *   score_card_credibility — prep a credibility scoring pass for a speech doc's cards (mirrors in-app Card Credibility)
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
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir, platform } from 'os';
import { z } from 'zod';

// ─── Paths ─────────────────────────────────────────────────────────────────────
// DATA_DIR  — where Warroom stores db.json, topics.json, app_settings, etc.
// SKILLS_DIR — where the bundled skill .md files live

const __dirname = dirname(fileURLToPath(import.meta.url));

function defaultDataDir() {
  switch (platform()) {
    case 'darwin': return join(homedir(), 'Library', 'Application Support', 'warroom', 'warroom');
    case 'win32':  return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'warroom', 'warroom');
    default:       return join(homedir(), '.config', 'warroom', 'warroom');
  }
}

const DATA_DIR = process.env.WARROOM_DATA_DIR ?? defaultDataDir();

// Skills live at ../electron/skills/ relative to this file — works wherever the repo is cloned
const SKILLS_DIR = process.env.WARROOM_SKILLS_DIR
  ?? join(__dirname, '..', 'electron', 'skills');

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

// ─── Flow helpers (mirror of src/components/FlowView.tsx) ───────────────────────
const POLICY_COLS = ['1AC', '1NC', '2AC', '2NC/1NR', '1AR', '2NR', '2AR'];
const PF_PRO_FIRST_COLS = ['Pro Case', 'Con Case', 'Con Rebuttal', 'Pro Rebuttal', 'Pro Summary', 'Con Summary', 'Pro FF', 'Con FF'];
const PF_CON_FIRST_COLS = ['Con Case', 'Pro Case', 'Pro Rebuttal', 'Con Rebuttal', 'Con Summary', 'Pro Summary', 'Con FF', 'Pro FF'];
const SHEETS_STOCK_ISSUES = ['Inherency', 'Harms', 'Solvency', 'Off 1', 'Off 2', 'Off 3', 'Off 4', 'RFD/Notes'];
const SHEETS_PF = ['Contention 1', 'Contention 2', 'Turns', 'Off 1', 'Off 2', 'RFD/Notes'];
const FLOW_NUM_ROWS = 60;

function flowColumns(data) {
  if (data?.customColumns?.length) return data.customColumns;
  if ((data?.event ?? 'policy') === 'pf')
    return data?.pfOrder === 'con-first' ? PF_CON_FIRST_COLS : PF_PRO_FIRST_COLS;
  return POLICY_COLS;
}

function makeDefaultFlowData(event) {
  const ev = event === 'pf' ? 'pf' : 'policy';
  const names = ev === 'pf' ? SHEETS_PF : SHEETS_STOCK_ISSUES;
  const cols = ev === 'pf' ? PF_PRO_FIRST_COLS : POLICY_COLS;
  return {
    event: ev, variant: 'stock-issues', pfOrder: 'pro-first',
    sheets: names.map((name) => ({ id: crypto.randomUUID(), name, cells: {} })),
    columnWidths: cols.map(() => 185), customColumns: null, fontSize: 13, zoom: 100,
  };
}

function findFlowMeta(index, query) {
  const q = (query ?? '').trim().toLowerCase();
  if (!q || !Array.isArray(index)) return null;
  return index.find((f) => (f.name ?? '').toLowerCase() === q)
      ?? index.find((f) => (f.name ?? '').toLowerCase().includes(q))
      ?? index.find((f) => f.id === query)
      ?? null;
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

// ── cross_ex_questions ──────────────────────────────────────────────────────────
// Mirrors the in-app "Cross-Ex Practice" panel in the speech doc viewer: given a
// document's text, produce targeted cross-examination questions grounded in the
// skill for the user's event. The server has no LLM, so it returns the event skill
// + the doc + a generation brief for the calling model to write the questions from.
server.tool(
  'cross_ex_questions',
  `Prepare targeted cross-examination questions (with model answers) for a speech document, the same way the in-app Cross-Ex Practice panel does.
Pass the document text. Returns the guide for the user's event plus a brief telling you to write pointed CX questions, each with a model answer the questioner should keep hidden until ready.
Use 'based_on' to generate more questions like a specific one.`,
  {
    highlighted_text: z.string().describe('Highlighted/underlined text from the speech document (tags, cites, emphasized runs)'),
    full_text: z.string().optional().describe('Full document text including un-highlighted body — only used to detect contradictions'),
    event: z.enum(['policy', 'pf', 'ld']).optional().describe('Override the debate event; defaults to the user\'s saved event'),
    count: z.number().optional().describe('How many questions to write (default 4, max 6)'),
    based_on: z.string().optional().describe('Generate new questions in the same spirit as this seed question'),
  },
  async ({ highlighted_text, full_text, event, count = 4, based_on }) => {
    const text = (highlighted_text ?? '').trim();
    if (!text) return { content: [{ type: 'text', text: 'No highlighted text provided.' }] };

    // Resolve the event → skill, falling back to the user's saved setting.
    let ev = event;
    if (!ev) {
      const settings = await readJson('app_settings');
      const topics = settings?.debateEvent ? (EVENT_MAP[settings.debateEvent]?.topics ?? []) : [];
      ev = topics.includes('pf') ? 'pf' : topics.includes('ld') ? 'ld' : 'policy';
    }
    const skillName = ev === 'pf' ? 'pf_debate' : ev === 'ld' ? 'ld_debate' : 'cx_debate';
    const eventLabel = ev === 'pf' ? 'Public Forum' : ev === 'ld' ? 'Lincoln-Douglas' : 'Policy (CX)';
    const skill = (await readSkill(skillName)) ?? '';
    const n = Math.min(Math.max(count, 1), 6);

    const brief = based_on
      ? `Write ${n} NEW cross-ex questions in the same spirit as this seed — same line of attack, fresh angles. Do not repeat it.\nSEED: ${based_on}`
      : `Decide whether this doc contains AFF content, NEG content, or BOTH, then write 3-6 cross-ex questions TOTAL distributed across the sides present, in proportion to each side's highlighted content (a side with far less content gets 0-1 questions).`;

    const fullSection = full_text?.trim()
      ? `## Full card text (un-highlighted body — only reference if it DIRECTLY and COMPLETELY CONTRADICTS the highlighted text in the same card)\n${(full_text ?? '').slice(0, 60000)}\n`
      : '';

    const out = [
      `# Cross-Ex Practice — ${eventLabel}`,
      ``,
      `${brief}`,
      ``,
      `RULES:`,
      `1. Questions must target claims in the HIGHLIGHTED TEXT only.`,
      `2. ONE EXCEPTION: if un-highlighted small text DIRECTLY and COMPLETELY CONTRADICTS highlighted text in the SAME card, you may question that contradiction.`,
      `3. Each question: 1-3 sentences MAX. Each answer: 2-4 sentences MAX.`,
      `4. No markdown emphasis (no **, *, __). Plain text only. Use single quotes around key phrases.`,
      `5. Be strategic — missing warrants, weak links, unqualified authors, contradictions, non-unique impacts, overclaims.`,
      ``,
      `## Telling Aff from Neg`,
      `- AFF speeches: 1AC, 2AC, 1AR, 2AR. NEG speeches: 1NC, 2NC, 1NR, 2NR.`,
      `- Aff content = plan/advocacy, advantages, solvency, case. Neg content = disads (DAs), counterplans (CPs), kritiks (Ks), topicality (T), and "AT:"/"A2:" answer blocks.`,
      `- Weight question counts by HIGHLIGHTED content per side, not small text. Group your output under Aff / Neg headers when both are present.`,
      ``,
      skill ? `## Event guide (${skillName})\n${skill.slice(0, 8000)}\n` : '',
      `## Highlighted text (tags, cites, underlined/highlighted runs)\n${text.slice(0, 40000)}\n`,
      fullSection,
    ].filter(Boolean).join('\n');

    return { content: [{ type: 'text', text: out }] };
  }
);

// ── cross_ex_trap_drill ─────────────────────────────────────────────────────────
// Mirrors the in-app "Harder questions" trap drill: produce setup questions that
// bait a wrong answer and spring a gotcha follow-up, for the calling model to run.
server.tool(
  'cross_ex_trap_drill',
  `Prepare a cross-ex TRAP DRILL for a speech document, like the in-app "Harder questions" feature.
Returns the event guide + doc + a brief telling you to write trap questions: a setup that looks innocent, the tempting wrong answer that springs it, the gotcha follow-up, the ideal trap-avoiding answer, and the lesson. Run the drill by asking the student the setup, then grading their typed answer.`,
  {
    highlighted_text: z.string().describe('Highlighted/underlined text from the speech document'),
    full_text: z.string().optional().describe('Full document text including un-highlighted body'),
    event: z.enum(['policy', 'pf', 'ld']).optional().describe('Override the debate event; defaults to the user\'s saved event'),
  },
  async ({ highlighted_text, full_text, event }) => {
    const text = (highlighted_text ?? '').trim();
    if (!text) return { content: [{ type: 'text', text: 'No highlighted text provided.' }] };

    let ev = event;
    if (!ev) {
      const settings = await readJson('app_settings');
      const topics = settings?.debateEvent ? (EVENT_MAP[settings.debateEvent]?.topics ?? []) : [];
      ev = topics.includes('pf') ? 'pf' : topics.includes('ld') ? 'ld' : 'policy';
    }
    const skillName = ev === 'pf' ? 'pf_debate' : ev === 'ld' ? 'ld_debate' : 'cx_debate';
    const eventLabel = ev === 'pf' ? 'Public Forum' : ev === 'ld' ? 'Lincoln-Douglas' : 'Policy (CX)';
    const skill = (await readSkill(skillName)) ?? '';

    const out = [
      `# Cross-Ex Trap Drill — ${eventLabel}`,
      ``,
      `Design 3 cross-ex TRAPS from the highlighted text. A trap is a setup question that looks innocent but where a careless answer walks the student into a devastating follow-up.`,
      `For each trap give: the setup question, the tempting WRONG answer that springs it, the gotcha follow-up that exploits the wrong answer, the disciplined ideal answer that avoids the trap, and a one-sentence lesson.`,
      `Run the drill one trap at a time: ask the setup, let the student answer, then tell them whether they avoided the trap or fell for it (spring the gotcha), what went wrong, and how to fix it. Keep questions 1-3 sentences and answers/feedback short. No markdown emphasis.`,
      ``,
      skill ? `## Event guide (${skillName})\n${skill.slice(0, 8000)}\n` : '',
      `## Highlighted text\n${text.slice(0, 40000)}\n`,
      full_text?.trim() ? `## Full card text\n${(full_text ?? '').slice(0, 60000)}\n` : '',
    ].filter(Boolean).join('\n');

    return { content: [{ type: 'text', text: out }] };
  }
);

// ── score_card_credibility ──────────────────────────────────────────────────────
// Mirrors the in-app "Card Credibility" panel in the speech doc viewer: given the
// doc's cards (tag + cite), score each one's evidentiary credibility. The server has
// no LLM, so it returns the cards plus a scoring brief for the calling model.
server.tool(
  'score_card_credibility',
  `Score the credibility of every evidence card in a speech document, the same way the in-app Card Credibility panel does.
Pass the cards as a list of { tag, cite } objects (the card's tag/headline plus the cite text that follows it). Returns a brief telling you to grade each card and a numbered list of the cards to score.
Judge ONLY from what the cite text states — never invent credentials, dates, or outlets that are not present.`,
  {
    cards: z.array(z.object({
      tag: z.string().describe('The card tag/headline'),
      cite: z.string().describe('The cite text that follows the tag (author, date, source, body)'),
    })).describe('The cards to score, in document order'),
  },
  async ({ cards }) => {
    const list = (cards ?? []).filter((c) => (c?.tag ?? '').trim() || (c?.cite ?? '').trim());
    if (!list.length) return { content: [{ type: 'text', text: 'No cards provided.' }] };

    const numbered = list
      .map((c, i) => `### Card ${i + 1}\nTAG: ${(c.tag ?? '').trim().slice(0, 600)}\nCITE: ${(c.cite ?? '').trim().slice(0, 600)}`)
      .join('\n\n');

    const out = [
      `# Card Credibility`,
      ``,
      `Score the credibility of each numbered card below as evidence. Return your results in the SAME ORDER as the cards are listed.`,
      ``,
      `For EACH card give:`,
      `- An OVERALL score from 0 to 10.`,
      `- A one-word VERDICT: Strong (8-10), Solid (6-7), Shaky (4-5), or Weak (0-3).`,
      `- Four SUB-SCORES, each 0-10: Author qualifications, Recency, Source quality, and Claim fit (does the cite actually support what the tag claims?).`,
      `- A short REASON (one or two sentences) for the overall score.`,
      `- A "PRESS" line: the single best cross-examination attack on this card's credibility.`,
      ``,
      `RULES:`,
      `1. Judge author qualifications and source quality ONLY from what the CITE text states. Never invent or assume credentials, dates, or outlets that are not present.`,
      `2. Score AUTHOR by domain match to the claim, not just credentials. If only an organization is named (no individual), use the org's reputation as a proxy (e.g. RAND/CBO/CRS high; ideologically-aligned think tanks mid; media low). If no qualifications are stated, score low and say so.`,
      `3. Score RECENCY by topic-specific decay: geopolitics/military/economic data decays fast; policy/public-health medium; theory/historical analysis slow. If no date is present, score Recency low and note the missing date — do not fabricate one.`,
      `4. Score SOURCE by a publication hierarchy: peer-reviewed journal > government report > established think tank > major newspaper > trade publication > op-ed > blog/unknown.`,
      `5. Score CLAIM FIT by whether the cite's apparent subject actually supports the tag — penalize tags that overclaim relative to what the source likely says.`,
      `6. Keep the reason and press line short and plain. No markdown emphasis (no **, *, __). Use single quotes around key phrases.`,
      ``,
      `## Cards to score (${list.length})`,
      numbered,
    ].join('\n');

    return { content: [{ type: 'text', text: out }] };
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

// ── list_flows ──────────────────────────────────────────────────────────────────
server.tool(
  'list_flows',
  "List all of the user's flow sheets (name, debate event, id). Call before read_flow or edit_flow_cell.",
  {},
  async () => {
    const index = await readJson('flows_index');
    if (!Array.isArray(index) || index.length === 0) return { content: [{ type: 'text', text: 'No flows exist yet.' }] };
    const text = index.map(f => `- "${f.name}" (${f.event}, id:${f.id})`).join('\n');
    return { content: [{ type: 'text', text: `${index.length} flow(s):\n${text}` }] };
  }
);

// ── read_flow ───────────────────────────────────────────────────────────────────
server.tool(
  'read_flow',
  "Read a flow's sheets, column headers, and every filled-in cell. Call before edit_flow_cell so you target the right cell.",
  { flow: z.string().describe('Flow name or id (case-insensitive)') },
  async ({ flow }) => {
    const index = await readJson('flows_index');
    const meta = findFlowMeta(index, flow);
    if (!meta) return { content: [{ type: 'text', text: `No flow named "${flow}" found. Use list_flows.` }] };
    const data = await readJson(`flow_data_${meta.id}`);
    const cols = flowColumns(data);
    if (!data?.sheets?.length) {
      return { content: [{ type: 'text', text: `Flow "${meta.name}" (${meta.event}) is empty. Columns: ${cols.join(' | ')}.` }] };
    }
    const out = [`Flow "${meta.name}" (${meta.event}). Columns: ${cols.map((c, i) => `${i + 1}.${c}`).join('  ')}`];
    data.sheets.forEach((sh, si) => {
      const cells = sh.cells ?? {};
      const rows = [];
      for (let r = 0; r < FLOW_NUM_ROWS; r++) {
        const parts = [];
        cols.forEach((c, ci) => { const v = cells[`${r}-${ci}`]; if (v && String(v).trim()) parts.push(`${c}: ${v}`); });
        if (parts.length) rows.push(`  Row ${r + 1} — ${parts.join(' | ')}`);
      }
      out.push(`\nSheet ${si + 1}: "${sh.name}"${rows.length ? '\n' + rows.join('\n') : ' (empty)'}`);
    });
    return { content: [{ type: 'text', text: out.join('\n') }] };
  }
);

// ── edit_flow_cell ──────────────────────────────────────────────────────────────
server.tool(
  'edit_flow_cell',
  "Set the value of a single cell in a flow sheet. Call read_flow first to learn column names and current contents. Columns are debate speeches (e.g. '1AC', '2NR'). Row is 1-based.",
  {
    flow:   z.string().describe('Flow name or id (case-insensitive)'),
    sheet:  z.string().optional().describe("Sheet name or 1-based number. Defaults to the first sheet."),
    column: z.string().describe("Column header name (e.g. '2NR') or 1-based column number."),
    row:    z.number().int().describe('Row number, 1-based.'),
    value:  z.string().describe('Text to put in the cell (overwrites existing content).'),
  },
  async ({ flow, sheet, column, row, value }) => {
    const index = await readJson('flows_index');
    const meta = findFlowMeta(index, flow);
    if (!meta) return { content: [{ type: 'text', text: `No flow named "${flow}" found. Use list_flows.` }] };

    let data = await readJson(`flow_data_${meta.id}`);
    if (!data?.sheets?.length) data = makeDefaultFlowData(meta.event);
    const cols = flowColumns(data);

    // Resolve sheet
    let sheetIdx = 0;
    if (sheet != null && String(sheet).trim() !== '') {
      const sArg = String(sheet).trim();
      const asNum = Number(sArg);
      if (Number.isInteger(asNum) && asNum >= 1 && asNum <= data.sheets.length) {
        sheetIdx = asNum - 1;
      } else {
        const lc = sArg.toLowerCase();
        let found = data.sheets.findIndex(sh => (sh.name ?? '').toLowerCase() === lc);
        if (found < 0) found = data.sheets.findIndex(sh => (sh.name ?? '').toLowerCase().includes(lc));
        if (found < 0) return { content: [{ type: 'text', text: `No sheet "${sArg}". Sheets: ${data.sheets.map(s => s.name).join(', ')}.` }] };
        sheetIdx = found;
      }
    }

    // Resolve column
    let colIdx = -1;
    const colArg = String(column).trim();
    const colNum = Number(colArg);
    if (Number.isInteger(colNum) && colNum >= 1 && colNum <= cols.length) colIdx = colNum - 1;
    else {
      colIdx = cols.findIndex(c => c.toLowerCase() === colArg.toLowerCase());
      if (colIdx < 0) colIdx = cols.findIndex(c => c.toLowerCase().includes(colArg.toLowerCase()));
    }
    if (colIdx < 0) return { content: [{ type: 'text', text: `No column "${colArg}". Columns: ${cols.join(', ')}.` }] };

    if (!Number.isInteger(row) || row < 1 || row > FLOW_NUM_ROWS) {
      return { content: [{ type: 'text', text: `Row must be between 1 and ${FLOW_NUM_ROWS}.` }] };
    }
    const rowIdx = row - 1;

    const sh = data.sheets[sheetIdx];
    sh.cells = { ...(sh.cells ?? {}), [`${rowIdx}-${colIdx}`]: String(value ?? '') };
    await writeJson(`flow_data_${meta.id}`, data);

    return { content: [{ type: 'text', text: `Set ${cols[colIdx]} (column ${colIdx + 1}), row ${row} on sheet "${sh.name}" of flow "${meta.name}" to: "${value}".` }] };
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
