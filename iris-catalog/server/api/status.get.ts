/**
 * GET /api/status
 * Queries the OTEL Collector Prometheus exporter for per-probe monitor status.
 * Returns aggregated status (worst-status-wins) with per-probe drill-down.
 */
import { fetchMonitorStatus } from "../utils/prom-client";

export default defineEventHandler(async () => {
    const config = useRuntimeConfig();
    const promUrl = config.otelPromUrl as string;
    const status = await fetchMonitorStatus(promUrl);

    return { status };
});
