/**
 * GET /api/public/status
 *
 * Public endpoint (no auth). Returns grouped services with live status
 * by reading directly from kuma-state and prom-client.
 */
import { getMonitors } from "~/server/utils/kuma-state";
import { fetchMonitorStatus } from "~/server/utils/prom-client";
import { mapServices } from "~/server/utils/service-mapper";

export default defineEventHandler(async () => {
    const config = useRuntimeConfig();
    const monitors = getMonitors();
    const statusResult = await fetchMonitorStatus(config.otelPromUrl as string);
    return mapServices(monitors, statusResult.status, statusResult.checksPerSecond, statusResult.targetGeo);
});
