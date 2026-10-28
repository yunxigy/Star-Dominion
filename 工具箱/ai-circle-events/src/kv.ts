export interface KVStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Lease {
  runId: string;
  expiresAt: number;
}

export const ACTIVE_LEASE_KEY = "lease:active";
const LEASE_TTL_SECONDS = 180;

export async function readCursor(kv: KVStore, handle: string): Promise<string | null> {
  const value = await kv.get("cursor:" + handle);
  return value?.trim() || null;
}

export async function writeCursor(kv: KVStore, handle: string, postId: string): Promise<void> {
  await kv.put("cursor:" + handle, postId);
}

export async function acquireLease(
  kv: KVStore,
  runId: string,
  now: number,
): Promise<boolean> {
  const raw = await kv.get(ACTIVE_LEASE_KEY);
  if (raw) {
    try {
      const lease = JSON.parse(raw) as Partial<Lease>;
      if (typeof lease.expiresAt !== "number" || lease.expiresAt > now) {
        return false;
      }
    } catch {
      return false;
    }
  }

  const lease: Lease = {
    runId,
    expiresAt: now + LEASE_TTL_SECONDS * 1_000,
  };
  await kv.put(ACTIVE_LEASE_KEY, JSON.stringify(lease), {
    expirationTtl: LEASE_TTL_SECONDS,
  });
  return true;
}

export async function releaseLease(kv: KVStore, runId: string): Promise<void> {
  const raw = await kv.get(ACTIVE_LEASE_KEY);
  if (!raw) return;
  try {
    const lease = JSON.parse(raw) as Partial<Lease>;
    if (lease.runId === runId) {
      await kv.delete(ACTIVE_LEASE_KEY);
    }
  } catch {
    // A malformed/foreign lease is left to expire instead of deleting another run's lock.
  }
}
