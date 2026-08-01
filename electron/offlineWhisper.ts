/**
 * Offline dictation (Beta) — local speech-to-text via a small Whisper model
 * running fully on-device through @huggingface/transformers (ONNX runtime).
 * No network, no API key, works with any AI provider selected (or none).
 *
 * This is a genuinely different code path from the cloud dictation providers:
 * it needs a one-time model download (~40-80MB) before first use, and local
 * inference on a CPU is slower and less accurate than a hosted model — hence
 * "Beta" everywhere this is surfaced to the user (Settings' toggle/button
 * copy, this file's own comments). Kept in its own module, same split as
 * `lmstudio.ts`, so the heavy `@huggingface/transformers` import only loads
 * when offline dictation is actually used.
 */

const MODEL_ID = 'Xenova/whisper-tiny.en';

/** Raw shape of a single @huggingface/transformers progress_callback event —
 *  one model download is several separate files (weights, tokenizer, config,
 *  ...), and each file reports its OWN 0-100 independently. */
interface RawTransformersProgress {
  status: string;
  file?: string;
  name?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

/** What Settings actually renders: a human label for whatever's downloading
 *  right now, and one aggregate percentage across every file seen so far
 *  (not a per-file reset back to 0). */
export interface WhisperProgress {
  status: string;
  label?: string;
  overallPct?: number;
}

/** The model repo's files aren't named for a non-technical reader (e.g.
 *  `onnx/decoder_model_merged_quantized.onnx`) — map the recognizable
 *  substrings to a plain-language label instead of showing the raw filename. */
function friendlyFileLabel(file: string): string {
  const f = file.toLowerCase();
  if (f.includes('encoder') && f.includes('onnx')) return 'audio encoder';
  if (f.includes('decoder') && f.includes('onnx')) return 'text decoder';
  if (f.includes('.onnx')) return 'model weights';
  if (f.includes('tokenizer')) return 'tokenizer';
  if (f.includes('vocab')) return 'vocabulary';
  if (f.includes('preprocessor')) return 'audio preprocessor config';
  if (f.includes('config')) return 'model config';
  return file.split('/').pop() ?? file;
}

/** Turns per-file 0-100 events into one running "of the whole download"
 *  percentage — sums bytes loaded/total across every file the model reports
 *  as it goes, rather than resetting the visible number to 0 each time a new
 *  file starts. Necessarily an approximation for the first few files (a
 *  file's `total` isn't known until its first progress event arrives), but
 *  converges quickly and never goes backwards in practice since files are
 *  reported in roughly size order. */
function makeProgressAggregator(onProgress: (p: WhisperProgress) => void) {
  const files = new Map<string, { loaded: number; total: number }>();
  return (raw: RawTransformersProgress) => {
    const file = raw.file ?? raw.name;
    if (file && typeof raw.total === 'number' && typeof raw.loaded === 'number') {
      files.set(file, { loaded: raw.loaded, total: raw.total });
    }
    let loadedSum = 0;
    let totalSum = 0;
    for (const f of files.values()) { loadedSum += f.loaded; totalSum += f.total; }
    const overallPct = totalSum > 0 ? Math.min(100, Math.round((loadedSum / totalSum) * 100)) : undefined;
    onProgress({ status: raw.status, label: file ? friendlyFileLabel(file) : undefined, overallPct });
  };
}

let transcriberPromise: Promise<any> | null = null;

/**
 * Lazily creates (and caches) the ASR pipeline. `onProgress` only fires
 * meaningfully the first time — after the model is cached on disk, later
 * calls resolve near-instantly with no download activity.
 */
async function getTranscriber(cacheDir: string, onProgress?: (p: WhisperProgress) => void) {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      // Keep the model cache inside Warroom's own userData dir rather than a
      // generic global HuggingFace cache — consistent with how the rest of
      // the app scopes its data, and makes "is it downloaded" a simple flag
      // instead of having to probe some shared external cache location.
      env.cacheDir = cacheDir;
      return pipeline('automatic-speech-recognition', MODEL_ID, {
        progress_callback: onProgress ? makeProgressAggregator(onProgress) : undefined,
      });
    })();
  }
  return transcriberPromise;
}

/** Explicit download trigger — Settings' "Download offline model" button. */
export async function downloadOfflineWhisperModel(
  cacheDir: string,
  onProgress: (p: WhisperProgress) => void,
): Promise<void> {
  await getTranscriber(cacheDir, onProgress);
}

/**
 * Transcribes 16kHz mono PCM samples (Float32, -1..1) — the renderer decodes
 * and resamples the recorded audio to this exact format via the Web Audio
 * API before sending it over IPC, so no audio-format decoding needs to
 * happen in the main process at all.
 */
export async function transcribeOffline(pcm: Float32Array, cacheDir: string): Promise<string> {
  const transcriber = await getTranscriber(cacheDir);
  const result = await transcriber(pcm, { sampling_rate: 16000 });
  const text = Array.isArray(result) ? result[0]?.text : result?.text;
  if (typeof text !== 'string') throw new Error('Unexpected offline transcription result shape');
  return text.trim();
}
