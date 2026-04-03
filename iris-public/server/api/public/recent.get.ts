/**
 * GET /api/public/recent
 *
 * Public recent-history summary for the homepage.
 * Uses current service summaries from the OTEL exporter plus
 * service-level transitions queried from VictoriaMetrics.
 */
import { getMonitors } from "~/server/utils/kuma-state";
import { fetchMonitorStatus } from "~/server/utils/prom-client";
import { buildRecentServiceActivity } from "~/server/utils/recent-service-activity";
import { mapServices } from "~/server/utils/service-mapper";

export default defineEventHandler(async () => {
    const config = useRuntimeConfig();
    const monitors = getMonitors();
    const statusResult = await fetchMonitorStatus(config.otelPromUrl as string);
    const statusData = mapServices(monitors, statusResult.status, statusResult.checksPerSecond, statusResult.targetGeo);

    return buildRecentServiceActivity(config.vmQueryUrl as string, statusData.services);
});
