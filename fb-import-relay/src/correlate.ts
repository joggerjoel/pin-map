// Matches posts/photos to check-ins by timestamp proximity. Items are
// sorted once and looked up per check-in via binary search + a bounded
// linear scan, not a naive O(check-ins × items) nested scan — a
// code-quality review flagged the unindexed-scan reading of the original
// plan prose as a real risk once export size grows past this fixture's
// small scale.

import type { CheckIn } from "./parsePlacesTaggedIn";

export interface TimestampedItem {
  timestamp: Date;
}

export interface CorrelationMatch<T extends TimestampedItem> {
  checkIn: CheckIn;
  matches: T[];
}

const DEFAULT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // ±3 days

function lowerBound(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function correlate<T extends TimestampedItem>(
  checkIns: CheckIn[],
  items: T[],
  windowMs: number = DEFAULT_WINDOW_MS,
): CorrelationMatch<T>[] {
  const sortedItems = [...items].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
  const itemTimes = sortedItems.map((item) => item.timestamp.getTime());

  return checkIns.map((checkIn) => {
    const checkInTime = checkIn.visitTime.getTime();
    const startIdx = lowerBound(itemTimes, checkInTime - windowMs);
    const matches: T[] = [];
    for (let i = startIdx; i < itemTimes.length; i++) {
      if (itemTimes[i] > checkInTime + windowMs) break;
      matches.push(sortedItems[i]);
    }
    return { checkIn, matches };
  });
}
