import type { TranslationDict } from "../types";

/** Phase 1 Hindi UI strings — labels only; business values stay unchanged. */
const hi: TranslationDict = {
  // Common
  "common.save": "सहेजें",
  "common.cancel": "रद्द करें",
  "common.close": "बंद करें",
  "common.search": "खोजें",
  "common.loading": "लोड हो रहा है…",
  "common.pleaseWait": "कृपया प्रतीक्षा करें...",
  "common.signOut": "साइन आउट",
  "common.openMenu": "मेनू खोलें",
  "common.closeMenu": "मेनू बंद करें",
  "common.navigationMenu": "नेविगेशन मेनू",
  "common.language": "भाषा",
  "common.english": "English",
  "common.hindi": "हिन्दी",

  // Roles / header
  "header.operationsConsole": "ऑपरेशन कंसोल",
  "header.appName": "Transjit Express TMS",
  "header.administrator": "प्रशासक",
  "header.staff": "स्टाफ़",

  // Nav sections
  "nav.section.overview": "अवलोकन",
  "nav.section.masters": "मास्टर",
  "nav.section.operations": "संचालन",
  "nav.section.finance": "वित्त",
  "nav.section.administration": "प्रशासन",

  // Nav items
  "nav.dashboard": "डैशबोर्ड",
  "nav.profile": "प्रोफ़ाइल",
  "nav.company": "कंपनी मास्टर",
  "nav.customers": "ग्राहक मास्टर",
  "nav.billingParties": "बिलिंग पार्टी मास्टर",
  "nav.vehicle": "वाहन मास्टर",
  "nav.material": "सामग्री मास्टर",
  "nav.lr": "एलआर एंट्री",
  "nav.pod": "पीओडी एंट्री",
  "nav.deliveryChallans": "डिलीवरी चालान",
  "nav.asn": "एएसएन निर्माण",
  "nav.lorryExpenses": "वित्तीय",
  "nav.billing": "बिलिंग",
  "nav.creditNotes": "क्रेडिट नोट",
  "nav.debitNotes": "डेबिट नोट",
  "nav.ledger": "खाता बही",
  "nav.reports": "रिपोर्ट",
  "nav.settings": "सेटिंग्स",
  "nav.staff": "स्टाफ़",

  // Auth / login
  "auth.brandEyebrow": "Transjit Express",
  "auth.brandHeadline": "यार्ड के लिए बना लॉजिस्टिक्स नियंत्रण।",
  "auth.brandSub":
    "एलआर · पीओडी · डिलीवरी · वित्तीय — चलती टीम के लिए एक ऑपरेशनल कंसोल।",
  "auth.appTitle": "Transjit Express TMS",
  "auth.signInDescription": "अपने स्टाफ़ खाते में साइन इन करें।",
  "auth.signUpDescription": "अपना स्टाफ़ खाता बनाएँ।",
  "auth.signIn": "साइन इन",
  "auth.signUp": "साइन अप",
  "auth.createAccount": "खाता बनाएँ",
  "auth.yourName": "आपका नाम",
  "auth.yourNamePlaceholder": "उदा. रोशन",
  "auth.email": "ईमेल",
  "auth.emailPlaceholder": "you@example.com",
  "auth.password": "पासवर्ड",
  "auth.forgotPassword": "पासवर्ड भूल गए?",
  "auth.signUpHint":
    "नए खाते हमेशा स्टाफ़ के रूप में शुरू होते हैं और ऐप उपयोग से पहले प्रशासक की स्वीकृति आवश्यक है।",
  "auth.emailPasswordRequired": "ईमेल और पासवर्ड आवश्यक हैं।",
  "auth.accountCreated":
    "खाता बन गया। आपका खाता प्रशासक की स्वीकृति की प्रतीक्षा में है।",
  "auth.signedIn": "सफलतापूर्वक साइन इन हो गए।",
  "auth.unableToSignIn": "साइन इन नहीं हो सका।",

  // Forgot password
  "auth.forgot.title": "पासवर्ड रीसेट करें",
  "auth.forgot.backToSignIn": "साइन इन पर वापस जाएँ",
  "auth.forgot.backToLogin": "लॉगिन पर वापस जाएँ",
  "auth.forgot.back": "वापस",
  "auth.forgot.stepRequest": "पासवर्ड भूल गए",
  "auth.forgot.stepVerify": "अपना ईमेल सत्यापित करें",
  "auth.forgot.stepPassword": "नया पासवर्ड बनाएँ",
  "auth.forgot.stepDone": "पासवर्ड सफलतापूर्वक अपडेट हो गया।",
  "auth.forgot.descRequest":
    "अपना पंजीकृत ईमेल पता दर्ज करें और हम आपको एक सत्यापन कोड भेजेंगे।",
  "auth.forgot.descVerify": "अपने पंजीकृत ईमेल पर भेजा गया सत्यापन कोड दर्ज करें।",
  "auth.forgot.descPassword": "अपने खाते के लिए नया पासवर्ड चुनें।",
  "auth.forgot.descDone": "अब आप अपने नए पासवर्ड से साइन इन कर सकते हैं।",
  "auth.forgot.brandAlt": "Transjit Express",
  "auth.forgot.sending": "भेजा जा रहा है...",
  "auth.forgot.sendCode": "सत्यापन कोड भेजें",
  "auth.forgot.verificationCode": "सत्यापन कोड",
  "auth.forgot.enterCode": "कोड दर्ज करें",
  "auth.forgot.verifying": "सत्यापित हो रहा है...",
  "auth.forgot.verifyCode": "कोड सत्यापित करें",
  "auth.forgot.resendCode": "कोड पुनः भेजें",
  "auth.forgot.resendCodeCooldown": "कोड पुनः भेजें ({seconds}से)",
  "auth.forgot.newPassword": "नया पासवर्ड",
  "auth.forgot.confirmNewPassword": "नया पासवर्ड पुष्टि करें",
  "auth.forgot.updating": "अपडेट हो रहा है...",
  "auth.forgot.resetPassword": "पासवर्ड रीसेट करें",
  "auth.forgot.passwordUpdatedBody": "पासवर्ड सफलतापूर्वक अपडेट हो गया।",
  "auth.forgot.orGoDirectly": "या सीधे जाएँ",
  "auth.forgot.codeSent":
    "यदि इस ईमेल पते का खाता मौजूद है, तो एक सत्यापन कोड भेज दिया गया है।",
  "auth.forgot.verificationSucceeded":
    "सत्यापन सफल। खाता रीसेट पूरा करने के लिए नया पासवर्ड बनाएँ।",
  "auth.forgot.emailRequired": "ईमेल आवश्यक है।",
  "auth.forgot.invalidEmail": "मान्य ईमेल पता दर्ज करें।",
  "auth.forgot.otpRequired": "अपने ईमेल से प्राप्त सत्यापन कोड दर्ज करें।",
  "auth.forgot.confirmRequired": "अपना नया पासवर्ड पुष्टि करें।",
  "auth.forgot.passwordsDoNotMatch": "पासवर्ड मेल नहीं खाते।",
  "auth.forgot.passwordHint": "कम से कम {min} अक्षर।",
  "auth.forgot.newPasswordRequired": "नया पासवर्ड आवश्यक है।",
  "auth.forgot.passwordTooShort": "पासवर्ड कम से कम {min} अक्षर का होना चाहिए।",
  "auth.forgot.rateLimited":
    "बहुत अधिक अनुरोध। कृपया थोड़ी देर प्रतीक्षा करें और फिर कोशिश करें।",
  "auth.forgot.unableToSend":
    "अभी सत्यापन कोड नहीं भेजा जा सका। कृपया बाद में पुनः प्रयास करें।",
  "auth.forgot.invalidOrExpiredCode":
    "वह सत्यापन कोड अमान्य है या समाप्त हो गया है। नया कोड माँगें और पुनः प्रयास करें।",
  "auth.forgot.passwordNotStrong":
    "वह पासवर्ड आवश्यकताओं को पूरा नहीं करता। कृपया मज़बूत पासवर्ड चुनें।",
  "auth.forgot.differentPassword":
    "ऐसा पासवर्ड चुनें जो आपके वर्तमान पासवर्ड से अलग हो।",
  "auth.forgot.networkError":
    "नेटवर्क त्रुटि। अपना कनेक्शन जाँचें और पुनः प्रयास करें।",
  "auth.forgot.sessionExpired":
    "आपका रीसेट सत्र समाप्त हो गया है। नया सत्यापन कोड माँगें।",
  "auth.forgot.unableToUpdate":
    "पासवर्ड अपडेट नहीं हो सका। नया सत्यापन कोड माँगें और पुनः प्रयास करें।",

  // Overview (Phase 1B) — static UI only
  "overview.myWork": "मेरा काम",
  "overview.greeting.morning": "शुभ प्रभात",
  "overview.greeting.afternoon": "शुभ दोपहर",
  "overview.greeting.evening": "शुभ संध्या",
  "overview.greeting.fallbackName": "आप",
  "overview.subtitle":
    "चयनित अवधि के लिए आपकी परिचालन गतिविधि। खुले ड्राफ्ट और लंबित POD पूरे होने तक दिखते रहेंगे।",
  "overview.period.today": "आज",
  "overview.period.week": "इस सप्ताह",
  "overview.period.month": "इस माह",
  "overview.period.custom": "कस्टम",
  "overview.period.label": "अवधि",
  "overview.period.fromDate": "प्रारंभ तिथि",
  "overview.period.toDate": "समाप्ति तिथि",
  "overview.period.apply": "लागू करें",
  "overview.cards.myLrs": "मेरे LR",
  "overview.cards.createdInPeriod": "अवधि में बनाए गए",
  "overview.cards.lrUpdates": "LR अपडेट",
  "overview.cards.editsInPeriod": "अवधि में संपादन",
  "overview.cards.pods": "POD",
  "overview.cards.pendingPod": "लंबित POD",
  "overview.cards.stillOpen": "अभी खुले",
  "overview.cards.drafts": "ड्राफ्ट",
  "overview.cards.openLrDrafts": "खुले LR ड्राफ्ट",
  "overview.cards.dcAsn": "DC / ASN",
  "overview.cards.noPermissions":
    "अवलोकन मेट्रिक्स के लिए कोई मॉड्यूल अनुमति उपलब्ध नहीं है।",
  "overview.attention.title": "ध्यान दें",
  "overview.attention.subtitle":
    "वह खुला काम जो अभी आपसे बाकी है — चयनित अवधि तक सीमित नहीं।",
  "overview.attention.pendingPodHint":
    "आपके बनाए या असाइन किए Final LR जिनका POD अभी नहीं है",
  "overview.attention.lrDrafts": "LR ड्राफ्ट",
  "overview.attention.draftsHint": "अधूरे LR जिन्हें आप जारी रख सकते हैं",
  "overview.attention.view": "देखें",
  "overview.attention.resumeDrafts": "ड्राफ्ट जारी रखें",
  "overview.drafts.title": "मेरे ड्राफ्ट",
  "overview.drafts.subtitle":
    "अधूरे LR। स्थिति ड्राफ्ट है — फ़ील्ड में केवल आपका वास्तविक डेटा है।",
  "overview.drafts.loading": "ड्राफ्ट लोड हो रहे हैं…",
  "overview.drafts.empty": "कोई लंबित ड्राफ्ट नहीं",
  "overview.drafts.incomplete": "अधूरा",
  "overview.drafts.vehicle": "वाहन",
  "overview.drafts.updated": "अपडेट",
  "overview.drafts.resume": "जारी रखें",
  "overview.recent.title": "हाल का काम",
  "overview.recent.subtitle":
    "अंतिम निर्माण/अपडेट समय से प्राप्त — पूर्ण ऑडिट इतिहास नहीं।",
  "overview.recent.loading": "हाल का काम लोड हो रहा है…",
  "overview.recent.empty": "अभी कोई हाल का काम नहीं।",
  "overview.recent.created": "बनाया गया",
  "overview.recent.updated": "अपडेट किया गया",
  "overview.module.lr": "LR",
  "overview.module.pod": "POD",
  "overview.module.dc": "डिलीवरी चालान",
  "overview.module.asn": "ASN",
  "overview.standing.title": "मेरी स्थिति",
  "overview.standing.subtitle":
    "आज और इस माह की निश्चित अवधि। लंबित और ड्राफ्ट खुली कतारें हैं।",
  "overview.standing.todaysWork": "आज का काम",
  "overview.standing.thisMonth": "इस माह",
  "overview.standing.created": "बनाए गए",
  "overview.standing.updated": "अपडेट किए गए",
  "overview.standing.pendingPod": "लंबित POD",
  "overview.standing.drafts": "ड्राफ्ट",
  "overview.loadError":
    "आपका अवलोकन लोड नहीं हो सका। पुष्टि करें कि माइग्रेशन 037–038 लागू हैं।",

  // Overview efficiency (Phase ops)
  "overview.efficiency.title": "मेरे संचालन",
  "overview.efficiency.subtitle":
    "पूर्णता और गुणवत्ता चयनित अवधि पर आधारित हैं। ड्राफ्ट और लंबित POD खुली कतारें हैं।",
  "overview.efficiency.noData": "कोई डेटा नहीं",
  "overview.efficiency.daysCount": "{days} दिन",
  "overview.efficiency.bucket.today": "आज",
  "overview.efficiency.bucket.days12": "1–2 दिन",
  "overview.efficiency.bucket.days37": "3–7 दिन",
  "overview.efficiency.bucket.days7Plus": "7+ दिन",
  "overview.efficiency.completion.title": "औसत LR पूर्णता समय",
  "overview.efficiency.completion.minutes": "मिनट",
  "overview.efficiency.completion.basedOn": "{count} पूर्ण LR के आधार पर",
  "overview.efficiency.quality.title": "LR गुणवत्ता",
  "overview.efficiency.quality.editsOverLrs": "{edits} संपादन / {lrs} LR",
  "overview.efficiency.quality.editRate": "संपादन दर {rate}%",
  "overview.efficiency.quality.trackingNotice":
    "सटीक संपादन ट्रैकिंग {date} से शुरू हुई। उससे पहले की गुणवत्ता अधूरी है।",
  "overview.efficiency.draftAge.title": "मेरे LR ड्राफ्ट — समयरेखा",
  "overview.efficiency.draftAge.subtitle":
    "आयु के अनुसार खुले ड्राफ्ट। चयनित अवधि से स्वतंत्र।",
  "overview.efficiency.draftAge.oldest": "सबसे पुराना ड्राफ्ट:",
  "overview.efficiency.podAge.title": "लंबित POD आयु",
  "overview.efficiency.podAge.subtitle":
    "आयु के अनुसार लंबित POD। ध्यान दें वाली वही व्यक्तिगत नियम।",
  "overview.efficiency.podAge.oldest": "सबसे पुराना लंबित:",
  "overview.efficiency.podAge.total": "कुल लंबित POD",
};

export default hi;
