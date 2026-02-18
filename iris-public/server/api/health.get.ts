/**
 * GET /api/health
 * Simple health check endpoint (no auth required).
 */
import { getConnectionInfo } from "../utils/kuma-state";

export default defineEventHandler(() => {
    const info = getConnectionInfo();
    return {
        status: "ok",
        kumaConnected: info.connected,
        lastUpdate: info.lastUpdate,
    };
});
