import type { PageHelpContent } from "../types";

export const lrPageHelp: PageHelpContent = {
  pageId: "lr",
  title: "LR Entry कैसे काम करता है?",
  paragraphs: [
    "इस page पर Lorry Receipt (LR) बनाते और देखते हैं।",
    "Create LR से नया form खुलता है। अधूरा काम Draft रह सकता है — list में Continue से पूरा करें।",
    "पूरा होने पर Save LR दबाएँ। Search और Status / Freight Type filters से list छान सकते हैं।",
    "Consignor या Consignee भरते ही real LR number reserve हो जाता है और draft save होता है। Cancel करने पर numbered draft list में रहता है — number वापस नहीं जाता।",
  ],
  tourSteps: [
    {
      title: "LR Entry",
      body: "यहाँ LR बनाते और manage करते हैं। Create LR से नया entry शुरू करें।",
    },
    {
      title: "Draft और Continue",
      body: "Draft का मतलब काम अधूरा है। Continue से वही LR (उसी number के साथ) फिर खोलकर पूरा करें।",
    },
    {
      title: "Save LR",
      body: "Form भरने के बाद Save LR से record final होता है — LR number वही रहता है।",
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
    "खाली form पर number नहीं लगता। Consignor या Consignee भरते ही next real LR number reserve हो जाता है। वही number final Save तक रहता है।",
  lrDate: "यह LR बनाने / booking की तारीख है।",
  bookingBranch: "जिस branch से booking हो रही है, उसे यहाँ चुनें।",
  billingParty:
    "जिस party को bill लगेगा, उसे Billing Party Master से select करें। Free text नहीं लिख सकते।",
  gstPayableBy: "GST किस पक्ष से payable है — यहाँ चुनें।",
  consignor: "जिस party से माल भेजा जा रहा है, उसे यहाँ select करें।",
  consignee: "जिस party को माल deliver होना है, उसे यहाँ select करें।",
  vehicleNumber:
    "जिस गाड़ी से माल जाएगा, उसका Vehicle Number यहाँ लिखें या Search से चुनें।",
  vehicleType: "Vehicle का type यहाँ select करें।",
  transporter: "इस vehicle से जुड़ा transporter यहाँ select करें।",
  driverName: "इस LR के लिए current driver का नाम यहाँ डालें।",
  driverMobile: "Current driver का mobile number यहाँ डालें।",
  materialDescription:
    "माल का संक्षिप्त विवरण यहाँ लिखें। नया / draft पूरा करते समय यह ज़रूरी हो सकता है।",
  freightType: "Freight कैसे charge होगा — यहाँ Freight Type चुनें।",
} as const;
