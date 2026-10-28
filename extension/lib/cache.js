export const DAY_MS = 86_400_000;
export const memberKey = (id) => `member:${id}`;
export const officersKey = (lodgeId) => `officers:${lodgeId}`;

export function isFresh(entry, now, ttlDays) {
  return Boolean(entry?.fetchedAt) && now - entry.fetchedAt < ttlDays * DAY_MS;
}
