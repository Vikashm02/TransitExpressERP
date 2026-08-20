import type { RoleAwarePageHelp } from "../types";

/** Dashboard (Overview) — My work + Team (role-aware tour steps). */
export const dashboardHelp: RoleAwarePageHelp = {
  pageId: "dashboard",
  title: "Dashboard कैसे काम करता है?",
  paragraphs: [
    "यह आपका Dashboard है। यहाँ आपका अपना काम और pending items दिखाई देते हैं।",
    "Period filter से Today / This week / This month चुनकर numbers बदल सकते हैं।",
    "Needs Attention में Pending POD और LR Drafts दिखते हैं — वहाँ से सीधे module खोल सकते हैं.",
    "Draft का मतलब है कि LR अभी पूरा नहीं हुआ है। Continue करके बाद में पूरा करें।",
    "Recent Work में हाल का काम दिखता है।",
  ],
  tourSteps: [
    {
      title: "Dashboard",
      body: "यह आपका Dashboard है। यहाँ आपका काम और pending items दिखाई देते हैं।",
    },
    {
      title: "Period filter",
      body: "यहाँ Today / Week / Month चुनकर summary numbers बदल सकते हैं।",
    },
    {
      title: "Needs Attention",
      body: "Pending PODs और LR Drafts यहाँ दिखते हैं। काम बाकी हो तो यहीं से शुरू करें।",
    },
    {
      title: "Drafts और Recent",
      body: "Drafts में अधूरे LR, Recent Work में हाल का काम दिखता है।",
    },
  ],
};

export const teamDashboardHelpCreator: RoleAwarePageHelp = {
  pageId: "dashboard-team",
  roles: ["creator"],
  title: "Team Dashboard कैसे काम करता है?",
  paragraphs: [
    "Team Dashboard पर पूरी team का operational overview दिखाई देता है।",
    "Summary cards, open drafts / pending PODs, और staff-wise numbers यहाँ दिखते हैं।",
    "My Dashboard पर वापस जाने के लिए ऊपर My Dashboard बटन दबाएँ।",
  ],
  tourSteps: [
    {
      title: "Team Dashboard",
      body: "यहाँ पूरी team का operational overview दिखाई देता है।",
    },
    {
      title: "Staff list",
      body: "नीचे staff के drafts और pending PODs जैसी open items दिखती हैं।",
    },
  ],
};

export const teamDashboardHelpTier1: RoleAwarePageHelp = {
  pageId: "dashboard-team",
  roles: ["admin"],
  title: "Team Dashboard कैसे काम करता है?",
  paragraphs: [
    "Team Dashboard पर आपकी assigned Tier 2 team का काम दिखाई देता है।",
    "यहाँ team के drafts, pending PODs और period summary मिलते हैं।",
    "My Dashboard पर वापस जाने के लिए ऊपर My Dashboard बटन दबाएँ।",
  ],
  tourSteps: [
    {
      title: "Team Dashboard",
      body: "यहाँ आपकी assigned Tier 2 team का काम दिखाई देता है।",
    },
    {
      title: "Open items",
      body: "Drafts और Pending PODs team के लिए यहाँ दिखते हैं।",
    },
  ],
};
