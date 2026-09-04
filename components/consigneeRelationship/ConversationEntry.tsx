"use client";

import RelativeCreatedTime from "@/components/common/RelativeCreatedTime";
import { formatAbsoluteCreatedAt } from "@/lib/relativeCreatedTime";
import type { ConsigneeConversation } from "@/components/services/consigneeRelationship.service";

interface ConversationEntryProps {
  conversation: ConsigneeConversation;
}

export default function ConversationEntry({
  conversation,
}: ConversationEntryProps) {
  const absolute = formatAbsoluteCreatedAt(conversation.createdAt);

  return (
    <article className="rounded-xl border border-border/70 bg-card px-3.5 py-3 shadow-xs sm:px-4">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold text-foreground">
          {conversation.createdByName}
        </p>
        <p
          className="text-xs text-muted-foreground"
          title={absolute ? `Communication: ${absolute}` : undefined}
        >
          <RelativeCreatedTime value={conversation.createdAt} className="text-xs" />
        </p>
      </header>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
        {conversation.originalRemark}
      </p>
    </article>
  );
}
