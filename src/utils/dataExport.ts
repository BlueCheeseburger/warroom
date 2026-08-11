/**
 * Full data export/import — "make my new computer look and behave identical
 * to my old one." Distinct from settingsExport.ts (preferences only): this
 * carries your actual library — cases/blocks/cards, opponents, judges,
 * tournaments, folder structure, flows, Warroom AI chat history — plus
 * settings, bundled as one JSON file (same save/open-dialog approach as
 * settingsExport.ts, just a bigger payload).
 *
 * Deliberately excluded, same reasoning as settingsExport.ts:
 *  - API keys / OpenCaselist / Google Drive / chat credentials (window.warroom.secure)
 *    — encrypted via OS keychain/DPAPI, tied to the machine that encrypted them,
 *    cannot be decrypted elsewhere. Re-enter these on the new computer.
 *  - Team chat / Team Files — already synced via Supabase; signing into the
 *    same team on the new computer pulls them back down, no export needed.
 *
 * Speech docs are exported as file-PATH references only, never bundled bytes
 * — matches how the app already treats them everywhere else (a pointer to a
 * file on disk, re-read on open, see SpeechDocViewer.tsx). On a different
 * computer most of those paths won't resolve; see missingSpeechDocs.ts for
 * the post-import "locate file" recovery flow that handles that.
 */

import { DB, emptyDB } from '../types';
import { FlowMeta } from '../store/appStore';
import { loadCaseFolders, saveCaseFolders, CaseFoldersData, emptyCaseFolders } from './caseFolders';
import { SETTINGS_LOCALSTORAGE_KEYS } from './settingsExport';

const SPEECH_RECENTS_KEY = 'warroom-speech-doc-recents';
const CONV_META_KEY = 'warroom-gemini-conversations';
const convHistoryKey = (id: string) => `warroom-gemini-conv-${id}`;

interface RecentDoc { path: string; name: string; cardCount?: number; addedAt?: string }
interface ConvMeta { id: string; title: string; titleSetByUser?: boolean }

// Rough size at which the export warns before including full AI chat history
// — a few hundred conversations of history can genuinely run multi-MB, and
// the user should know that's happening rather than get a surprisingly large
// file silently.
export const CHAT_HISTORY_WARN_BYTES = 1_000_000;

interface FullExportFile {
  format: 'warroom-full-backup';
  version: 1;
  exportedAt: string;
  db: DB;
  flowsIndex: FlowMeta[];
  flowsData: Record<string, unknown>;
  caseFolders: CaseFoldersData;
  speechDocs: RecentDoc[];
  aiChatIndex: ConvMeta[];
  aiChatHistory: Record<string, unknown>;
  appSettings: Record<string, unknown>;
  localStorage: Record<string, string>;
}

function getSpeechDocRecents(): RecentDoc[] {
  try { return JSON.parse(localStorage.getItem(SPEECH_RECENTS_KEY) ?? '[]'); } catch { return []; }
}

function getAiChatIndex(): ConvMeta[] {
  try { return JSON.parse(localStorage.getItem(CONV_META_KEY) ?? '[]'); } catch { return []; }
}

async function buildExportFile(): Promise<FullExportFile> {
  const db = (await window.warroom?.storage.read('db.json')) as DB ?? emptyDB();
  const flowsIndexRaw = await window.warroom?.storage.read('flows_index');
  const flowsIndex: FlowMeta[] = Array.isArray(flowsIndexRaw) ? flowsIndexRaw : [];
  const flowsData: Record<string, unknown> = {};
  for (const f of flowsIndex) {
    const data = await window.warroom?.storage.read(`flow_data_${f.id}`);
    if (data) flowsData[f.id] = data;
  }
  const caseFolders = await loadCaseFolders();
  const speechDocs = getSpeechDocRecents();
  const aiChatIndex = getAiChatIndex();
  const aiChatHistory: Record<string, unknown> = {};
  for (const c of aiChatIndex) {
    try {
      const raw = localStorage.getItem(convHistoryKey(c.id));
      if (raw) aiChatHistory[c.id] = JSON.parse(raw);
    } catch {}
  }
  const appSettings = (await window.warroom?.storage.read('app_settings')) ?? {};
  const localStorageValues: Record<string, string> = {};
  for (const key of SETTINGS_LOCALSTORAGE_KEYS) {
    const v = localStorage.getItem(key);
    if (v !== null) localStorageValues[key] = v;
  }

  return {
    format: 'warroom-full-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    db, flowsIndex, flowsData, caseFolders, speechDocs, aiChatIndex, aiChatHistory,
    appSettings, localStorage: localStorageValues,
  };
}

export interface ExportSummary {
  cases: number; blocks: number; cards: number; opponents: number; judges: number;
  tournaments: number; flows: number; speechDocs: number; aiChats: number;
  chatHistoryBytes: number;
}

export function summarizeExport(file: Pick<FullExportFile, 'db' | 'flowsIndex' | 'speechDocs' | 'aiChatIndex' | 'aiChatHistory'>): ExportSummary {
  return {
    cases: Object.keys(file.db.cases ?? {}).length,
    blocks: Object.keys(file.db.blocks ?? {}).length,
    cards: Object.keys(file.db.cards ?? {}).length,
    opponents: Object.keys(file.db.opponents ?? {}).length,
    judges: Object.keys(file.db.judges ?? {}).length,
    tournaments: Object.keys(file.db.tournaments ?? {}).length,
    flows: file.flowsIndex.length,
    speechDocs: file.speechDocs.length,
    aiChats: file.aiChatIndex.length,
    chatHistoryBytes: JSON.stringify(file.aiChatHistory).length,
  };
}

/**
 * Step 1: build the file in memory and return a summary — including whether
 * chat history is large enough to warn about — without writing anything to
 * disk yet. The caller (Settings.tsx) shows this summary + a size warning if
 * applicable, and only calls `writeExport` after the user confirms.
 */
export async function prepareExport(): Promise<{ ok: boolean; file?: FullExportFile; summary?: ExportSummary; error?: string }> {
  try {
    const file = await buildExportFile();
    const summary = summarizeExport(file);
    return { ok: true, file, summary };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Failed to gather data' };
  }
}

export async function writeExport(file: FullExportFile): Promise<{ ok: boolean; error?: string; canceled?: boolean }> {
  try {
    const json = JSON.stringify(file);
    const base64 = btoa(unescape(encodeURIComponent(json)));
    const date = new Date().toISOString().slice(0, 10);
    const res = await window.warroom?.dialog.saveBuffer(
      base64,
      `warroom-backup-${date}.json`,
      [{ name: 'JSON', extensions: ['json'] }],
    );
    if (!res) return { ok: false, error: 'App bridge not ready' };
    if (res.canceled) return { ok: false, canceled: true };
    if (!res.ok) return { ok: false, error: res.error ?? 'Failed to save file' };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Export failed' };
  }
}

/** Step 1 of import: pick + parse the file, return its summary for confirmation — nothing is written yet. */
export async function pickImportFile(): Promise<{ ok: boolean; file?: FullExportFile; summary?: ExportSummary; error?: string; canceled?: boolean }> {
  try {
    const path = await window.warroom?.dialog.openFile(['json']);
    if (!path) return { ok: false, canceled: true };
    const res = await window.warroom?.fs.readFileBytes(path);
    if (!res?.ok || !res.base64) return { ok: false, error: res?.error ?? 'Could not read file' };
    const json = decodeURIComponent(escape(atob(res.base64)));
    let parsed: FullExportFile;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { ok: false, error: 'That file is not valid JSON' };
    }
    if (parsed?.format !== 'warroom-full-backup' || typeof parsed.db !== 'object') {
      return { ok: false, error: 'That file is not a Warroom backup' };
    }
    return { ok: true, file: parsed, summary: summarizeExport(parsed) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Import failed' };
  }
}

/**
 * Step 2 of import: the user confirmed the "this replaces everything"
 * warning — actually write it all. Wholesale-replaces the library
 * (db/flows/folders), same spirit as the reset-to-default flow being a real
 * replace rather than a merge; settings are merged (like settingsExport.ts)
 * so a field this build has that the export predates isn't blown away.
 */
export async function applyImport(file: FullExportFile): Promise<{ ok: boolean; error?: string }> {
  try {
    await window.warroom?.storage.write('db.json', file.db ?? emptyDB());

    const flowsIndex = Array.isArray(file.flowsIndex) ? file.flowsIndex : [];
    await window.warroom?.storage.write('flows_index', flowsIndex);
    for (const f of flowsIndex) {
      const data = file.flowsData?.[f.id];
      if (data) await window.warroom?.storage.write(`flow_data_${f.id}`, data);
    }

    await saveCaseFolders(file.caseFolders ?? emptyCaseFolders());

    const speechDocs = Array.isArray(file.speechDocs) ? file.speechDocs : [];
    localStorage.setItem(SPEECH_RECENTS_KEY, JSON.stringify(speechDocs));

    const aiChatIndex = Array.isArray(file.aiChatIndex) ? file.aiChatIndex : [];
    localStorage.setItem(CONV_META_KEY, JSON.stringify(aiChatIndex));
    for (const c of aiChatIndex) {
      const history = file.aiChatHistory?.[c.id];
      if (history) localStorage.setItem(convHistoryKey(c.id), JSON.stringify(history));
    }

    const currentSettings = (await window.warroom?.storage.read('app_settings')) ?? {};
    const mergedSettings = { ...currentSettings, ...(file.appSettings ?? {}) };
    await window.warroom?.storage.write('app_settings', mergedSettings);
    for (const [key, value] of Object.entries(file.localStorage ?? {})) {
      if (SETTINGS_LOCALSTORAGE_KEYS.includes(key)) localStorage.setItem(key, value);
    }

    // Trust whichever imported speech-doc paths happen to already exist on
    // this machine, so they're openable immediately rather than needing a
    // "locate file" relink even though the file is right there — see
    // fs:trustIfExists in main.ts. Everything else is what
    // missingSpeechDocs.ts's post-import check will flag.
    if (speechDocs.length > 0) {
      await window.warroom?.fs.trustIfExists(speechDocs.map((d) => d.path));
    }

    localStorage.setItem('warroom-import-check-pending', '1');
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Import failed' };
  }
}
