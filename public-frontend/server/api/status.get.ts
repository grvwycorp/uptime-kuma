/**
 * GET /api/status
 *
 * Fetches real monitor data from iris-catalog and returns it as
 * grouped services for the public status page.
 */
import { fetchMonitors, fetchStatus } from "../utils/catalog-client";
import { mapServices } from "../utils/service-mapper";

export default defineEventHandler(async () => {
    const [monitorsRes, statusRes] = await Promise.all([
        fetchMonitors(),
        fetchStatus(),
    ]);

    return mapServices(monitorsRes.monitors, statusRes.status);
});
