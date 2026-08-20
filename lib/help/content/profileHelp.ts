import type { PageHelpContent } from "../types";

export const profilePageHelp: PageHelpContent = {
  pageId: "profile",
  title: "Profile कैसे काम करता है?",
  paragraphs: [
    "यहाँ आपका नाम, email / login ID, और Role दिखता है। नाम Admin Staff management से बदलते हैं।",
    "Role: Creator, Tier 1, या Tier 2 — इससे कौन से admin screens दिखते हैं, तय होता है।",
    "Security में password बदल सकते हैं और अन्य devices से sign out कर सकते हैं।",
    "Current Device इस browser की जानकारी दिखाता है — सिर्फ इस device पर।",
    "Learning Mode चालू होने पर pages और fields की छोटी मदद दिखती है। यह आपके account में save होती है।",
    "Theme और Default landing page इस device पर रहते हैं; Learning Mode server पर रहता है।",
  ],
  tourSteps: [
    {
      title: "Profile",
      body: "यहाँ आपकी personal और security जानकारी है।",
    },
    {
      title: "Learning Mode",
      body: "Learning Mode ON करें तो ERP pages पर छोटी Hindi मदद दिखेगी। OFF पर साफ interface रहेगा।",
    },
    {
      title: "Security",
      body: "Password बदलें या अन्य sessions से sign out करें।",
    },
  ],
};
