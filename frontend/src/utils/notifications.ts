/**
 * Sidebar notification tracking — "what's new since the user last looked".
 *
 * Per-section `lastSeen` timestamps live in localStorage. App.tsx polls the
 * four list endpoints and counts items newer than the stored timestamp;
 * clicking a nav item updates that section's timestamp to `now`, clearing
 * the badge until something new arrives.
 *
 * Storage shape (each value is an ISO-8601 string):
 *
 *     pulse:lastSeen:alerts      → "2026-05-18T11:30:00.000Z"
 *     pulse:lastSeen:changelog   → ...
 *     pulse:lastSeen:deprecated  → ...
 *     pulse:lastSeen:jira        → ...
 */

import { parseBackendTimestamp } from "./datetime";

export type Section = "alerts" | "changelog" | "deprecated" | "jira";

const KEY_PREFIX = "pulse:lastSeen:";

function key(section: Section): string {
  return `${KEY_PREFIX}${section}`;
}

/** Returns the stored lastSeen Date for `section`, or epoch if unset/corrupt. */
export function getLastSeen(section: Section): Date {
  try {
    const raw = localStorage.getItem(key(section));
    if (!raw) return new Date(0);
    const d = new Date(raw);
    return isNaN(d.getTime()) ? new Date(0) : d;
  } catch {
    // localStorage can throw in private-browsing modes — treat as unset.
    return new Date(0);
  }
}

/** Marks `section` as seen now. Idempotent. */
export function markSeen(section: Section): void {
  try {
    localStorage.setItem(key(section), new Date().toISOString());
  } catch {
    // Ignore quota / private-browsing failures — non-critical.
  }
}

/** Convenience: count items where `getTimestamp(item) > lastSeen`.
 *  Backend timestamps are parsed via parseBackendTimestamp so naive ISO strings
 *  are treated as UTC, matching how lastSeen is stored. */
export function countSince<T>(
  items: T[],
  lastSeen: Date,
  getTimestamp: (item: T) => string | Date | number,
): number {
  const cutoff = lastSeen.getTime();
  let n = 0;
  for (const item of items) {
    const t = parseBackendTimestamp(getTimestamp(item)).getTime();
    if (!isNaN(t) && t > cutoff) n++;
  }
  return n;
}
