"use client";

import {
  useEffect,
  useMemo,
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
  type SupplierAskScope,
  type SupplierOrganizationType,
} from "@/components/services/supplierIntelligence.service";

interface AskIntelligencePanelProps {
  organizationId: string;
  personId?: string | null;
  organizationName?: string | null;
  personName?: string | null;
  /** Active relationship types for the selected organization (from DB). */
  organizationTypes?: SupplierOrganizationType[];
  className?: string;
}

function modeLabel(mode: SupplierAskResult["mode"]): string {
  return mode === "DB_ONLY" ? "From records" : "Synthesized answer";
}

function formatSourceLine(source: {
  conversationId: string;
  occurredAt: string;
  organizationName: string | null;
  personName: string | null;
  personDesignation: string | null;
}): string {
  const when = source.occurredAt
    ? new Date(source.occurredAt).toLocaleDateString()
    : null;
  const ref =
    source.conversationId.length > 8
      ? source.conversationId.slice(0, 8)
      : source.conversationId;
  return [
    source.organizationName || "Organization",
    source.personName
      ? source.personDesignation
        ? `${source.personName} (${source.personDesignation})`
        : source.personName
      : null,
    when,
    ref ? `ref ${ref}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function AskIntelligencePanel({
  organizationId,
  personId = null,
  organizationName,
  personName,
  organizationTypes = [],
  className,
}: AskIntelligencePanelProps) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const [result, setResult] = useState<SupplierAskResponse | null>(null);
  const [scope, setScope] = useState<SupplierAskScope>("organization");
  const [selectedTypeSlug, setSelectedTypeSlug] = useState<string | null>(null);

  const hasPersonContext = Boolean(personId);
  const hasRelationshipTypes = organizationTypes.length > 0;
  const canAsk = !asking && question.trim().length > 0;

  useEffect(() => {
    if (!hasRelationshipTypes) {
      setSelectedTypeSlug(null);
      if (scope === "organization_type") {
        setScope("organization");
      }
      return;
    }
    setSelectedTypeSlug((current) => {
      if (current && organizationTypes.some((t) => t.slug === current)) {
        return current;
      }
      return organizationTypes[0]?.slug ?? null;
    });
  }, [organizationTypes, hasRelationshipTypes, scope]);

  const selectedTypeName = useMemo(() => {
    return (
      organizationTypes.find((t) => t.slug === selectedTypeSlug)?.name ?? null
    );
  }, [organizationTypes, selectedTypeSlug]);

  const personClearedForScope =
    hasPersonContext &&
    (scope === "organization_type" || scope === "all");

  const description =
    scope === "all"
      ? "Ask across all organizations you can access (capped recent conversations)."
      : scope === "organization_type"
        ? "Ask across organizations with this relationship type (capped recent conversations)."
        : hasPersonContext
          ? "Ask a question about this contact's conversations and relationship history."
          : "Ask a question about this organization's conversations and relationship history.";

  const placeholder =
    scope === "all"
      ? "Ask across all organizations…"
      : scope === "organization_type"
        ? `Ask about ${selectedTypeName ?? "this relationship type"}…`
        : hasPersonContext
          ? "Ask something about this contact…"
          : "Ask something about this organization…";

  const contextLabel =
    scope === "all"
      ? "All organizations"
      : scope === "organization_type"
        ? selectedTypeName
          ? `Relationship type: ${selectedTypeName}`
          : "Relationship type"
        : [personName, organizationName].filter(Boolean).join(" · ");

  async function submitAsk() {
    if (!canAsk) return;
    if (scope === "organization_type" && !selectedTypeSlug) return;

    const trimmed = question.trim();
    setAsking(true);
    setLastQuestion(trimmed);
    setResult(null);

    try {
      const response = await askSupplierIntelligence({
        question: trimmed,
        scope,
        organizationId:
          scope === "organization" ? organizationId : null,
        personId:
          scope === "organization" && hasPersonContext ? personId : null,
        organizationTypeSlug:
          scope === "organization_type" ? selectedTypeSlug : null,
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

  function selectScope(next: SupplierAskScope) {
    if (next === "organization_type" && !hasRelationshipTypes) return;
    setScope(next);
    setResult(null);
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
              Scope: {contextLabel}
            </p>
          ) : null}
          {personClearedForScope ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Not limited to {personName || "this contact"} — asking across the
              selected scope.
            </p>
          ) : null}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        <fieldset className="space-y-1.5">
          <legend className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Ask about
          </legend>
          <div
            className="flex flex-wrap gap-1.5"
            role="radiogroup"
            aria-label="Ask scope"
          >
            {(
              [
                {
                  id: "organization" as const,
                  label: "This organization",
                  disabled: false,
                },
                {
                  id: "organization_type" as const,
                  label: "This relationship type",
                  disabled: !hasRelationshipTypes,
                },
                {
                  id: "all" as const,
                  label: "All organizations",
                  disabled: false,
                },
              ] as const
            ).map((option) => {
              const selected = scope === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={option.disabled || asking}
                  onClick={() => selectScope(option.id)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                    selected
                      ? "border-primary/30 bg-primary/10 text-foreground"
                      : "border-border bg-background text-foreground hover:bg-muted/50",
                    option.disabled && "cursor-not-allowed opacity-50"
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          {!hasRelationshipTypes ? (
            <p className="text-[11px] text-muted-foreground">
              Relationship-type scope is unavailable because this organization
              has no active relationship type.
            </p>
          ) : null}
          {scope === "organization_type" && hasRelationshipTypes ? (
            organizationTypes.length === 1 ? (
              <p className="text-[11px] text-muted-foreground">
                Using relationship type: {organizationTypes[0]?.name}
              </p>
            ) : (
              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                <span>Relationship type</span>
                <select
                  value={selectedTypeSlug ?? ""}
                  disabled={asking}
                  onChange={(event) => {
                    setSelectedTypeSlug(event.target.value || null);
                    setResult(null);
                  }}
                  className="h-8 max-w-xs rounded-md border border-border bg-background px-2 text-xs text-foreground"
                  aria-label="Select relationship type"
                >
                  {organizationTypes.map((type) => (
                    <option key={type.slug} value={type.slug}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </label>
            )
          ) : null}
        </fieldset>

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
            disabled={
              !canAsk ||
              (scope === "organization_type" && !selectedTypeSlug)
            }
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
                    {result.sources.slice(0, 8).map((source) => (
                      <li
                        key={source.conversationId}
                        className="text-xs text-muted-foreground"
                      >
                        {formatSourceLine(source)}
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
