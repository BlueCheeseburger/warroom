// Persists per-multi-pane-combination layout (pane widths, which panes have
// their outline open, and a sidebar-expanded override) keyed by the exact,
// ordered set of doc paths open together. A different set of docs — even
// just swapping which pane a file is in — is a different combination and
// starts fresh. Single-pane viewing never touches this (nothing to combine).

const STORAGE_KEY = 'warroom-doc-combo-layouts';
const MAX_ENTRIES = 60; // cap so this can't grow unbounded over a long-lived install

export interface ComboLayout {
  paneWidths?: number[]; // fractions summing to 1, one per open pane, in pane order
  outlineOpen?: boolean[]; // one per open pane, in pane order
  sidebarExpanded?: boolean; // manual override recorded while this combo was active; absent = no override
}

/**
 * Builds a stable key from the doc paths currently open across panes, in
 * pane order. Returns null when fewer than 2 panes actually have a resolved
 * file — a single pane (or a pane that's still on the empty drop-zone) isn't
 * a "combination" worth remembering.
 */
export function comboKeyFor(paths: (string | undefined)[]): string | null {
  const resolved = paths.filter((p): p is string => !!p);
  if (resolved.length < 2) return null;
  return resolved.join('␟'); // unit-separator-ish char, won't collide with real paths
}

function readAll(): Record<string, ComboLayout> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, ComboLayout>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota errors — layout memory is a nice-to-have, not critical */
  }
}

export function loadComboLayout(key: string | null): ComboLayout | null {
  if (!key) return null;
  return readAll()[key] ?? null;
}

/** Shallow-merges `patch` into whatever's saved for `key`, evicting the
 * oldest entry if the cap is exceeded (insertion order = recency-ish). */
export function saveComboLayout(key: string | null, patch: Partial<ComboLayout>) {
  if (!key) return;
  const all = readAll();
  const existing = all[key] ?? {};
  delete all[key]; // re-insert at the end so key order tracks recency
  all[key] = { ...existing, ...patch };
  const keys = Object.keys(all);
  if (keys.length > MAX_ENTRIES) delete all[keys[0]];
  writeAll(all);
}
