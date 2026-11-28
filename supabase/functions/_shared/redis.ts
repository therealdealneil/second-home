export type SlidingWindowResult = {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
};

export interface UpstashRedisClient {
  get(key: string): Promise<string | null>;
  setEx(key: string, ttlSeconds: number, value: string): Promise<void>;
  setNxEx(key: string, ttlSeconds: number, value: string): Promise<boolean>;
  getDel(key: string): Promise<string | null>;
  compareAndAdvanceCounter(key: string, newSignCount: number, ttlSeconds: number): Promise<boolean>;
  slidingWindowLimit(
    key: string,
    limit: number,
    windowSeconds: number,
    nowMs?: number,
  ): Promise<SlidingWindowResult>;
}

const COMPARE_AND_ADVANCE_COUNTER_LUA = `
local key = KEYS[1]
local new_count = tonumber(ARGV[1])
local ttl_sec = tonumber(ARGV[2])
local raw = redis.call('GET', key)
if not raw then
  return 0
end
local ok, decoded = pcall(cjson.decode, raw)
if not ok or type(decoded) ~= 'table' or type(decoded.signCount) ~= 'number' then
  return 0
end
if new_count <= decoded.signCount then
  return 0
end
decoded.signCount = new_count
redis.call('SET', key, cjson.encode(decoded), 'EX', ttl_sec)
return 1
`;

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local cutoff = now - window_ms

redis.call('ZREMRANGEBYSCORE', key, 0, cutoff)
local count = redis.call('ZCARD', key)

if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local reset_at = now + window_ms
  if oldest[2] then
    reset_at = tonumber(oldest[2]) + window_ms
  end
  return {0, 0, reset_at}
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window_ms)
local remaining = limit - (count + 1)
return {1, remaining, now + window_ms}
`;

export function createUpstashRedisClient(
  restUrl: string,
  restToken: string,
  fetchImpl: typeof fetch = fetch,
): UpstashRedisClient {
  const parsedUrl = new URL(restUrl);
  if (parsedUrl.protocol !== "https:") {
    throw new Error("UPSTASH_REDIS_REST_URL must use https://");
  }
  const baseUrl = parsedUrl.toString().replace(/\/+$/, "");

  async function command<T>(args: Array<string | number>): Promise<T> {
    const res = await fetchImpl(baseUrl, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${restToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });

    if (!res.ok) {
      throw new Error(`Upstash Redis HTTP ${res.status}`);
    }

    const payload = (await res.json()) as { result?: T; error?: string };
    if (payload.error) {
      throw new Error(`Upstash Redis error: ${payload.error}`);
    }
    return payload.result as T;
  }

  return {
    async get(key: string): Promise<string | null> {
      const result = await command<string | null>(["GET", key]);
      return result ?? null;
    },

    async setEx(key: string, ttlSeconds: number, value: string): Promise<void> {
      await command<string>(["SET", key, value, "EX", Math.max(1, Math.floor(ttlSeconds))]);
    },

    async setNxEx(key: string, ttlSeconds: number, value: string): Promise<boolean> {
      const result = await command<string | null>([
        "SET",
        key,
        value,
        "EX",
        Math.max(1, Math.floor(ttlSeconds)),
        "NX",
      ]);
      return result === "OK";
    },

    async getDel(key: string): Promise<string | null> {
      const result = await command<string | null>(["GETDEL", key]);
      return result ?? null;
    },

    async compareAndAdvanceCounter(
      key: string,
      newSignCount: number,
      ttlSeconds: number,
    ): Promise<boolean> {
      const result = await command<number>([
        "EVAL",
        COMPARE_AND_ADVANCE_COUNTER_LUA,
        1,
        key,
        Math.floor(newSignCount),
        Math.max(1, Math.floor(ttlSeconds)),
      ]);
      return Number(result) === 1;
    },

    async slidingWindowLimit(
      key: string,
      limit: number,
      windowSeconds: number,
      nowMs = Date.now(),
    ): Promise<SlidingWindowResult> {
      const windowMs = Math.max(1, Math.floor(windowSeconds * 1000));
      const nonceBytes = new Uint8Array(8);
      crypto.getRandomValues(nonceBytes);
      const uniqueSuffix = Array.from(nonceBytes, (b) => b.toString(16).padStart(2, "0")).join("");
      const member = `${nowMs}:${uniqueSuffix}`;

      const raw = await command<[number, number, number]>([
        "EVAL",
        SLIDING_WINDOW_LUA,
        1,
        key,
        nowMs,
        windowMs,
        limit,
        member,
      ]);

      return {
        allowed: Number(raw[0]) === 1,
        remaining: Math.max(0, Number(raw[1] ?? 0)),
        resetAtMs: Number(raw[2] ?? nowMs + windowMs),
      };
    },
  };
}
