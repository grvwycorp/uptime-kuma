/**
 * Simple in-memory rate limiter per IP address.
 * Applies to /api/* routes only. Uses a sliding window counter.
 */

const MAX_REQUESTS = 30;
const WINDOW_MS = 60_000;

interface Bucket {
    count: number;
    resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Prune expired buckets every 5 minutes to prevent memory growth
setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of buckets) {
        if (now > bucket.resetAt) {
            buckets.delete(ip);
        }
    }
}, 5 * 60_000);

/**
 * Extract client IP from the request, respecting X-Forwarded-For from Caddy
 * @param event - H3 event
 * @returns client IP string
 */
function getClientIp(event: any): string {
    const forwarded = getHeader(event, "x-forwarded-for");
    if (forwarded) {
        return forwarded.split(",")[0].trim();
    }
    return getHeader(event, "x-real-ip") || event.node?.req?.socket?.remoteAddress || "unknown";
}

export default defineEventHandler((event) => {
    const path = getRequestURL(event).pathname;

    // Only rate-limit API routes
    if (!path.startsWith("/api/")) {
        return;
    }

    const ip = getClientIp(event);
    const now = Date.now();

    let bucket = buckets.get(ip);
    if (!bucket || now > bucket.resetAt) {
        bucket = { count: 0, resetAt: now + WINDOW_MS };
        buckets.set(ip, bucket);
    }

    bucket.count++;

    // Set rate limit headers
    setHeader(event, "X-RateLimit-Limit", String(MAX_REQUESTS));
    setHeader(event, "X-RateLimit-Remaining", String(Math.max(0, MAX_REQUESTS - bucket.count)));
    setHeader(event, "X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > MAX_REQUESTS) {
        setResponseStatus(event, 429);
        setHeader(event, "Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
        return { error: "Too many requests. Please try again later." };
    }
});
