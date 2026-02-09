/**
 * Server middleware: HTTP Basic Auth for internal access.
 * Protects all routes. v1 is internal-only.
 */
export default defineEventHandler((event) => {
    // Skip auth for health check
    if (event.path === "/api/health") {
        return;
    }

    const config = useRuntimeConfig();
    const expectedUser = config.authUsername as string;
    const expectedPass = config.authPassword as string;

    // If no password configured, skip auth (dev mode)
    if (!expectedPass || expectedPass === "changeme") {
        return;
    }

    const authorization = getRequestHeader(event, "authorization");
    if (!authorization || !authorization.startsWith("Basic ")) {
        setResponseHeader(event, "WWW-Authenticate", "Basic realm=\"Iris Catalog\"");
        throw createError({ statusCode: 401, statusMessage: "Authentication required" });
    }

    const encoded = authorization.slice(6);
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    const [user, pass] = decoded.split(":");

    if (user !== expectedUser || pass !== expectedPass) {
        setResponseHeader(event, "WWW-Authenticate", "Basic realm=\"Iris Catalog\"");
        throw createError({ statusCode: 401, statusMessage: "Invalid credentials" });
    }
});
