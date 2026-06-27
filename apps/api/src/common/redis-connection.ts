// Shared BullMQ connection options, parsed from REDIS_URL — used by any worker
// that needs a repeatable background job (reminders, recurrence generation, etc.).
export function getRedisConnection() {
  const REDIS_URL = process.env.REDIS_URL;
  if (!REDIS_URL) return null;
  try {
    const url = new URL(REDIS_URL);
    return {
      host: url.hostname,
      port: parseInt(url.port) || 6380,
      password: url.password || undefined,
      tls: url.protocol === 'rediss:' ? {} : undefined,
    };
  } catch {
    return null;
  }
}
