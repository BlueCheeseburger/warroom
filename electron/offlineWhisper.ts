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

export interface WhisperProgress {
  status: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
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
        progress_callback: onProgress,
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
