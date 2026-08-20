/**
 * Approximate, display-only device/browser/OS labels from browser UA APIs.
 * Not persisted, not a hardware fingerprint, not a unique device identity.
 */

export type DeviceType = "desktop" | "tablet" | "phone" | "unknown";

export interface DeviceInfo {
  deviceType: DeviceType;
  /** Human label, e.g. "Desktop", "Phone", "Unknown device" */
  deviceTypeLabel: string;
  operatingSystem: string;
  browser: string;
}

type NavigatorUAData = {
  mobile?: boolean;
  platform?: string;
  brands?: Array<{ brand: string; version: string }>;
};

function readUa(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent || "";
}

function readUaData(): NavigatorUAData | null {
  if (typeof navigator === "undefined") return null;
  const data = (navigator as Navigator & { userAgentData?: NavigatorUAData })
    .userAgentData;
  return data ?? null;
}

function detectBrowser(ua: string, uaData: NavigatorUAData | null): string {
  const brands = uaData?.brands?.map((b) => b.brand.toLowerCase()) ?? [];

  // Prefer Client Hints brands when present (Chromium).
  if (brands.some((b) => b.includes("microsoft edge"))) return "Edge";
  if (brands.some((b) => b.includes("opera"))) return "Opera";
  if (brands.some((b) => b.includes("google chrome") || b === "chrome")) {
    return "Chrome";
  }
  if (brands.some((b) => b.includes("chromium"))) return "Chromium";

  const lower = ua.toLowerCase();

  // Order matters: Edge/Opera include Chrome in UA; Firefox before Safari checks.
  if (lower.includes("edg/") || lower.includes("edga/") || lower.includes("edgios/")) {
    return "Edge";
  }
  if (lower.includes("opr/") || lower.includes("opera")) return "Opera";
  if (lower.includes("firefox/") || lower.includes("fxios/")) return "Firefox";
  if (lower.includes("crios/")) return "Chrome";
  if (lower.includes("chrome/") && !lower.includes("chromium")) return "Chrome";
  if (lower.includes("chromium")) return "Chromium";
  // Safari: has Safari but not Chrome/Chromium/Android WebView markers above.
  if (
    lower.includes("safari/") &&
    !lower.includes("chrome/") &&
    !lower.includes("chromium") &&
    !lower.includes("android")
  ) {
    return "Safari";
  }
  if (lower.includes("samsungbrowser/")) return "Samsung Internet";

  return "Unknown browser";
}

function detectOperatingSystem(ua: string, uaData: NavigatorUAData | null): string {
  const platform = (uaData?.platform || "").toLowerCase();
  const lower = ua.toLowerCase();

  if (platform === "macos" || platform.includes("mac")) return "macOS";
  if (platform === "windows" || platform.includes("win")) return "Windows";
  if (platform === "android") return "Android";
  if (platform === "ios" || platform === "iphone" || platform === "ipad") {
    return platform === "ipad" || lower.includes("ipad") ? "iPadOS" : "iOS";
  }
  if (platform.includes("linux") || platform === "chrome os" || platform === "cros") {
    if (lower.includes("cros") || platform.includes("cros") || platform.includes("chrome")) {
      return "Chrome OS";
    }
    return "Linux";
  }

  if (/iphone|ipod/.test(lower)) return "iOS";
  if (/ipad/.test(lower)) return "iPadOS";
  // iPadOS desktop mode often reports Macintosh + touch.
  if (
    /macintosh/.test(lower) &&
    typeof document !== "undefined" &&
    "ontouchend" in document
  ) {
    return "iPadOS";
  }
  if (/mac os x|macintosh/.test(lower)) return "macOS";
  if (/windows nt|win64|win32/.test(lower)) return "Windows";
  if (/android/.test(lower)) return "Android";
  if (/cros/.test(lower)) return "Chrome OS";
  if (/linux/.test(lower)) return "Linux";

  return "Unknown OS";
}

function detectDeviceType(ua: string, uaData: NavigatorUAData | null): DeviceType {
  const lower = ua.toLowerCase();

  // Explicit phone / tablet markers first.
  if (/iphone|ipod/.test(lower)) return "phone";
  if (/ipad/.test(lower)) return "tablet";
  if (/android/.test(lower)) {
    // Android without "Mobile" is commonly a tablet.
    if (!/mobile/.test(lower)) return "tablet";
    return "phone";
  }
  if (/tablet|kindle|silk|playbook/.test(lower)) return "tablet";
  if (/mobi|phone/.test(lower)) return "phone";

  // Client Hints mobile flag (phone-ish; do not invent tablet vs phone).
  if (uaData?.mobile === true) return "phone";
  if (uaData?.mobile === false) return "desktop";

  // iPadOS desktop-mode UA: Macintosh + touch.
  if (/macintosh/.test(lower) && typeof document !== "undefined" && "ontouchend" in document) {
    return "tablet";
  }

  if (/mac os x|macintosh|windows nt|linux|cros/.test(lower)) return "desktop";

  // Ambiguous — do not guess.
  return "unknown";
}

function deviceTypeLabel(type: DeviceType): string {
  switch (type) {
    case "desktop":
      return "Desktop";
    case "tablet":
      return "Tablet";
    case "phone":
      return "Phone";
    default:
      return "Unknown device";
  }
}

/**
 * Read approximate device/OS/browser info for UI display only.
 * Safe to call only in the browser (returns unknowns during SSR).
 */
export function getDeviceInfo(): DeviceInfo {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      deviceType: "unknown",
      deviceTypeLabel: "Unknown device",
      operatingSystem: "Unknown OS",
      browser: "Unknown browser",
    };
  }

  const ua = readUa();
  const uaData = readUaData();
  const deviceType = detectDeviceType(ua, uaData);

  return {
    deviceType,
    deviceTypeLabel: deviceTypeLabel(deviceType),
    operatingSystem: detectOperatingSystem(ua, uaData),
    browser: detectBrowser(ua, uaData),
  };
}
