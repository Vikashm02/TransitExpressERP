"use client";

import RelativeCreatedTime from "@/components/common/RelativeCreatedTime";
import { formatAbsoluteCreatedAt } from "@/lib/relativeCreatedTime";
import type { SupplierConversation } from "@/components/services/supplierIntelligence.service";
import { Mic, Type } from "lucide-react";

interface ConversationEntryProps {
  conversation: SupplierConversation;
}

export default function ConversationEntry({
  conversation,
}: ConversationEntryProps) {
  const absolute = formatAbsoluteCreatedAt(conversation.occurredAt);
  const personLabel =
    conversation.personNameSnapshot ||
    (conversation.personId ? "Contact" : "Organization note");
  const designation = conversation.personDesignationSnapshot;
  const orgLabel = conversation.organizationNameSnapshot;

  return (
    <article className="rounded-xl border border-border/70 border-l-[3px] border-l-primary/45 bg-card px-3.5 py-3 shadow-xs sm:px-4">
      <header className="mb-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{personLabel}</p>
          <p className="text-xs text-muted-foreground">
            {[designation, orgLabel].filter(Boolean).join(" · ") || "Conversation"}
            {conversation.title ? ` · ${conversation.title}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p
            className="text-xs text-muted-foreground"
            title={absolute ? `Occurred: ${absolute}` : undefined}
          >
            <RelativeCreatedTime
              value={conversation.occurredAt}
              className="text-xs"
            />
          </p>
          <span className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary/80">
            {conversation.inputType === "voice" ? (
              <>
                <Mic className="h-3 w-3" />
                Voice
              </>
            ) : (
              <>
                <Type className="h-3 w-3" />
                Text
              </>
            )}
          </span>
        </div>
      </header>

      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
        {conversation.originalText}
      </p>

      <footer className="mt-2 text-[11px] text-muted-foreground">
        Logged by {conversation.loggedByName}
      </footer>
    </article>
  );
}
