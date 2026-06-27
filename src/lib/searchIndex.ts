import Fuse from 'fuse.js';
import { View, FlowMeta } from '../store/appStore';
import { DB } from '../types';

export interface SearchEntry {
  type: 'case' | 'speechdoc' | 'flow' | 'opponent' | 'judge' | 'chat' | 'tournament' | 'topic';
  id: string;
  title: string;
  subtitle?: string;
  haystack: string;   // title + keywords joined with space — what Fuse searches
  view: View;
}

// localStorage key holding cached speech-doc keyword sets.
// Shape: { [docPath]: { size: number; ver: number; keywords: string[] } }
export const SPEECHDOC_KW_KEY = 'warroom-speechdoc-keywords';
const SPEECHDOC_RECENTS_KEY = 'warroom-speech-doc-recents';

// Number of distilled keywords kept per document. Large enough that meaningful
// but non-dominant terms (e.g. "arctic" in a domain-awareness aff) are retained.
export const DOC_KEYWORD_CAP = 2000;
// Bump to invalidate every cached keyword set when the extraction logic changes.
export const DOC_KEYWORD_VERSION = 2;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had', 'her',
  'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new',
  'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say',
  'she', 'too', 'use', 'that', 'this', 'with', 'have', 'from', 'they', 'will', 'would',
  'there', 'their', 'what', 'about', 'which', 'when', 'make', 'like', 'time', 'just',
  'know', 'take', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'other',
  'than', 'then', 'these', 'those', 'been', 'come', 'here', 'more', 'also', 'such',
  'well', 'only', 'even', 'most', 'many', 'much', 'both', 'each', 'long', 'over',
  'does', 'need', 'very', 'still', 'back', 'after', 'again', 'before', 'being', 'every',
  'never', 'under', 'while', 'should', 'between', 'through', 'because', 'without',
  'might', 'must', 'shall', 'were', 'unto', 'said', 'upon', 'yet', 'another', 'given',
  'whether', 'within', 'made', 'place', 'used', 'show', 'want', 'thus', 'where', 'same',
  'last', 'high', 'large', 'small', 'since', 'going', 'think', 'thing', 'things',
  'first', 'second', 'third', 'around', 'using', 'among', 'away', 'find', 'found',
  'form', 'keep', 'left', 'move', 'next', 'open', 'part', 'right', 'turn', 'along',
  'already', 'always', 'across', 'against', 'became', 'become', 'comes', 'during',
  'either', 'enough', 'especially', 'following', 'goes', 'gotten', 'however', 'indeed',
  'instead', 'itself', 'keeps', 'known', 'later', 'maybe', 'means', 'merely', 'myself',
  'near', 'neither', 'nothing', 'often', 'once', 'perhaps', 'point', 'rather', 'really',
  'seem', 'seems', 'simply', 'somehow', 'something', 'sometimes', 'somewhat', 'somewhere',
  'soon', 'taken', 'though', 'told', 'tries', 'truly', 'usually', 'whereas', 'words',
  'world', 'years',
]);

// Numbers 1-10 as strings — filtered out as pure noise
const SMALL_NUMBERS = new Set(['1','2','3','4','5','6','7','8','9','10']);

export function extractKeywords(text: string, n = 150): string[] {
  const lower = text.toLowerCase();
  const noHtml = lower.replace(/<[^>]+>/g, ' ');
  const tokens = noHtml.split(/[^\w$]+/g);

  const freq = new Map<string, number>();
  for (const tok of tokens) {
    if (tok.length < 3) continue;
    if (STOPWORDS.has(tok)) continue;
    if (SMALL_NUMBERS.has(tok)) continue;
    freq.set(tok, (freq.get(tok) ?? 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([word]) => word);
}

// Strip a leading markdown/heading prefix from a cite title (mirrors OpponentProfile).
function cleanTitle(s: string): string {
  return (s ?? '').replace(/^#+\s*/, '').trim();
}

// Concatenate all the searchable disclosure text for an opponent: disclosed aff
// name, disclosed neg position names, and every disclosure title (cite titles +
// round tournament names). File CONTENTS are never read here — titles only.
export function opponentDisclosureText(disc: any): string {
  const parts: string[] = [];
  if (disc?.aff?.name) parts.push(cleanTitle(disc.aff.name));
  if (Array.isArray(disc?.neg)) {
    for (const p of disc.neg) if (p?.name) parts.push(cleanTitle(p.name));
  }
  if (Array.isArray(disc?.rawCites)) {
    for (const c of disc.rawCites) {
      const t = c?.title ?? '';
      if (t) parts.push(cleanTitle(t));
    }
  }
  if (Array.isArray(disc?.rawRounds)) {
    for (const r of disc.rawRounds) {
      const tourn = (r?.tournament ?? '').replace(/^\d+---/, '');
      if (tourn) parts.push(tourn);
    }
  }
  return parts.join(' ');
}

interface SpeechDocKwEntry { size: number; ver: number; keywords: string[] }

// Reads the cached speech-doc keyword sets.
function getSpeechDocKeywords(): Record<string, SpeechDocKwEntry> {
  try { return JSON.parse(localStorage.getItem(SPEECHDOC_KW_KEY) ?? '{}'); }
  catch { return {}; }
}

// Distills + caches keywords for every recent speech doc whose file size or
// extraction version has changed. Returns true if the cache was modified, so
// callers can rebuild the index. Best-effort; safe to call repeatedly.
export async function refreshSpeechDocKeywords(): Promise<boolean> {
  let changed = false;
  try {
    const recents: { path: string; name: string }[] =
      JSON.parse(localStorage.getItem(SPEECHDOC_RECENTS_KEY) ?? '[]');
    const cache = getSpeechDocKeywords();

    for (const d of recents) {
      try {
        const stat = await window.warroom?.fs.fileSize(d.path);
        const size = stat?.ok ? (stat.size ?? -1) : -1;
        const cached = cache[d.path];
        if (cached && cached.ver === DOC_KEYWORD_VERSION && cached.size === size) continue;
        const res = await window.warroom?.fs.extractDocxText(d.path);
        if (!res?.ok || !res.text) continue;
        cache[d.path] = {
          size,
          ver: DOC_KEYWORD_VERSION,
          keywords: extractKeywords(res.text, DOC_KEYWORD_CAP),
        };
        changed = true;
      } catch { /* skip this doc */ }
    }

    // Drop cache entries for docs no longer in recents.
    const livePaths = new Set(recents.map((r) => r.path));
    for (const k of Object.keys(cache)) {
      if (!livePaths.has(k)) { delete cache[k]; changed = true; }
    }

    if (changed) localStorage.setItem(SPEECHDOC_KW_KEY, JSON.stringify(cache));
  } catch { /* best-effort */ }
  return changed;
}

// Speech docs live in the recents list (localStorage), not the DB. Index each by
// file name plus its cached content keywords.
export function buildSpeechDocIndex(): SearchEntry[] {
  try {
    const recents: { path: string; name: string }[] =
      JSON.parse(localStorage.getItem(SPEECHDOC_RECENTS_KEY) ?? '[]');
    const kwCache = getSpeechDocKeywords();
    return recents.map((d) => {
      const name = d.name.replace(/\.docx$/i, '');
      const keywords = kwCache[d.path]?.keywords?.join(' ') ?? '';
      return {
        type: 'speechdoc' as const,
        id: d.path,
        title: name,
        subtitle: 'Speech doc',
        haystack: name + ' ' + keywords,
        view: { kind: 'speech-doc' as const, docPath: d.path },
      };
    });
  } catch {
    return [];
  }
}

// Topics come from the main process (async IPC). Indexes the current resolution
// for each event the app knows about.
export async function buildTopicsIndex(): Promise<SearchEntry[]> {
  try {
    const stored = await window.warroom?.topics?.getStored?.();
    if (!stored) return [];
    const out: SearchEntry[] = [];
    const events: { tab: 'policy' | 'pf' | 'ld'; label: string }[] = [
      { tab: 'policy', label: 'Policy' },
      { tab: 'pf', label: 'Public Forum' },
      { tab: 'ld', label: 'Lincoln-Douglas' },
    ];
    for (const { tab, label } of events) {
      const res: string | undefined = stored[tab]?.current;
      if (!res || res.includes('not found')) continue;
      out.push({
        type: 'topic',
        id: `topic-${tab}`,
        title: res,
        subtitle: `${label} topic`,
        haystack: res + ' ' + label,
        view: { kind: 'topics', tab },
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function buildCheapIndex(db: DB, flowsIndex: FlowMeta[]): SearchEntry[] {
  const entries: SearchEntry[] = [];

  // Cases
  for (const c of Object.values(db.cases)) {
    entries.push({
      type: 'case',
      id: c.id,
      title: c.name,
      subtitle: c.side.toUpperCase() + (c.ocSource ? ` · ${c.ocSource.teamName}` : ''),
      haystack:
        c.name + ' ' +
        (c.ocSource ? c.ocSource.teamName + ' ' + c.ocSource.label : '') +
        ' ' + (c.searchKeywords?.join(' ') ?? ''),
      view: { kind: 'case', caseId: c.id },
    });
  }

  // Opponents — index disclosed aff/neg position names + disclosure titles
  // (titles only, never file contents).
  for (const o of Object.values(db.opponents)) {
    const disc = (o.disclosures ?? {}) as any;
    const discText = opponentDisclosureText(disc);
    entries.push({
      type: 'opponent',
      id: o.id,
      title: o.teamName,
      subtitle: o.school,
      haystack: o.teamName + ' ' + o.school + ' ' + (o.notes ?? '') + ' ' + discText,
      view: { kind: 'opponent', opponentId: o.id },
    });
  }

  // Tournaments
  for (const t of Object.values(db.tournaments)) {
    entries.push({
      type: 'tournament',
      id: t.id,
      title: t.name,
      subtitle: t.location || (t.date ? new Date(t.date).toLocaleDateString() : undefined),
      haystack: t.name + ' ' + (t.location ?? '') + ' ' + (t.event_type ?? ''),
      view: { kind: 'tournament', tournamentId: t.id },
    });
  }

  // Judges
  for (const j of Object.values(db.judges)) {
    entries.push({
      type: 'judge',
      id: j.id,
      title: j.name,
      subtitle: j.institution,
      haystack: j.name + ' ' + j.institution + ' ' + (j.paradigm ?? ''),
      view: { kind: 'judge', judgeId: j.id },
    });
  }

  // Flows (cell content indexed separately via buildFlowCellIndex)
  for (const f of flowsIndex) {
    entries.push({
      type: 'flow',
      id: f.id,
      title: f.name,
      subtitle: f.event,
      haystack: f.name + ' ' + f.event,
      view: { kind: 'flow', flowId: f.id },
    });
  }

  return entries;
}

export function buildChatIndex(): SearchEntry[] {
  try {
    const metas: { id: string; title: string; updatedAt: string }[] =
      JSON.parse(localStorage.getItem('warroom-gemini-conversations') ?? '[]');

    return metas.map((meta) => {
      const messages: { role: string; parts?: { text: string }[] }[] =
        JSON.parse(localStorage.getItem('warroom-gemini-conv-' + meta.id) ?? '[]');
      const body = messages.flatMap((m) => m.parts?.map((p) => p.text) ?? []).join(' ');
      const keywords = extractKeywords(body, 150).join(' ');
      const title = meta.title || 'Warroom AI Chat';
      const subtitle = meta.updatedAt
        ? new Date(meta.updatedAt).toLocaleDateString()
        : undefined;
      return {
        type: 'chat' as const,
        id: meta.id,
        title,
        subtitle,
        haystack: title + ' ' + keywords,
        view: { kind: 'home' as const },
      };
    });
  } catch {
    return [];
  }
}

export function search(entries: SearchEntry[], query: string): SearchEntry[] {
  if (!query.trim()) return [];
  const fuse = new Fuse(entries, {
    keys: [
      { name: 'title', weight: 0.7 },
      { name: 'haystack', weight: 0.3 },
    ],
    threshold: 0.38,
    ignoreLocation: true,
    minMatchCharLength: 2,
    includeScore: true,
  });
  return fuse.search(query).map((r) => r.item);
}

export async function buildFlowCellIndex(
  flowId: string,
  flowName: string,
  flowEvent: string,
): Promise<SearchEntry | null> {
  try {
    const data = await window.warroom?.storage.read(`flow_data_${flowId}`);
    if (!data?.sheets) return null;
    const allText = (data.sheets as any[])
      .flatMap((s: any) => Object.values(s.cells ?? {}) as string[])
      .join(' ');
    return {
      type: 'flow',
      id: flowId,
      title: flowName,
      subtitle: flowEvent,
      haystack: flowName + ' ' + flowEvent + ' ' + allText,
      view: { kind: 'flow', flowId },
    };
  } catch {
    return null;
  }
}
