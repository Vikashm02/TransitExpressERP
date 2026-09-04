"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, MessageSquareText, Search } from "lucide-react";

import PageHeader from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import CustomerLookup from "@/components/lookup/CustomerLookup";
import RelativeCreatedTime from "@/components/common/RelativeCreatedTime";
import ConversationComposer from "./ConversationComposer";
import ConversationEntry from "./ConversationEntry";
import type { CustomerRecord } from "@/components/services/customer.service";
import {
  createConsigneeConversation,
  getConsigneeConversationSummary,
  getConsigneeConversations,
  type ConsigneeConversation,
  type ConsigneeConversationInputType,
  type ConsigneeConversationSummaryItem,
} from "@/components/services/consigneeRelationship.service";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn } from "@/lib/utils";

type SelectedConsignee = {
  id: number;
  name: string;
  code: string | null;
};

export default function ConsigneeRelationshipPage() {
  const { hasPermission, hasAction, profile } = useAuth();
  const canView = hasPermission("consignee_intelligence", "view");
  // Module actions are view + create (lib/permissions.ts). Use hasAction("create"),
  // not the legacy level name create_view.
  const canCreate = hasAction("consignee_intelligence", "create");

  const [lookupOpen, setLookupOpen] = useState(false);
  const [selected, setSelected] = useState<SelectedConsignee | null>(null);

  const [summary, setSummary] = useState<ConsigneeConversationSummaryItem[]>(
    []
  );
  const [summaryLoading, setSummaryLoading] = useState(true);

  const [conversations, setConversations] = useState<ConsigneeConversation[]>(
    []
  );
  const [timelineLoading, setTimelineLoading] = useState(false);

  const [draft, setDraft] = useState("");
  const [draftInputType, setDraftInputType] =
    useState<ConsigneeConversationInputType>("text");
  const [sending, setSending] = useState(false);

  const timelineEndRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);

  const chronological = useMemo(() => {
    // RPC returns newest-first; chat UI needs oldest → newest.
    return [...conversations].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      if (ta !== tb) return ta - tb;
      return a.id - b.id;
    });
  }, [conversations]);

  useEffect(() => {
    if (!canView) {
      setSummaryLoading(false);
      return;
    }
    void loadSummary();
  }, [canView]);

  useEffect(() => {
    if (!selected || !canView) return;
    void loadTimeline(selected.id);
  }, [selected?.id, canView]);

  useEffect(() => {
    if (!selected || timelineLoading) return;
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [selected?.id, chronological.length, timelineLoading]);

  async function loadSummary() {
    try {
      setSummaryLoading(true);
      const rows = await getConsigneeConversationSummary(50);
      setSummary(rows);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load recent consignee conversations.");
    } finally {
      setSummaryLoading(false);
    }
  }

  async function loadTimeline(customerId: number) {
    try {
      setTimelineLoading(true);
      const result = await getConsigneeConversations(customerId);
      setConversations(result.conversations);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load conversation history.");
      setConversations([]);
    } finally {
      setTimelineLoading(false);
    }
  }

  function openConsignee(next: SelectedConsignee) {
    setSelected(next);
    setDraft("");
    setDraftInputType("text");
  }

  function handleCustomerSelect(customer: CustomerRecord) {
    openConsignee({
      id: customer.id,
      name: customer.name,
      code: customer.code || null,
    });
  }

  function handleSummarySelect(row: ConsigneeConversationSummaryItem) {
    openConsignee({
      id: row.customerId,
      name: row.customerName,
      code: row.customerCode,
    });
  }

  function handleBack() {
    setSelected(null);
    setDraft("");
    setDraftInputType("text");
    setConversations([]);
    void loadSummary();
  }

  async function handleSend() {
    if (!selected || sending || !canCreate) return;

    const remark = draft.trim();
    if (!remark) {
      toast.error("Enter a remark before sending.");
      return;
    }

    try {
      setSending(true);
      const created = await createConsigneeConversation(
        {
          customerId: selected.id,
          customerName: selected.name,
          customerCode: selected.code,
          originalRemark: remark,
          inputType: draftInputType,
        },
        { createdByName: profile?.displayName || profile?.email || "Unknown" }
      );

      setConversations((prev) => {
        if (prev.some((row) => row.id === created.id)) return prev;
        return [...prev, created];
      });
      setDraft("");
      setDraftInputType("text");
      void loadSummary();
    } catch (error) {
      console.error(error);
      toast.error("Unable to save this remark. Please try again.");
      // Keep draft text so the employee does not lose what they typed.
    } finally {
      setSending(false);
    }
  }

  if (!canView) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        You do not have permission to view Consignee Intelligence.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {!selected ? (
        <>
          <PageHeader
            title="Consignee Intelligence"
            buttonText="Select Consignee"
            onAdd={() => setLookupOpen(true)}
            showAddButton
            subtitle="Record relationship conversations with consignees. Choose a consignee to open their timeline."
          />

          <section className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">
                  Recent activity
                </h2>
                <p className="text-xs text-muted-foreground">
                  Consignees with recorded conversations
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLookupOpen(true)}
                className="shrink-0"
              >
                <Search className="mr-1.5 h-3.5 w-3.5" />
                Find
              </Button>
            </div>

            {summaryLoading ? (
              <p className="px-4 py-8 text-sm text-muted-foreground">
                Loading recent activity…
              </p>
            ) : summary.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                <MessageSquareText className="h-8 w-8 text-muted-foreground/70" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    No relationship conversations recorded yet.
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Select a consignee to start the first conversation.
                  </p>
                </div>
                <Button type="button" onClick={() => setLookupOpen(true)}>
                  Select Consignee
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {summary.map((row) => (
                  <li key={row.customerId}>
                    <button
                      type="button"
                      onClick={() => handleSummarySelect(row)}
                      className={cn(
                        "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors",
                        "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                      )}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="text-sm font-semibold text-foreground">
                          {row.customerName}
                        </span>
                        <RelativeCreatedTime
                          value={row.lastConversationAt}
                          className="text-xs text-muted-foreground"
                        />
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {row.customerCode ? (
                          <span>{row.customerCode}</span>
                        ) : null}
                        <span>
                          {row.conversationCount}{" "}
                          {row.conversationCount === 1
                            ? "conversation"
                            : "conversations"}
                        </span>
                        <span>Last by {row.lastCreatedByName}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <section className="flex min-h-[min(70vh,720px)] flex-col overflow-hidden rounded-xl border border-border bg-card">
          <header className="flex flex-col gap-3 border-b border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <div className="flex min-w-0 items-start gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={handleBack}
                aria-label="Back to consignee list"
                className="mt-0.5 shrink-0"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <p className="truncate font-heading text-base font-semibold text-foreground sm:text-lg">
                  {selected.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {selected.code ? `${selected.code} · ` : ""}
                  Relationship conversation
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLookupOpen(true)}
              className="w-full shrink-0 sm:w-auto"
            >
              Change consignee
            </Button>
          </header>

          <div
            ref={timelineScrollRef}
            className="flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-4"
          >
            {timelineLoading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Loading conversations…
              </p>
            ) : chronological.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                <MessageSquareText className="h-8 w-8 text-muted-foreground/70" />
                <p className="text-sm font-medium text-foreground">
                  No relationship conversations recorded yet.
                </p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Type the first remark below and press Send. Date and employee
                  are captured automatically.
                </p>
              </div>
            ) : (
              chronological.map((conversation) => (
                <ConversationEntry
                  key={conversation.id}
                  conversation={conversation}
                />
              ))
            )}
            <div ref={timelineEndRef} />
          </div>

          {canCreate ? (
            <ConversationComposer
              value={draft}
              onChange={setDraft}
              onSend={handleSend}
              sending={sending}
              inputType={draftInputType}
              onInputTypeChange={setDraftInputType}
            />
          ) : (
            <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
              You can view this timeline, but you do not have permission to add
              remarks.
            </div>
          )}
        </section>
      )}

      <CustomerLookup
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onSelect={handleCustomerSelect}
      />
    </div>
  );
}
