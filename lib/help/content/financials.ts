import type { PageHelpContent } from "../types";

/** Operations section: Financials (lorry expenses) — based on actual UI labels. */
export const financialsPageHelp: PageHelpContent = {
  pageId: "financials",
  title: "Financials कैसे काम करता है?",
  paragraphs: [
    "Financials में LR से जुड़ी hire, expenses और settlement भरते हैं।",
    "Add Financials से नया entry। पहले Linked LR चुनें।",
    "Billing Details, Lorry Hire, Expenses और Settlement अलग sections में हैं।",
    "POD form में settlement नहीं भरते — वे यहीं जाते हैं।",
  ],
  tourSteps: [
    {
      title: "Financials",
      body: "यहाँ LR की hire / expense / settlement details manage होती हैं।",
    },
    {
      title: "Linked LR",
      body: "पहले वो LR चुनें जिसकी financials भरनी हैं।",
    },
    {
      title: "Sections",
      body: "Hire, Expenses और Settlement अलग-अलग भरें, फिर Save करें।",
    },
  ],
};
