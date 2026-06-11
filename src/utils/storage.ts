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
  // Merge localStorage fallbacks so manual W-L survives even if db.json
  // predates those fields (they'll be 0 from emptyDB but LS may have real values).
  try {
    const lsW = localStorage.getItem('warroom-manual-wins');
    const lsL = localStorage.getItem('warroom-manual-losses');
    if (lsW !== null && base.manualWins === 0) base.manualWins = parseInt(lsW, 10) || 0;
    if (lsL !== null && base.manualLosses === 0) base.manualLosses = parseInt(lsL, 10) || 0;
  } catch {}
  return base;
}

export async function saveDB(db: DB): Promise<void> {
  const storage = api();
  if (!storage) return;
  await storage.write(FILE, db);
}
