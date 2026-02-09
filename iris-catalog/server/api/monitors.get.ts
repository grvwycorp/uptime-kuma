/**
 * GET /api/monitors
 * Returns the full monitor list from the in-memory state.
 * Includes configs, descriptions, hierarchy (parent/childrenIDs), and tags.
 */
import { getMonitors, getConnectionInfo } from "../utils/kuma-state";

export default defineEventHandler(() => {
    const monitors = getMonitors();
    const info = getConnectionInfo();

    return {
        connected: info.connected,
        lastUpdate: info.lastUpdate,
        monitors,
    };
});
