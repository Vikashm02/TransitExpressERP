import type { PageHelpContent } from "../types";

export const lrPageHelp: PageHelpContent = {
  pageId: "lr",
  title: "LR Entry कैसे काम करता है?",
  paragraphs: [
    "इस page पर Lorry Receipt (LR) बनाते और देखते हैं।",
    "Create LR से नया form खुलता है। अधूरा काम Draft रह सकता है — list में Continue से पूरा करें।",
    "पूरा होने पर Save LR दबाएँ। Search और Status / Freight Type filters से list छान सकते हैं।",
    "Cancel पर नया Create session का autosave draft हट सकता है; Continue Draft / Edit अलग हैं।",
  ],
  tourSteps: [
    {
      title: "LR Entry",
      body: "यहाँ LR बनाते और manage करते हैं। Create LR से नया entry शुरू करें।",
    },
    {
      title: "Draft और Continue",
      body: "Draft का मतलब काम अधूरा है। Continue से वही LR फिर खोलकर पूरा करें।",
    },
    {
      title: "Save LR",
      body: "Form भरने के बाद Save LR से record save होता है।",
    },
    {
      title: "Search / filters",
      body: "LR number, party या vehicle से search करें। Status filter से list छानें।",
    },
  ],
};

/** Field help — important / confusing LR fields only. */
export const lrFieldHelp = {
  lrNumber:
    "यह LR की पहचान का number है। नया form खोलते ही reserve नहीं होता — पहली draft autosave पर number reserve होता है।",
  lrDate: "यह LR बनाने / booking की तारीख है।",
  bookingBranch: "जिस branch से booking हो रही है, उसे यहाँ चुनें।",
  billingParty:
    "जिस party को bill लगेगा, उसे Billing Party Master से select करें। Free text नहीं लिख सकते।",
  gstPayableBy: "GST किस पक्ष से payable है — यहाँ चुनें।",
  consignor: "जिस party से माल भेजा जा रहा है, उसे यहाँ select करें।",
  consignee: "जिस party को माल deliver होना है, उसे यहाँ select करें।",
  vehicleNumber:
    "जिस गाड़ी से माल जाएगा, उसका Vehicle Number यहाँ लिखें या Search से चुनें।",
  transporter: "Transporter का नाम यहाँ भरें या Search से चुनें।",
  driverName: "Driver का नाम यहाँ भरें। Search से master से भी चुन सकते हैं।",
  materialDescription:
    "माल का संक्षिप्त विवरण यहाँ लिखें। नया / draft पूरा करते समय यह ज़रूरी हो सकता है।",
  freightType: "Freight कैसे charge होगा — यहाँ Freight Type चुनें।",
} as const;
