"use client";

/**
 * Re-export Consignee Relationship speech helpers for Supplier Intelligence.
 * Shared browser Web Speech utilities only — Consignee UI is untouched.
 */
export {
  SPEECH_LANGUAGE_OPTIONS,
  appendSpeechTranscript,
  getSpeechRecognitionConstructor,
  isBrowserSpeechRecognitionSupported,
  type BrowserSpeechRecognition,
  type SpeechRecognitionLang,
} from "@/components/consigneeRelationship/speechRecognition";
