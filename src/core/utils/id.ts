/** Matches ids produced by {@link uid} and accepted from backups. */
export const ID_PATTERN = /^[a-z0-9]{1,40}$/i;

/** A short random id: 7 random base-36 chars plus the last 5 of the timestamp (same format as the prototype). */
export function uid(): string {
  return Math.random().toString(36).slice(2, 9).padEnd(7, '0') + Date.now().toString(36).slice(-5);
}
