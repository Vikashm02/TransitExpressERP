"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Mic, MicOff, Send, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { SupplierConversationInputType } from "@/components/services/supplierIntelligence.service";
import {
  SPEECH_LANGUAGE_OPTIONS,
  appendSpeechTranscript,
  getSpeechRecognitionConstructor,
  isBrowserSpeechRecognitionSupported,
  type BrowserSpeechRecognition,
  type SpeechRecognitionLang,
} from "./speechRecognition";

type VoiceUiState =
  | "idle"
  | "listening"
  | "stopping"
  | "unsupported"
  | "error";

interface ConversationComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  disabled?: boolean;
  className?: string;
  inputType: SupplierConversationInputType;
  onInputTypeChange: (inputType: SupplierConversationInputType) => void;
  placeholder?: string;
}

export default function ConversationComposer({
  value,
  onChange,
  onSend,
  sending,
  disabled = false,
  className,
  inputType,
  onInputTypeChange,
  placeholder = "Write what you learned…",
}: ConversationComposerProps) {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const valueRef = useRef(value);

  const [voiceState, setVoiceState] = useState<VoiceUiState>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [speechLang, setSpeechLang] = useState<SpeechRecognitionLang>("hi-IN");
  const [interim, setInterim] = useState("");

  const canSend = !disabled && !sending && value.trim().length > 0;
  const recognitionBusy =
    voiceState === "listening" || voiceState === "stopping";

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!isBrowserSpeechRecognitionSupported()) {
      setVoiceState("unsupported");
    }
  }, []);

  const cleanupRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.abort();
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanupRecognition();
    };
  }, [cleanupRecognition]);

  function stopListening() {
    if (voiceState !== "listening" || !recognitionRef.current) return;
    setVoiceState("stopping");
    setInterim("");
    try {
      recognitionRef.current.stop();
    } catch {
      setVoiceState("idle");
      recognitionRef.current = null;
    }
  }

  function requestSendOrStopRecognition() {
    if (voiceState === "listening") {
      stopListening();
      return;
    }
    if (voiceState === "stopping") return;
    if (canSend) onSend();
  }

  function startListening() {
    if (disabled || sending) return;
    if (voiceState === "unsupported") return;

    const Ctor = getSpeechRecognitionConstructor();
    if (!Ctor) {
      setVoiceState("unsupported");
      return;
    }

    cleanupRecognition();
    setInterim("");
    setVoiceError(null);
    valueRef.current = value;

    const recognition = new Ctor();
    recognition.lang = speechLang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setVoiceState("listening");
    };

    recognition.onresult = (event) => {
      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const piece = result[0]?.transcript ?? "";
        if (!piece) continue;

        if (result.isFinal) {
          const next = appendSpeechTranscript(valueRef.current, piece);
          if (next === valueRef.current) continue;
          valueRef.current = next;
          onChange(next);
          onInputTypeChange("voice");
        } else {
          interimText = `${interimText}${piece}`;
        }
      }

      setInterim(interimText.trim());
    };

    recognition.onerror = (event) => {
      const code = event.error || "unknown";
      if (code === "aborted" || code === "no-speech") return;
      if (code === "not-allowed") {
        setVoiceError(
          "Microphone permission was denied. Allow the microphone, or type instead."
        );
      } else {
        setVoiceError(
          "Voice recognition failed. You can still type and edit the note."
        );
      }
      setVoiceState("error");
      setInterim("");
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setInterim("");
      setVoiceState((prev) => {
        if (prev === "unsupported" || prev === "error") return prev;
        return "idle";
      });
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      setVoiceState("listening");
    } catch {
      setVoiceError("Unable to start voice recognition.");
      setVoiceState("error");
      recognitionRef.current = null;
    }
  }

  function handleMicClick() {
    if (recognitionBusy) {
      if (voiceState === "listening") stopListening();
      return;
    }
    startListening();
  }

  function handleTextChange(next: string) {
    valueRef.current = next;
    onChange(next);
    if (!next.trim()) {
      onInputTypeChange("text");
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter") return;
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      requestSendOrStopRecognition();
    }
  }

  const micDisabled =
    disabled ||
    sending ||
    voiceState === "unsupported" ||
    voiceState === "stopping";

  return (
    <div
      className={cn(
        "border-t border-border bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:p-4",
        className
      )}
    >
      {voiceState === "listening" || voiceState === "stopping" ? (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-xs text-foreground">
          <span
            className={cn(
              "inline-block size-2 rounded-full bg-destructive",
              voiceState === "listening" && "animate-pulse"
            )}
            aria-hidden
          />
          <span className="font-medium">
            {voiceState === "stopping"
              ? "Stopping… Review the text, then press Send."
              : "Listening — speak now. Tap Stop when finished."}
          </span>
          {interim ? (
            <span className="truncate text-muted-foreground">…{interim}</span>
          ) : null}
        </div>
      ) : null}

      {voiceState === "error" && voiceError ? (
        <p className="mb-2 text-xs text-destructive">{voiceError}</p>
      ) : null}

      {voiceState === "unsupported" ? (
        <p className="mb-2 text-xs text-muted-foreground">
          Voice input is not supported in this browser. Type your note instead.
          (Chrome / Edge on desktop or Android usually work best.)
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Textarea
          value={value}
          onChange={(event) => handleTextChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || sending}
          rows={3}
          className="min-h-[88px] flex-1 resize-y text-foreground caret-foreground placeholder:text-muted-foreground"
          aria-label="Supplier intelligence conversation"
        />

        <div className="flex w-full flex-col gap-2 sm:w-auto">
          {voiceState !== "unsupported" ? (
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="supplier-speech-lang">
                Speech language
              </label>
              <select
                id="supplier-speech-lang"
                value={speechLang}
                onChange={(event) =>
                  setSpeechLang(event.target.value as SpeechRecognitionLang)
                }
                disabled={micDisabled || recognitionBusy}
                className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-card px-2 text-xs text-foreground sm:w-[9.5rem]"
              >
                {SPEECH_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant={recognitionBusy ? "destructive" : "outline"}
                size="lg"
                onClick={handleMicClick}
                disabled={micDisabled}
                className="shrink-0"
                aria-pressed={recognitionBusy}
                aria-label={
                  recognitionBusy ? "Stop voice input" : "Start voice input"
                }
              >
                {recognitionBusy ? (
                  <>
                    <Square className="mr-2 h-4 w-4" />
                    Stop
                  </>
                ) : voiceState === "error" ? (
                  <>
                    <MicOff className="mr-2 h-4 w-4" />
                    Retry
                  </>
                ) : (
                  <>
                    <Mic className="mr-2 h-4 w-4" />
                    Mic
                  </>
                )}
              </Button>
            </div>
          ) : null}

          <Button
            type="button"
            size="lg"
            onClick={requestSendOrStopRecognition}
            disabled={
              voiceState === "stopping"
                ? true
                : voiceState === "listening"
                  ? false
                  : !canSend
            }
            className="w-full shrink-0"
          >
            <Send className="mr-2 h-4 w-4" />
            {sending
              ? "Sending…"
              : voiceState === "listening"
                ? "Stop to review"
                : voiceState === "stopping"
                  ? "Stopping…"
                  : "Send"}
          </Button>
        </div>
      </div>

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Voice never auto-sends — stop listening, review the text, then press
        Send.
        {inputType === "voice" ? " · This draft is marked as voice." : ""}{" "}
        Ctrl/⌘ + Enter follows the same rule. Enter adds a new line.
      </p>
    </div>
  );
}
