// Per-shortcut opt-out, keyed by the stable `id` on each entry in
// ShortcutsOverlay.tsx's GROUPS array. Every keydown handler that wants to
// respect a disable toggle calls isShortcutDisabled(id) before acting.
// Deliberately not every shortcut is disableable — see ShortcutsOverlay.tsx
// for which ones expose the toggle.

const STORAGE_KEY = 'warroom-disabled-shortcuts';

function readDisabled(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

export function isShortcutDisabled(id: string): boolean {
  return readDisabled().has(id);
}

export function toggleShortcutDisabled(id: string): boolean {
  const set = readDisabled();
  const nowDisabled = !set.has(id);
  if (nowDisabled) set.add(id); else set.delete(id);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
  return nowDisabled;
}

export function getDisabledShortcuts(): Set<string> {
  return readDisabled();
}
