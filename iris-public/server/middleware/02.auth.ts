/**
 * Route-aware HTTP Basic Auth middleware.
 * Protects /docs/* and /api/* routes.
 * Public routes: /, /legal, /api/health, /api/public/*, static assets.
 */

const PUBLIC_API_PREFIXES = ["/api/health", "/api/public/"];

/**
 * Check if a request path requires authentication
 * @param path - request URL path
 * @returns true if the path is protected
 */
function isProtected(path: string): boolean {
    // Public API routes
    if (PUBLIC_API_PREFIXES.some(p => path.startsWith(p))) {
        return false;
    }
    // Protected: /docs/* and /api/*
    if (path.startsWith("/docs") || path.startsWith("/api/")) {
        return true;
    }
    // Everything else is public (/, /legal, /_nuxt/*, static assets)
    return false;
}

export default defineEventHandler((event) => {
    const path = event.path;

    if (!isProtected(path)) {
        return;
    }

    const config = useRuntimeConfig();
    const expectedUser = config.authUsername as string;
    const expectedPass = config.authPassword as string;

    // Dev mode: skip auth if no password configured
    if (!expectedPass || expectedPass === "changeme") {
        return;
    }

    const authorization = getRequestHeader(event, "authorization");
    if (!authorization || !authorization.startsWith("Basic ")) {
        setResponseHeader(event, "WWW-Authenticate", "Basic realm=\"Iris\"");
        throw createError({ statusCode: 401, statusMessage: "Authentication required" });
    }

    const encoded = authorization.slice(6);
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    const [user, pass] = decoded.split(":");

    if (user !== expectedUser || pass !== expectedPass) {
        setResponseHeader(event, "WWW-Authenticate", "Basic realm=\"Iris\"");
        throw createError({ statusCode: 401, statusMessage: "Invalid credentials" });
    }
});
