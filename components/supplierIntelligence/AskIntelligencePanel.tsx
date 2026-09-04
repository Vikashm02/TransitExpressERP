"use client";

import {
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  askSupplierIntelligence,
  type SupplierAskResponse,
  type SupplierAskResult,
} from "@/components/services/supplierIntelligence.service";

interface AskIntelligencePanelProps {
  organizationId: string;
  personId?: string | null;
  organizationName?: string | null;
  personName?: string | null;
  className?: string;
}

function modeLabel(mode: SupplierAskResult["mode"]): string {
  return mode === "DB_ONLY" ? "From records" : "Synthesized answer";
}

export default function AskIntelligencePanel({
  organizationId,
  personId = null,
  organizationName,
  personName,
  className,
}: AskIntelligencePanelProps) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const [result, setResult] = useState<SupplierAskResponse | null>(null);

  const canAsk = !asking && question.trim().length > 0;
  const hasPersonContext = Boolean(personId);

  const contextLabel = [personName, organizationName].filter(Boolean).join(" · ");
  const description = hasPersonContext
    ? "Ask a question about this contact's conversations and relationship history."
    : "Ask a question about this organization's conversations and relationship history.";
  const placeholder = hasPersonContext
    ? "Ask something about this contact…"
    : "Ask something about this organization…";

  async function submitAsk() {
    if (!canAsk) return;

    const trimmed = question.trim();
    setAsking(true);
    setLastQuestion(trimmed);
    setResult(null);

    try {
      const response = await askSupplierIntelligence({
        question: trimmed,
        organizationId,
        personId: hasPersonContext ? personId : null,
      });
      setResult(response);
    } catch {
      setResult({
        ok: false,
        error: "retrieval_failure",
        message: "Unable to reach Supplier Intelligence. Please try again.",
      });
    } finally {
      setAsking(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submitAsk();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter") return;
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      void submitAsk();
    }
  }

  return (
    <section
      className={cn(
        "border-b border-border bg-primary/[0.03] px-3 py-3 sm:px-4",
        className
      )}
      aria-label="Ask Supplier Intelligence"
    >
      <div className="mb-2 flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary/80">
            Ask Supplier Intelligence
          </p>
          <p className="text-xs text-muted-foreground">
            {description} This does not log a new conversation note.
          </p>
          {contextLabel ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Context: {contextLabel}
            </p>
          ) : null}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        <Textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={asking}
          rows={3}
          maxLength={2000}
          className="min-h-[72px] resize-y text-foreground caret-foreground placeholder:text-muted-foreground"
          aria-label="Ask Supplier Intelligence question"
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-muted-foreground">
            Ctrl/⌘ + Enter to ask. Separate from logging meeting notes below.
          </p>
          <Button
            type="submit"
            size="sm"
            disabled={!canAsk}
            className="w-full shrink-0 sm:w-auto"
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            {asking ? "Thinking…" : "Ask"}
          </Button>
        </div>
      </form>

      {asking ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          Thinking…
        </p>
      ) : null}

      {!asking && result ? (
        <div
          className={cn(
            "mt-3 space-y-2 rounded-lg border px-3 py-3",
            result.ok
              ? "border-border bg-card"
              : "border-destructive/30 bg-destructive/5"
          )}
          role="status"
        >
          {lastQuestion ? (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Your question
              </p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">
                {lastQuestion}
              </p>
            </div>
          ) : null}

          {result.ok ? (
            <>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Answer
                  </p>
                  <span className="rounded-md border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[10px] font-medium text-primary/80">
                    {modeLabel(result.mode)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                  {result.answer?.trim() ||
                    result.message?.trim() ||
                    "No answer was returned for this question."}
                </p>
                {result.message && result.answer ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {result.message}
                  </p>
                ) : null}
              </div>

              {result.sources.length > 0 ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Based on {result.sources.length} conversation
                    {result.sources.length === 1 ? "" : "s"}
                    {result.truncated ? " (limited set)" : ""}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {result.sources.slice(0, 5).map((source) => (
                      <li
                        key={source.conversationId}
                        className="text-xs text-muted-foreground"
                      >
                        {[
                          source.personName || source.organizationName || "Note",
                          source.personDesignation,
                          source.occurredAt
                            ? new Date(source.occurredAt).toLocaleDateString()
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-destructive">{result.message}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
