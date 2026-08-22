#!/usr/bin/env node
/**
 * warroom-mcp — exposes Warroom's data as a READ-ONLY MCP server for troubleshooting
 * and reference. Deliberately has no write/mutate tools and no live external-site
 * lookups (Tabroom judge/tournament search) — see CLAUDE.md's "Warroom MCP" section.
 *
 * Reads from the same userData directory the Electron app writes to, so
 * Claude always sees live data: current topic, saved cases, tournaments, etc.
 *
 * Tools:
 *   get_warroom_context     — topic, event, tournament/round history (same as system prompt)
 *   get_skill               — load a skill .md file by name
 *   cross_ex_questions      — prep targeted cross-ex questions for a speech doc (mirrors in-app Cross-Ex Practice; splits Aff/Neg)
 *   cross_ex_trap_drill     — prep a cross-ex trap drill (mirrors in-app "Harder questions")
 *   score_card_credibility  — prep a credibility scoring pass for a speech doc's cards (mirrors in-app Card Credibility)
 *   outweigh_practice_round — run one round of the in-app "Outweigh" impact-calculus drill
 *   fetch_article           — fetch readable text from a URL
 *   list_flows / read_flow  — browse the user's flow sheets
 *   search_warroom          — search across cases, opponents, judges, tournaments, and topics
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

// ─── Flow helpers (mirror of src/components/FlowView.tsx) ───────────────────────
const POLICY_COLS = ['1AC', '1NC', '2AC', '2NC/1NR', '1AR', '2NR', '2AR'];
const PF_PRO_FIRST_COLS = ['Pro Case', 'Con Case', 'Con Rebuttal', 'Pro Rebuttal', 'Pro Summary', 'Con Summary', 'Pro FF', 'Con FF'];
const PF_CON_FIRST_COLS = ['Con Case', 'Pro Case', 'Pro Rebuttal', 'Con Rebuttal', 'Con Summary', 'Pro Summary', 'Con FF', 'Pro FF'];
const FLOW_NUM_ROWS = 60;

// Flow cells are stored as HTML (rich text). Strip tags for plain-text output.
function stripFlowHtml(s) {
  if (!s) return '';
  if (!/[<&]/.test(String(s))) return String(s);
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .trim();
}

function flowColumns(data) {
  if (data?.customColumns?.length) return data.customColumns;
  if ((data?.event ?? 'policy') === 'pf')
    return data?.pfOrder === 'con-first' ? PF_CON_FIRST_COLS : PF_PRO_FIRST_COLS;
  return POLICY_COLS;
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
Pass the document text. Returns the guide for the user's event plus a brief telling you to write pointed CX questions, each with the likely opponent answer (kept hidden until ready) and a separate one-line "Press next" follow-up to run after that answer.
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
      `3. Each question: 1-3 sentences MAX. Each answer: 2-3 sentences MAX — write ONLY the likely opponent response, in the opponent's voice.`,
      `4. Do NOT fold your own strategy advice into the answer. Give the follow-up separately, as a "Press next:" line: ONE sentence addressed to the reader naming the best follow-up to run after that answer, starting with a verb ("Push on…", "Make them defend…").`,
      `5. No markdown emphasis (no **, *, __). Plain text only. Use single quotes around key phrases.`,
      `6. Be strategic — missing warrants, weak links, unqualified authors, contradictions, non-unique impacts, overclaims.`,
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

// ── list_flows ──────────────────────────────────────────────────────────────────
server.tool(
  'list_flows',
  "List all of the user's flow sheets (name, debate event, id). Call before read_flow.",
  {},
  async () => {
    const index = await readJson('flows_index');
    if (!Array.isArray(index) || index.length === 0) return { content: [{ type: 'text', text: 'No flows exist yet.' }] };
    const text = index.map(f => `- "${f.name}" (${f.event}, id:${f.id})${f.live ? ' [LIVE — being co-edited with the team in realtime]' : ''}`).join('\n');
    return { content: [{ type: 'text', text: `${index.length} flow(s):\n${text}` }] };
  }
);

// ── read_flow ───────────────────────────────────────────────────────────────────
server.tool(
  'read_flow',
  "Read a flow's sheets, column headers, and every filled-in cell.",
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
        cols.forEach((c, ci) => { const v = stripFlowHtml(cells[`${r}-${ci}`]); if (v && v.trim()) parts.push(`${c}: ${v}`); });
        if (parts.length) rows.push(`  Row ${r + 1} — ${parts.join(' | ')}`);
      }
      out.push(`\nSheet ${si + 1}: "${sh.name}"${rows.length ? '\n' + rows.join('\n') : ' (empty)'}`);
    });
    return { content: [{ type: 'text', text: out.join('\n') }] };
  }
);

// ── outweigh_practice_round ──────────────────────────────────────────────────────
// Mirrors the in-app "Outweigh" game: the server has no LLM, so it returns a brief
// telling the calling model how to run one full round of the impact-calc drill —
// present an opposing impact, react to the user's impact + calc, deliver a short
// rebuttal, then judge the exchange. Includes an explicit instruction to grade its
// own rebuttal independently and blind, mirroring the app's bias-avoidance design
// (in-app, that grading is a separate stateless callAI() request that's never told
// it authored the rebuttal — here, the calling model should apply the same discipline).
server.tool(
  'outweigh_practice_round',
  `Run one round of Warroom's "Outweigh" impact-calculus practice game for a policy or Public Forum debater. Returns a brief telling the calling model how to invent an opposing impact, react to the user's impact + calc, deliver a short rebuttal, and then judge the exchange — including a separate, blind grade of its own rebuttal so the score isn't biased by self-recognition.
Pass a difficulty, an event (policy or pf), and optionally topic material (pasted case/card text, the current resolution, a side preference, or notes) to ground the scenario in something real instead of leaving it fully improvised.`,
  {
    difficulty: z.enum(['novice', 'jv', 'varsity']).describe('Novice = concrete impacts, no theory. JV = classic impacts (nuclear war, bioweapons, hegemony). Varsity = extinction/existential impacts and framework wars.'),
    event: z.enum(['policy', 'pf']).default('policy').describe('policy = CX/policy debate (Aff/Neg, plans/DAs/CPs). pf = Public Forum (Pro/Con, no plan — weighing happens in Summary/Final Focus).'),
    topicMaterial: z.string().optional().describe('Optional: pasted case/card text, the current resolution for this event, a side preference (e.g. "I want to argue Aff" or "Pro"), or any notes to ground the scenario in a real topic instead of an invented one.'),
  },
  async ({ difficulty, event, topicMaterial }) => {
    const tierLine = {
      novice: 'NOVICE: simple, concrete impacts (recession, an outbreak, a regional conflict). No extinction/existential framing, no framework wars — just magnitude/probability/timeframe.',
      jv: 'JV: classic impacts (nuclear war, bioweapons, hegemony, economic collapse). Engage scope, probability chains, timeframe, reversibility.',
      varsity: 'VARSITY: extinction/existential matchups and framework-level clashes. Win the metric before the calc resolves.',
    }[difficulty];

    const eventLine = event === 'pf'
      ? 'PUBLIC FORUM: use Pro/Con terminology, never Aff/Neg. No plan or counterplan — arguments are about whether the resolution is true/desirable on balance. Weighing should read as clear, efficient Summary/Final Focus-style comparison — avoid policy jargon ("solvency," "the DA," "the link") and keep the register accessible while staying substantively rigorous.'
      : 'POLICY (CX): use Aff/Neg terminology, never Pro/Con. Impacts are typically tied to the plan/counterplan action (a DA the plan triggers, or a case impact the plan solves).';

    const out = [
      `# Outweigh — impact-calculus practice round (${difficulty}, ${event})`,
      ``,
      `You are running a live impact-calculus drill against a competitive debater. Play the OPPONENT across the exchange, then judge it. Event: ${eventLine} Difficulty: ${tierLine}`,
      topicMaterial ? `\nGround the scenario in this material instead of inventing an unrelated topic:\n${topicMaterial}\n` : '',
      `## Steps`,
      `1. **Present your impact** — invent a brief realistic round context (topic + who's arguing what), then give YOUR impact: a claim + a 1-2 sentence warrant, rated on magnitude/probability/timeframe/reversibility.`,
      `2. **Wait for the user's impact + calculus** — they'll give their own impact and explain why it outweighs yours. Don't invent their answer for them.`,
      `3. **Deliver a rebuttal** — a tight 1-2 minute speech (150-260 words) defending your impact and attacking theirs on a specific dimension (magnitude, probability, timeframe, reversibility, or breadth). Use real in-round moves ("their scenario requires X then Y then Z", "timeframe outweighs — we solve before theirs triggers"). Don't invent fake evidence or misrepresent what they wrote.`,
      `4. **Take the user's final shot** (their last word), then judge the round:`,
      `   - Decide the winner (user / you / tie) and score the user's calc work 1-10 with a written verdict, dimension-by-dimension feedback, and concrete tips.`,
      `   - IMPORTANT — separately and independently grade YOUR OWN rebuttal from step 3 on its argumentative merits (1-10 + a short critique), as if a neutral third party were grading it cold. Don't let recognizing it as your own writing bias the score, and don't let the round's overall winner influence it — a losing debater can still have delivered a sharp, well-warranted rebuttal, and a winning one can have been sloppy.`,
      ``,
      `Do all four steps in order, pausing for the user's actual input at steps 2 and 4 rather than inventing what they'd say.`,
    ].filter(Boolean).join('\n');

    return { content: [{ type: 'text', text: out }] };
  }
);

// ── search_warroom ─────────────────────────────────────────────────────────────
server.tool(
  'search_warroom',
  `Search across all Warroom data: cases (including keyword-indexed content), opponents, judges, tournaments, and current topics.
Returns ranked results grouped by type. Covers everything persisted in db.json and topics.json.
Note: speech docs, flows, and AI chat history live in the app's browser localStorage and are not accessible from here — use the in-app search palette (Cmd+K) to search those.`,
  {
    query: z.string().describe('Search term — can be a topic keyword, team name, case name, judge name, argument, etc.'),
    types: z.array(z.enum(['case', 'opponent', 'judge', 'tournament', 'topic'])).optional()
      .describe('Restrict to these types (omit for all)'),
    limit: z.number().optional().describe('Max total results to return (default 20)'),
  },
  async ({ query, types, limit = 20 }) => {
    if (!query.trim()) return { content: [{ type: 'text', text: 'Please provide a search query.' }] };

    const [db, topics] = await Promise.all([readJson('db.json'), readJson('topics.json')]);
    const q = query.toLowerCase();
    const words = q.split(/\s+/).filter(w => w.length >= 2);

    function score(text) {
      if (!text) return 0;
      const t = text.toLowerCase();
      if (t.includes(q)) return 100;
      return words.reduce((s, w) => s + (t.includes(w) ? 10 : 0), 0);
    }

    const results = [];
    const wantAll = !types || types.length === 0;

    if (db) {
      // Cases
      if (wantAll || types.includes('case')) {
        for (const c of Object.values(db.cases ?? {})) {
          const haystack = [c.name, c.ocSource?.teamName, c.ocSource?.label, ...(c.searchKeywords ?? [])].join(' ');
          const s = score(haystack);
          if (s > 0) results.push({ type: 'case', score: s, data: c });
        }
      }
      // Opponents
      if (wantAll || types.includes('opponent')) {
        for (const o of Object.values(db.opponents ?? {})) {
          const disc = o.disclosures ?? {};
          const discParts = [
            disc.aff?.name,
            ...(disc.neg ?? []).map(p => p.name),
            ...(disc.rawCites ?? []).map(c => c.title),
            ...(disc.rawRounds ?? []).map(r => (r.tournament ?? '').replace(/^\d+---/, '')),
          ].filter(Boolean).join(' ');
          const haystack = [o.teamName, o.school, o.notes, discParts].join(' ');
          const s = score(haystack);
          if (s > 0) results.push({ type: 'opponent', score: s, data: o, discParts });
        }
      }
      // Judges
      if (wantAll || types.includes('judge')) {
        for (const j of Object.values(db.judges ?? {})) {
          const s = score([j.name, j.institution, j.paradigm].join(' '));
          if (s > 0) results.push({ type: 'judge', score: s, data: j });
        }
      }
      // Tournaments
      if (wantAll || types.includes('tournament')) {
        for (const t of Object.values(db.tournaments ?? {})) {
          const s = score([t.name, t.location, t.event_type].join(' '));
          if (s > 0) results.push({ type: 'tournament', score: s, data: t });
        }
      }
    }

    // Topics
    if (topics && (wantAll || types.includes('topic'))) {
      const eventMap = { policy: 'Policy', pf: 'Public Forum', ld: 'Lincoln-Douglas' };
      for (const [key, label] of Object.entries(eventMap)) {
        const res = topics[key]?.current;
        if (!res || res.includes('not found')) continue;
        const s = score(res + ' ' + label);
        if (s > 0) results.push({ type: 'topic', score: s, label, resolution: res });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, limit);

    if (top.length === 0) {
      return { content: [{ type: 'text', text: `No results found for "${query}".` }] };
    }

    const lines = [`**Search results for "${query}"** (${top.length} of ${results.length} matches)\n`];
    for (const r of top) {
      if (r.type === 'case') {
        const c = r.data;
        lines.push(`📁 **Case** — ${c.name} (${(c.side ?? '').toUpperCase()})${c.ocSource ? ` · ${c.ocSource.teamName}` : ''}`);
        if (c.searchKeywords?.length) {
          const kws = c.searchKeywords.filter(k => k.includes(q.split(' ')[0]) || words.some(w => k.includes(w))).slice(0, 6);
          if (kws.length) lines.push(`  Keywords: ${kws.join(', ')}`);
        }
      } else if (r.type === 'opponent') {
        const o = r.data;
        lines.push(`👥 **Opponent** — ${o.teamName}${o.school ? ` (${o.school})` : ''}`);
        if (r.discParts) {
          const snippet = r.discParts.slice(0, 200);
          lines.push(`  Disclosures: ${snippet}${r.discParts.length > 200 ? '…' : ''}`);
        }
      } else if (r.type === 'judge') {
        const j = r.data;
        lines.push(`⚖️ **Judge** — ${j.name}${j.institution ? ` (${j.institution})` : ''}`);
        if (j.paradigm) lines.push(`  Paradigm: ${j.paradigm.slice(0, 200)}${j.paradigm.length > 200 ? '…' : ''}`);
      } else if (r.type === 'tournament') {
        const t = r.data;
        lines.push(`🏆 **Tournament** — ${t.name}${t.location ? ` · ${t.location}` : ''}${t.date ? ` · ${new Date(t.date).toLocaleDateString()}` : ''}`);
      } else if (r.type === 'topic') {
        lines.push(`📌 **Topic (${r.label})** — ${r.resolution}`);
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
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
