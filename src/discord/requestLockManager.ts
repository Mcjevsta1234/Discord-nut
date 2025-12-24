/**
 * Distributed-ish lock for deduplicating responses across multiple instances.
 * Preferred backend: Redis via REDIS_URL. Fallback: local in-memory map (best-effort).
 */
// Lazy import redis to avoid hard dependency; fallback to memory lock if not present
let createRedisClient: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  createRedisClient = require('redis').createClient;
} catch (err) {
  console.warn('⚠️ [LOCK] redis module not installed, using in-memory lock only');
}

const INSTANCE_ID = process.env.INSTANCE_ID || `instance-${Math.random().toString(36).slice(2, 8)}`;
const LOCK_TTL_MS = 180_000; // 3 minutes

let redisClient: any = null;
let redisReady = false;

(async () => {
  const url = process.env.REDIS_URL;
  if (!url || !createRedisClient) {
    console.warn('⚠️ [LOCK] REDIS_URL not set or redis module missing; using in-memory lock (single-host only).');
    return;
  }
  try {
    redisClient = createRedisClient({ url });
    redisClient.on('error', (err: any) => {
      console.warn('⚠️ [LOCK] Redis client error, falling back to memory lock:', err.message);
      redisReady = false;
    });
    await redisClient.connect();
    redisReady = true;
    console.log('✅ [LOCK] Redis lock client connected');
  } catch (err: any) {
    console.warn('⚠️ [LOCK] Failed to init Redis lock client, falling back to memory lock:', err?.message);
    redisClient = null;
    redisReady = false;
  }
})();

// Memory fallback
const memoryLocks = new Map<string, { owner: string; expiresAt: number }>();

export async function acquireLock(key: string, ttlMs: number = LOCK_TTL_MS): Promise<{ acquired: boolean; owner: string }>
{ const owner = `${INSTANCE_ID}-${Date.now()}`;
  const lockKey = `discord:respond-lock:${key}`;
  try {
    if (redisClient && redisReady) {
      const res = await redisClient.set(lockKey, owner, { NX: true, PX: ttlMs });
      return { acquired: res === 'OK', owner };
    }
  } catch (err) {
    console.warn('⚠️ [LOCK] Redis acquire failed, fallback to memory:', (err as any)?.message);
  }
  // Fallback memory lock
  const now = Date.now();
  const existing = memoryLocks.get(lockKey);
  if (existing && existing.expiresAt > now) {
    return { acquired: false, owner: existing.owner };
  }
  memoryLocks.set(lockKey, { owner, expiresAt: now + ttlMs });
  return { acquired: true, owner };
}

export async function releaseLock(key: string): Promise<void> {
  const lockKey = `discord:respond-lock:${key}`;
  try {
    if (redisClient && redisReady) {
      await redisClient.del(lockKey);
      return;
    }
  } catch (err) {
    console.warn('⚠️ [LOCK] Redis release failed:', (err as any)?.message);
  }
  memoryLocks.delete(lockKey);
}

export function getInstanceId(): string {
  return INSTANCE_ID;
}
