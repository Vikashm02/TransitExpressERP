import type { TranslationDict } from "../types";

/** Phase 1 English UI strings — UI chrome only, never business data. */
const en: TranslationDict = {
  // Common
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.search": "Search",
  "common.loading": "Loading…",
  "common.pleaseWait": "Please wait...",
  "common.signOut": "Sign out",
  "common.openMenu": "Open menu",
  "common.closeMenu": "Close menu",
  "common.navigationMenu": "Navigation menu",
  "common.language": "Language",
  "common.english": "English",
  "common.hindi": "हिन्दी",

  // Roles / header
  "header.operationsConsole": "Operations console",
  "header.appName": "Transjit Express TMS",
  "header.administrator": "Administrator",
  "header.staff": "Staff",

  // Nav sections
  "nav.section.overview": "Overview",
  "nav.section.masters": "Masters",
  "nav.section.operations": "Operations",
  "nav.section.finance": "Finance",
  "nav.section.administration": "Administration",

  // Nav items
  "nav.dashboard": "Dashboard",
  "nav.company": "Company Master",
  "nav.customers": "Customer Master",
  "nav.billingParties": "Billing Party Master",
  "nav.vehicle": "Vehicle Master",
  "nav.material": "Material Master",
  "nav.lr": "LR Entry",
  "nav.pod": "POD Entry",
  "nav.deliveryChallans": "Delivery Challan",
  "nav.asn": "ASN Creation",
  "nav.lorryExpenses": "Financials",
  "nav.billing": "Billing",
  "nav.creditNotes": "Credit Note",
  "nav.debitNotes": "Debit Note",
  "nav.ledger": "Ledger",
  "nav.reports": "Reports",
  "nav.settings": "Settings",
  "nav.staff": "Staff",

  // Auth / login
  "auth.brandEyebrow": "Transjit Express",
  "auth.brandHeadline": "Logistics control, built for the yard.",
  "auth.brandSub":
    "LR · POD · Delivery · Financials — one operational console for the team on the move.",
  "auth.appTitle": "Transjit Express TMS",
  "auth.signInDescription": "Sign in to your staff account.",
  "auth.signUpDescription": "Create your staff account.",
  "auth.signIn": "Sign In",
  "auth.signUp": "Sign Up",
  "auth.createAccount": "Create Account",
  "auth.yourName": "Your Name",
  "auth.yourNamePlaceholder": "e.g. Roshan",
  "auth.email": "Email",
  "auth.emailPlaceholder": "you@example.com",
  "auth.password": "Password",
  "auth.forgotPassword": "Forgot password?",
  "auth.signUpHint":
    "New accounts always start as Staff and require Administrator approval before you can sign in and use the app.",
  "auth.emailPasswordRequired": "Email and password are required.",
  "auth.accountCreated":
    "Account created. Your account is awaiting administrator approval.",
  "auth.signedIn": "Signed in successfully.",
  "auth.unableToSignIn": "Unable to sign in.",

  // Forgot password
  "auth.forgot.title": "Reset password",
  "auth.forgot.backToSignIn": "Back to sign in",
  "auth.forgot.backToLogin": "Back to Login",
  "auth.forgot.back": "Back",
  "auth.forgot.stepRequest": "Forgot Password",
  "auth.forgot.stepVerify": "Verify your email",
  "auth.forgot.stepPassword": "Create a new password",
  "auth.forgot.stepDone": "Password updated successfully.",
  "auth.forgot.descRequest":
    "Enter your registered email address and we'll send you a verification code.",
  "auth.forgot.descVerify": "Enter the verification code sent to your registered email.",
  "auth.forgot.descPassword": "Choose a new password for your account.",
  "auth.forgot.descDone": "You can now sign in with your new password.",
  "auth.forgot.brandAlt": "Transjit Express",
  "auth.forgot.sending": "Sending...",
  "auth.forgot.sendCode": "Send verification code",
  "auth.forgot.verificationCode": "Verification code",
  "auth.forgot.enterCode": "Enter code",
  "auth.forgot.verifying": "Verifying...",
  "auth.forgot.verifyCode": "Verify code",
  "auth.forgot.resendCode": "Resend code",
  "auth.forgot.resendCodeCooldown": "Resend code ({seconds}s)",
  "auth.forgot.newPassword": "New password",
  "auth.forgot.confirmNewPassword": "Confirm new password",
  "auth.forgot.updating": "Updating...",
  "auth.forgot.resetPassword": "Reset password",
  "auth.forgot.passwordUpdatedBody": "Password updated successfully.",
  "auth.forgot.orGoDirectly": "Or go directly to",
  "auth.forgot.codeSent":
    "If an account exists for this email address, a verification code has been sent.",
  "auth.forgot.verificationSucceeded":
    "Verification succeeded. Create a new password to finish resetting your account.",
  "auth.forgot.emailRequired": "Email is required.",
  "auth.forgot.invalidEmail": "Enter a valid email address.",
  "auth.forgot.otpRequired": "Enter the verification code from your email.",
  "auth.forgot.confirmRequired": "Confirm your new password.",
  "auth.forgot.passwordsDoNotMatch": "Passwords do not match.",
  "auth.forgot.passwordHint": "At least {min} characters.",
  "auth.forgot.newPasswordRequired": "New password is required.",
  "auth.forgot.passwordTooShort": "Password must be at least {min} characters.",
  "auth.forgot.rateLimited": "Too many requests. Please wait a moment and try again.",
  "auth.forgot.unableToSend":
    "Unable to send a verification code right now. Please try again later.",
  "auth.forgot.invalidOrExpiredCode":
    "That verification code is invalid or has expired. Request a new code and try again.",
  "auth.forgot.passwordNotStrong":
    "That password does not meet the requirements. Please choose a stronger password.",
  "auth.forgot.differentPassword":
    "Choose a password that is different from your current password.",
  "auth.forgot.networkError": "Network error. Check your connection and try again.",
  "auth.forgot.sessionExpired":
    "Your reset session has expired. Request a new verification code.",
  "auth.forgot.unableToUpdate":
    "Unable to update your password. Request a new verification code and try again.",

  // Overview (Phase 1B) — static UI only
  "overview.myWork": "My work",
  "overview.greeting.morning": "Good morning",
  "overview.greeting.afternoon": "Good afternoon",
  "overview.greeting.evening": "Good evening",
  "overview.greeting.fallbackName": "there",
  "overview.subtitle":
    "Your operational activity for the selected period. Open drafts and pending POD stay visible until finished.",
  "overview.period.today": "Today",
  "overview.period.week": "This Week",
  "overview.period.month": "This Month",
  "overview.period.custom": "Custom",
  "overview.period.label": "Period",
  "overview.period.fromDate": "From Date",
  "overview.period.toDate": "To Date",
  "overview.period.apply": "Apply",
  "overview.cards.myLrs": "My LRs",
  "overview.cards.createdInPeriod": "Created in period",
  "overview.cards.lrUpdates": "LR Updates",
  "overview.cards.editsInPeriod": "Edits in period",
  "overview.cards.pods": "PODs",
  "overview.cards.pendingPod": "Pending POD",
  "overview.cards.stillOpen": "Still open",
  "overview.cards.drafts": "Drafts",
  "overview.cards.openLrDrafts": "Open LR drafts",
  "overview.cards.dcAsn": "DC / ASN",
  "overview.cards.noPermissions":
    "No module permissions are available for overview metrics.",
  "overview.attention.title": "Needs Attention",
  "overview.attention.subtitle":
    "Open work that still needs you — not limited to the selected period.",
  "overview.attention.pendingPodHint":
    "Final LRs you created or are assigned, still without POD",
  "overview.attention.lrDrafts": "LR Drafts",
  "overview.attention.draftsHint": "Incomplete LRs you can continue",
  "overview.attention.view": "View",
  "overview.attention.resumeDrafts": "Resume Drafts",
  "overview.drafts.title": "My Drafts",
  "overview.drafts.subtitle":
    "Incomplete LRs. Status is Draft — field values are your real data only.",
  "overview.drafts.loading": "Loading drafts…",
  "overview.drafts.empty": "No pending drafts",
  "overview.drafts.incomplete": "Incomplete",
  "overview.drafts.vehicle": "Vehicle",
  "overview.drafts.updated": "Updated",
  "overview.drafts.resume": "Resume",
  "overview.recent.title": "Recent Work",
  "overview.recent.subtitle":
    "Derived from last create/update timestamps — not a full audit history.",
  "overview.recent.loading": "Loading recent work…",
  "overview.recent.empty": "No recent work yet.",
  "overview.recent.created": "Created",
  "overview.recent.updated": "Updated",
  "overview.module.lr": "LR",
  "overview.module.pod": "POD",
  "overview.module.dc": "Delivery Challan",
  "overview.module.asn": "ASN",
  "overview.standing.title": "Where I Stand",
  "overview.standing.subtitle":
    "Fixed windows for today and this month. Pending and drafts are open queues.",
  "overview.standing.todaysWork": "Today's Work",
  "overview.standing.thisMonth": "This Month",
  "overview.standing.created": "Created",
  "overview.standing.updated": "Updated",
  "overview.standing.pendingPod": "Pending POD",
  "overview.standing.drafts": "Drafts",
  "overview.loadError":
    "Unable to load your overview. Confirm migration 037 is applied.",
};

export default en;
