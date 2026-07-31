/**
 * Settings export/import.
 *
 * Two sources are bundled:
 *  1. `app_settings.json` (read/written wholesale via window.warroom.storage) — the vast
 *     majority of settings live here (event, AI provider/model, token saving, notification
 *     toggles, etc). Because we read/write the WHOLE object, any new field added to
 *     app_settings.json is automatically included — no code change needed here.
 *  2. A curated allowlist of `localStorage` keys for settings that live outside
 *     app_settings.json (theme, layout, per-feature toggles). This list is NOT automatic —
 *     see SETTINGS_LOCALSTORAGE_KEYS below and the CLAUDE.md rule that keeps it in sync.
 *
 * Deliberately EXCLUDED (never exported): API keys, OpenCaselist/Tabroom credentials, chat
 * credentials, Google Drive OAuth tokens — anything read via window.warroom.secure. Also
 * excluded: session/cache data that isn't a "setting" (chat user/team cache, speech-doc
 * recents, cached doc bytes, AI conversation history) — these are large, session-specific,
 * or sensitive, not portable preferences.
 */

// Preferences that live in localStorage under a `warroom-` key and are safe/meaningful
// to export. Keep this in sync — see the CLAUDE.md rule "Settings export/import — keep in sync".
const SETTINGS_LOCALSTORAGE_KEYS = [
  'warroom-theme',
  'warroom-direction',
  'warroom-danger-highlight',
  'warroom-card-outdated-years',
  'warroom-reduce-motion',
  'warroom-skip-delete-confirm',
  'warroom-event',
  'warroom-share-permission',
  'warroom-doc-light-in-dark',
  'warroom-doc-margin-pct',
  'warroom-doc-zoom-pct',
  'warroom-doc-auto-outline',
  'warroom-doc-start-focus',
  'warroom-doc-outline-layout',
  'warroom-flow-aff-color',
  'warroom-flow-neg-color',
  'warroom-sb-collapsed',
  'warroom-chat-width',
  'warroom-gemini-width',
  'warroom-files-bar-style',
  'warroom-quick-chat-enabled',
  'warroom-quick-chat-pins',
  'warroom-quick-chat-bindings',
];

interface SettingsExportFile {
  format: 'warroom-settings';
  version: 1;
  exportedAt: string;
  appSettings: Record<string, unknown>;
  localStorage: Record<string, string>;
}

export async function exportSettings(): Promise<{ ok: boolean; error?: string; canceled?: boolean }> {
  try {
    const appSettings = (await window.warroom?.storage.read('app_settings')) ?? {};

    const localStorageValues: Record<string, string> = {};
    for (const key of SETTINGS_LOCALSTORAGE_KEYS) {
      const v = localStorage.getItem(key);
      if (v !== null) localStorageValues[key] = v;
    }

    const file: SettingsExportFile = {
      format: 'warroom-settings',
      version: 1,
      exportedAt: new Date().toISOString(),
      appSettings,
      localStorage: localStorageValues,
    };

    const json = JSON.stringify(file, null, 2);
    const base64 = btoa(unescape(encodeURIComponent(json)));
    const date = new Date().toISOString().slice(0, 10);
    const res = await window.warroom?.dialog.saveBuffer(
      base64,
      `warroom-settings-${date}.json`,
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

export async function importSettings(): Promise<{ ok: boolean; error?: string; canceled?: boolean }> {
  try {
    const path = await window.warroom?.dialog.openFile(['json']);
    if (!path) return { ok: false, canceled: true };

    const res = await window.warroom?.fs.readFileBytes(path);
    if (!res?.ok || !res.base64) return { ok: false, error: res?.error ?? 'Could not read file' };

    const json = decodeURIComponent(escape(atob(res.base64)));
    let parsed: SettingsExportFile;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { ok: false, error: 'That file is not valid JSON' };
    }
    if (parsed?.format !== 'warroom-settings' || typeof parsed.appSettings !== 'object') {
      return { ok: false, error: 'That file is not a Warroom settings export' };
    }

    // Merge into existing app_settings.json rather than overwrite — an older export
    // missing a field the app has since added should not blow that field away.
    const current = (await window.warroom?.storage.read('app_settings')) ?? {};
    const merged = { ...current, ...parsed.appSettings };
    await window.warroom?.storage.write('app_settings', merged);

    for (const [key, value] of Object.entries(parsed.localStorage ?? {})) {
      if (SETTINGS_LOCALSTORAGE_KEYS.includes(key)) {
        localStorage.setItem(key, value);
      }
    }

    window.dispatchEvent(new CustomEvent('warroom-settings-change', { detail: merged }));
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Import failed' };
  }
}
