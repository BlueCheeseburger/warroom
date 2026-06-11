import * as cheerio from 'cheerio';

export interface ScrapedTopics {
  policy: {
    current: string;
    next: string | null;
    season: string;
  };
  pf: {
    current: string;
    period: string;
    potentialNext: string[] | null;
  };
  ld: {
    current: string;
    period: string;
    potentialNext: string[] | null;
  };
  scrapedAt: string;
}

function periodFromHeading(h3: string, eventName: string): string {
  return h3
    .replace(new RegExp(`${eventName}\\s*Debate`, 'i'), '')
    .replace(/^[\s–—-]+/, '')
    .replace(/\bTopic\b\s*$/i, '')
    .trim();
}

interface CurrentTopics {
  policy: { current: string; next: string | null; season: string };
  pf: { current: string; period: string };
  ld: { current: string; period: string };
}

// Parse the "Current Topics" section. Resolutions live in nested <strong>/<p>
// under per-event <h3> headings (Divi toggle modules), so we walk elements in
// document order, track which <h3> we're under, and capture the first
// "Resolved: …" text per heading. The `captured` flag prevents the parent <p>
// and its child <strong> from both yielding the same resolution.
function parseCurrentTopics($: cheerio.CheerioAPI): CurrentTopics {
  const out: CurrentTopics = {
    policy: { current: '', next: null, season: '' },
    pf: { current: '', period: '' },
    ld: { current: '', period: '' },
  };
  let inCurrent = false;
  let h3 = '';
  let captured = false;

  $('h2, h3, strong, p, li').each((_i, el) => {
    const tag = (el as any).tagName?.toLowerCase();
    const text = $(el).text().replace(/\s+/g, ' ').trim();

    if (tag === 'h2') { inCurrent = /^current topics/i.test(text); h3 = ''; return; }
    if (tag === 'h3') { h3 = text; captured = false; return; }
    if (!inCurrent || captured) return;
    if (!/resolved:/i.test(text)) return;

    const m = text.match(/resolved:.*/i);
    const resolution = (m ? m[0] : text).trim();

    // Skip novice/secondary headings so they don't shadow the real topic.
    if (/novice/i.test(h3)) { captured = true; return; }

    const policyM = h3.match(/policy debate.*?(\d{4})\s*[–—-]\s*(\d{4})/i);
    if (policyM) {
      const season = `${policyM[1]}-${policyM[2]}`;
      if (!out.policy.current) { out.policy.current = resolution; out.policy.season = season; }
      else if (!out.policy.next) { out.policy.next = resolution; }
      captured = true; return;
    }
    if (/public forum/i.test(h3)) {
      if (!out.pf.current) { out.pf.current = resolution; out.pf.period = periodFromHeading(h3, 'Public Forum'); }
      captured = true; return;
    }
    if (/lincoln[- ]douglas/i.test(h3)) {
      if (!out.ld.current) { out.ld.current = resolution; out.ld.period = periodFromHeading(h3, 'Lincoln-Douglas'); }
      captured = true; return;
    }
    captured = true;
  });

  return out;
}

// Collect candidate resolutions from the "Potential Topics" section, scoped per
// event. The page nests these as <li>Resolved: …</li> under per-event headings
// (e.g. "Lincoln-Douglas Debate 2025-2026 Potential Topics"). We walk headings
// and list items in document order, tracking which event section we're inside,
// so LD candidates never bleed into PF. De-duping is required because the same
// resolution appears in several places on the page (TOC, past topics, etc.).
function collectPotentialsByEvent($: cheerio.CheerioAPI): { pf: string[]; ld: string[] } {
  const result: { pf: string[]; ld: string[] } = { pf: [], ld: [] };
  const seen = { pf: new Set<string>(), ld: new Set<string>() };
  let inPotentials = false;
  let event: 'pf' | 'ld' | null = null;

  $('h2, h3, li').each((_i, el) => {
    const tag = (el as any).tagName?.toLowerCase();
    const text = $(el).text().replace(/\s+/g, ' ').trim();

    if (tag === 'h2') {
      inPotentials = /^potential topics/i.test(text);
      event = null;
      return;
    }
    if (tag === 'h3') {
      if (!inPotentials) { event = null; return; }
      if (/lincoln[- ]douglas/i.test(text)) event = 'ld';
      else if (/public forum/i.test(text)) event = 'pf';
      else event = null;
      return;
    }
    // list item
    if (!inPotentials || !event) return;
    if (!/^resolved:/i.test(text)) return;
    if (text.length < 15 || text.length > 400) return;
    if (seen[event].has(text)) return;
    seen[event].add(text);
    result[event].push(text);
  });

  return result;
}

export async function scrapeNSDATopics(): Promise<ScrapedTopics | null> {
  try {
    const res = await fetch('https://www.speechanddebate.org/topics/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) {
      console.error('[TopicScraper] HTTP', res.status);
      return null;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const current = parseCurrentTopics($);
    const potentials = collectPotentialsByEvent($);
    // The page lists the selected (current) topic among the potentials; drop it
    // so the "potential next" list only shows topics still in contention.
    const pfPotentialNext = potentials.pf.filter((t) => t !== current.pf.current);
    const ldPotentialNext = potentials.ld.filter((t) => t !== current.ld.current);

    return {
      policy: {
        current: current.policy.current || '(Policy topic not found)',
        next: current.policy.next,
        season: current.policy.season || new Date().getFullYear() + '-' + (new Date().getFullYear() + 1),
      },
      pf: {
        current: current.pf.current || '(PF topic not found)',
        period: current.pf.period,
        potentialNext: pfPotentialNext.length > 0 ? pfPotentialNext : null,
      },
      ld: {
        current: current.ld.current || '(LD topic not found)',
        period: current.ld.period,
        potentialNext: ldPotentialNext.length > 0 ? ldPotentialNext : null,
      },
      scrapedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[TopicScraper] Error:', err);
    return null;
  }
}
