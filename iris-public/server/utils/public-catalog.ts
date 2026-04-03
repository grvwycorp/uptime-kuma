import type { PublicCatalogResponse } from "~/types/public";
import { getConnectionInfo, getMonitors } from "./kuma-state";
import { fetchMonitorStatus } from "./prom-client";
import { sanitizePublicMonitors } from "./public-monitor";

export async function buildPublicCatalogResponse(otelPromUrl: string): Promise<PublicCatalogResponse> {
    const monitors = getMonitors();
    const info = getConnectionInfo();
    const statusResult = await fetchMonitorStatus(otelPromUrl);

    return {
        connected: info.connected,
        monitorListUpdatedAt: info.lastUpdate,
        statusLastUpdated: statusResult.lastUpdated,
        monitors: sanitizePublicMonitors(monitors),
        status: statusResult.status,
    };
}
