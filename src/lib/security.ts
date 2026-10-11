import "server-only";
import { AppError } from "./errors";
const buckets = new Map<string, { count: number; until: number }>();
export function rateLimit(key: string, max = 30) {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.until <= now) buckets.delete(k);
  if (buckets.size >= 10000 && !buckets.has(key))
    throw new AppError(429, "RATE_LIMITED", "Please try again later");
  const b = buckets.get(key) ?? { count: 0, until: now + 60000 };
  b.count++;
  buckets.set(key, b);
  if (b.count > max)
    throw new AppError(429, "RATE_LIMITED", "Please try again later");
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const expected =
    process.env.APP_ORIGIN ??
    (process.env.APP_ENV === "production" || process.env.APP_ENV === "uat"
      ? null
      : new URL(req.url).origin);
  if (!origin || !expected || origin !== expected)
    throw new AppError(
      403,
      "ORIGIN_NOT_ALLOWED",
      "Request origin is not allowed",
    );
}
export async function body(req: Request) {
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError(400, "INVALID_CONTENT_TYPE", "Use application/json");
  if (Number(req.headers.get("content-length")) > 16384)
    throw new AppError(413, "PAYLOAD_TOO_LARGE", "Request is too large");
  const reader = req.body?.getReader();
  if (!reader) throw new AppError(400, "INVALID_BODY", "Missing JSON body");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16384) {
      await reader.cancel();
      throw new AppError(413, "PAYLOAD_TOO_LARGE", "Request is too large");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new AppError(400, "INVALID_BODY", "Invalid JSON body");
  }
}
