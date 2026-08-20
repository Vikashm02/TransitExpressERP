/** Tour-seen flags only. Learning Mode itself stays in user_preferences. */

function storageKey(pageId: string, userId: string): string {
  return `learning-tour-seen:${pageId}:${userId}`;
}

export function hasSeenTour(pageId: string, userId: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(storageKey(pageId, userId)) === "1";
  } catch {
    return true;
  }
}

export function markTourSeen(pageId: string, userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(pageId, userId), "1");
  } catch {
    // ignore quota / private mode
  }
}

export function clearTourSeen(pageId: string, userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(pageId, userId));
  } catch {
    // ignore
  }
}
