// Persists per-multi-pane-combination layout (pane widths, which panes have
// their outline open, and a sidebar-expanded override) keyed by the exact,
// ordered set of doc paths open together. A different set of docs — even
// just swapping which pane a file is in — is a different combination and
// starts fresh. Single-pane viewing never touches this (nothing to combine).

// v2: the v1 key accumulated a junk entry every time the user clicked a doc in
// the sidebar while compare panes were open (each click changed the open set,
// and every changed set registered as a brand-new view). Those stale entries
// can't be told apart from intentional ones after the fact, so the key is
// bumped to drop them — these are shortcuts that rebuild themselves as soon as
// you open docs side by side again, not user data.
const STORAGE_KEY = 'warroom-doc-combo-layouts-v2';
const MAX_ENTRIES = 60; // cap so this can't grow unbounded over a long-lived install

export interface ComboLayout {
  paneWidths?: number[]; // fractions summing to 1, one per open pane, in pane order
  outlineOpen?: boolean[]; // one per open pane, in pane order
  sidebarExpanded?: boolean; // manual override recorded while this combo was active; absent = no override
  paths?: string[]; // the doc paths this combo is made of, in pane order — lets the sidebar re-open it
  savedAt?: string; // ISO timestamp of when this combo was last open, for newest-first listing
}

/** One saved compare view, as the sidebar lists it. */
export interface SavedComboView extends ComboLayout {
  key: string;
  paths: string[];
}

export const COMBO_LAYOUTS_CHANGED = 'warroom-doc-combos-changed';

function announce() {
  window.dispatchEvent(new CustomEvent(COMBO_LAYOUTS_CHANGED));
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
  announce();
}

/**
 * Records that this combination of docs is currently open, so it shows up in
 * the sidebar's compare-views list and can be re-opened as a unit later.
 * Called whenever a multi-pane view settles on a set of docs.
 */
/**
 * Records the combination of docs currently open side by side.
 *
 * `supersedesKey` is simply the combo the user was in immediately before, if any.
 * Changing any pane — adding a third doc, or clicking a different doc in the
 * sidebar while compare panes stay open — changes the *set* of open docs and
 * lands here again. Without superseding, every such change registered a whole
 * new compare view, so a single session left a pile of near-identical entries
 * behind. Treating it as an edit of the view you're already in keeps that to one
 * entry that follows your work.
 *
 * The one exception is data-driven rather than session-driven, deliberately: if
 * `key` is **already saved**, the user navigated back to a view that exists (e.g.
 * picked it from the sidebar) rather than editing into a new one, so nothing is
 * superseded and both survive. An earlier version instead tracked which combos
 * were built in the current session, which quietly broke on hot-reload — the
 * refs reset, the combo you were in stopped counting as yours, and the next edit
 * forked a duplicate again.
 */
export function rememberComboView(key: string | null, paths: string[], supersedesKey?: string | null) {
  if (!key || paths.length < 2) return;
  const all = readAll();
  const isExisting = key in all;
  let carried: ComboLayout = {};
  if (!isExisting && supersedesKey && supersedesKey !== key && all[supersedesKey]) {
    const { paths: _p, savedAt: _s, ...layout } = all[supersedesKey];
    carried = layout; // keep pane widths / outline state across the edit
    delete all[supersedesKey];
    writeAll(all);
  }
  saveComboLayout(key, { ...carried, paths, savedAt: new Date().toISOString() });
}

/** Every saved compare view that still knows its doc paths, newest first. */
export function listComboViews(): SavedComboView[] {
  const all = readAll();
  return Object.entries(all)
    .filter(([, v]) => Array.isArray(v.paths) && v.paths.length >= 2)
    .map(([key, v]) => ({ ...v, key, paths: v.paths as string[] }))
    .sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''));
}

export function deleteComboView(key: string) {
  const all = readAll();
  if (!(key in all)) return;
  delete all[key];
  writeAll(all);
  announce();
}

/** Drops saved views that reference a doc no longer in the user's library. */
export function pruneComboViews(livePaths: Set<string>) {
  const all = readAll();
  let changed = false;
  for (const [key, v] of Object.entries(all)) {
    if (Array.isArray(v.paths) && v.paths.some((p) => !livePaths.has(p))) {
      delete all[key];
      changed = true;
    }
  }
  if (changed) { writeAll(all); announce(); }
}
