/**
 * Latest-request-wins tracker for async state loads.
 *
 * Every fresh request takes a new monotonically increasing generation.
 * Results/errors may only be applied to UI state while their generation is
 * still the latest one — an older request's success, failure, or clear can
 * never overwrite or wipe state belonging to a newer request.
 */
export interface LatestRequestTracker {
  /** Begin a new request generation; any older in-flight work is stale. */
  start(): number;
  /** True only for the generation of the most recent start(). */
  isLatest(generation: number): boolean;
  /** The current generation (0 before the first start()). */
  readonly current: number;
}

export function createLatestRequestTracker(): LatestRequestTracker {
  let generation = 0;
  return {
    start() {
      generation += 1;
      return generation;
    },
    isLatest(candidate: number) {
      return candidate > 0 && candidate === generation;
    },
    get current() {
      return generation;
    },
  };
}
