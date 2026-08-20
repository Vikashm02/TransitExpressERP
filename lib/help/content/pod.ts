import type { PageHelpContent } from "../types";

export const podPageHelp: PageHelpContent = {
  pageId: "pod",
  title: "POD Entry कैसे काम करता है?",
  paragraphs: [
    "POD मतलब Proof of Delivery — delivery confirm करने का record।",
    "Dashboard पर Pending POD वो LR हैं जिनकी delivery अभी confirm नहीं हुई।",
    "Add POD से form खोलें। पहले LR Number Search करके सही LR चुनें।",
    "POD Date, Unloading Weight, Unloading Date और Proof file भरें, फिर Save करें।",
    "Settlement / hire पैसे यहाँ नहीं भरते — वे Financials module में जाते हैं।",
  ],
  tourSteps: [
    {
      title: "POD Entry",
      body: "यहाँ delivery (POD) record बनाते और देखते हैं।",
    },
    {
      title: "Pending POD",
      body: "Pending POD का मतलब delivery अभी confirm नहीं हुई। Dashboard Needs Attention से भी यहाँ आ सकते हैं।",
    },
    {
      title: "LR चुनें",
      body: "Add POD में पहले Search से LR चुनें। Consignor / Vehicle जैसे details LR से दिखते हैं।",
    },
    {
      title: "Proof upload",
      body: "Proof of POD में PDF या photo upload करें। Save से record जुड़ता है।",
    },
  ],
};

export const podFieldHelp = {
  lrNumber:
    "जिस LR की delivery confirm करनी है, Search से वही LR चुनें।",
  podDate: "Delivery / POD की तारीख यहाँ चुनें।",
  unloadingWeight: "Unload होने पर जो weight मिला, वह यहाँ लिखें।",
  unloadingDate: "Unload होने की तारीख यहाँ चुनें।",
  proofUrl:
    "Delivery का proof (PDF / photo) यहाँ Upload करें। बाद में View से देख सकते हैं।",
} as const;
