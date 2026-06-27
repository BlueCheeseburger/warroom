import Fuse from 'fuse.js';
import { View, FlowMeta } from '../store/appStore';
import { DB } from '../types';

export interface SearchEntry {
  type: 'case' | 'speechdoc' | 'flow' | 'opponent' | 'judge' | 'chat';
  id: string;
  title: string;
  subtitle?: string;
  haystack: string;   // title + keywords joined with space — what Fuse searches
  view: View;
}

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

  // Opponents
  for (const o of Object.values(db.opponents)) {
    entries.push({
      type: 'opponent',
      id: o.id,
      title: o.teamName,
      subtitle: o.school,
      haystack: o.teamName + ' ' + o.school + ' ' + o.notes,
      view: { kind: 'opponent', opponentId: o.id },
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
