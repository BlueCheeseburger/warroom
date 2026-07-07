import { DB, emptyDB } from '../types';

const FILE = 'db.json';

function api() {
  if (typeof window === 'undefined' || !window.warroom) {
    console.warn('window.warroom not available — running outside Electron');
    return null;
  }
  return window.warroom.storage;
}

export async function loadDB(): Promise<DB> {
  const storage = api();
  if (!storage) return emptyDB();
  const raw = await storage.read(FILE);
  const base = raw ? { ...emptyDB(), ...raw } : emptyDB();
  // One-time migration: seed manual W-L from the old localStorage values ONLY when
  // this db.json predates those fields entirely. Once db.json carries the field —
  // even a value of 0 — it is the source of truth. (The previous logic keyed off
  // `=== 0`, which meant a deliberate reset to 0 got silently overwritten by a
  // stale localStorage value on every launch.)
  try {
    if (raw && (raw as any).manualWins === undefined) {
      const lsW = localStorage.getItem('warroom-manual-wins');
      if (lsW !== null) base.manualWins = parseInt(lsW, 10) || 0;
    }
    if (raw && (raw as any).manualLosses === undefined) {
      const lsL = localStorage.getItem('warroom-manual-losses');
      if (lsL !== null) base.manualLosses = parseInt(lsL, 10) || 0;
    }
  } catch {}
  return base;
}

export async function saveDB(db: DB): Promise<void> {
  const storage = api();
  if (!storage) return;
  await storage.write(FILE, db);
}
