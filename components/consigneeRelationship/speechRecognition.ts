/**
 * Browser Web Speech API helpers for Consignee Relationship voice input.
 * No packages. No audio capture/storage — recognition only yields text.
 */

export type SpeechRecognitionLang = "hi-IN" | "en-IN" | "en-US";

export const SPEECH_LANGUAGE_OPTIONS: {
  value: SpeechRecognitionLang;
  label: string;
}[] = [
  { value: "hi-IN", label: "Hindi" },
  { value: "en-IN", label: "English (India)" },
  { value: "en-US", label: "English" },
];

export type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((this: BrowserSpeechRecognition, ev: Event) => void) | null;
  onend: ((this: BrowserSpeechRecognition, ev: Event) => void) | null;
  onerror:
    | ((
        this: BrowserSpeechRecognition,
        ev: { error: string; message?: string }
      ) => void)
    | null;
  onresult:
    | ((
        this: BrowserSpeechRecognition,
        ev: {
          resultIndex: number;
          results: ArrayLike<{
            isFinal: boolean;
            0: { transcript: string };
            length: number;
          }>;
        }
      ) => void)
    | null;
};

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isBrowserSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionConstructor() !== null;
}

/** Join existing composer text with newly recognized speech without wiping prior content. */
export function appendSpeechTranscript(
  existing: string,
  transcript: string
): string {
  const base = existing;
  const next = transcript.trim();
  if (!next) return base;
  if (!base.trim()) return next;
  if (/\s$/.test(base)) return `${base}${next}`;
  return `${base} ${next}`;
}
