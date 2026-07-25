interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

export async function consumeRateLimit(
  db: D1Database,
  scope: string,
  keyHash: string,
  maximum: number,
  windowSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<RateLimitResult> {
  const cutoff = nowSeconds - windowSeconds;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (scope, key_hash, window_started_at, request_count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(scope, key_hash) DO UPDATE SET
         request_count = CASE
           WHEN rate_limits.window_started_at <= ? THEN 1
           ELSE rate_limits.request_count + 1
         END,
         window_started_at = CASE
           WHEN rate_limits.window_started_at <= ? THEN excluded.window_started_at
           ELSE rate_limits.window_started_at
         END
       RETURNING request_count`,
    )
    .bind(scope, keyHash, nowSeconds, cutoff, cutoff)
    .first<{ request_count: number }>();

  const count = row?.request_count ?? maximum + 1;
  return { allowed: count <= maximum, remaining: Math.max(0, maximum - count) };
}

export async function clearRateLimit(
  db: D1Database,
  scope: string,
  keyHash: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM rate_limits WHERE scope = ? AND key_hash = ?')
    .bind(scope, keyHash)
    .run();
}

export async function cleanExpiredRateLimits(
  db: D1Database,
  oldestAllowedSeconds: number,
): Promise<void> {
  await db
    .prepare('DELETE FROM rate_limits WHERE window_started_at < ?')
    .bind(oldestAllowedSeconds)
    .run();
}
