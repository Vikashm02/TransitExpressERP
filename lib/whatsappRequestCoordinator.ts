import { createLatestRequestTracker } from "./latestRequestTracker";

/**
 * Orchestrates WhatsApp access loads inside StaffListPage.
 *
 * Semantics:
 * - `beginLoad()` allocates a fresh generation at the START of a load,
 *   before any awaited work — request START order, never intermediate
 *   completion order, decides which invocation is newest.
 * - `mayFetch(generation)` is the hard gate BEFORE invoking the list RPC:
 *   the closure must still be mounted, still the latest generation, AND
 *   the actor must still be eligible right now (live eligibility getter,
 *   not a captured boolean).
 * - `isCurrent(generation)` gates every state/error effect after awaited
 *   work resolves — a stale or unmounted closure must not apply anything.
 * - `invalidate()` advances the generation for explicit cancellation;
 *   `markUnmounted()` additionally suppresses the mounted check.
 */
export interface WhatsappRequestCoordinator {
  /** Start a new load; any older in-flight generation becomes stale. */
  beginLoad(): number;
  /** True only when this generation is latest AND the page is mounted. */
  isCurrent(generation: number): boolean;
  /**
   * May this generation invoke the list RPC? Requires latest generation,
   * mounted, and current (live) management eligibility.
   */
  mayFetch(generation: number): boolean;
  /** Drop all in-flight generations for explicit cancellation. */
  invalidate(): void;
  /** Re-mark mounted when the page (re)enters a mounted lifecycle. */
  markMounted(): void;
  /** Unmount: suppress updates and stale all in-flight generations. */
  markUnmounted(): void;
  readonly isMounted: boolean;
}

export function createWhatsappRequestCoordinator(
  getEligible: () => boolean
): WhatsappRequestCoordinator {
  const tracker = createLatestRequestTracker();
  let mounted = true;
  return {
    beginLoad() {
      return tracker.start();
    },
    isCurrent(generation: number) {
      return mounted && tracker.isLatest(generation);
    },
    mayFetch(generation: number) {
      return mounted && tracker.isLatest(generation) && getEligible();
    },
    invalidate() {
      tracker.start();
    },
    markMounted() {
      mounted = true;
    },
    markUnmounted() {
      mounted = false;
      tracker.start();
    },
    get isMounted() {
      return mounted;
    },
  };
}
