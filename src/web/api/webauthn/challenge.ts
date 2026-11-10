interface ChallengeEntry {
  challenge: string;
  expires: number;
}

const store = new Map<string, ChallengeEntry>();
const DEFAULT_TTL = 5 * 60 * 1000;

export function saveChallenge(id: string, challenge: string, ttl = DEFAULT_TTL): void {
  store.set(id, { challenge, expires: Date.now() + ttl });
}

export function getChallenge(id: string): string | null {
  const e = store.get(id);
  if (!e) return null;
  if (Date.now() > e.expires) {
    store.delete(id);
    return null;
  }
  return e.challenge;
}

export function consumeChallenge(id: string): string | null {
  const c = getChallenge(id);
  if (c) store.delete(id);
  return c;
}

export function latestChallengeId(): string | null {
  // Most recently inserted key
  const keys = Array.from(store.keys());
  return keys.length ? keys[keys.length - 1]! : null;
}

export function resetChallenges() {
  store.clear();
}