/**
 * Composable: reactive per-probe monitor status from the OTEL Prometheus exporter.
 * Polls the /api/status endpoint at a configurable interval.
 */
import type { MonitorStatus } from "~/server/utils/prom-client";

interface StatusResponse {
    status: Record<string, MonitorStatus>;
}

export function useStatus() {
    const config = useRuntimeConfig();
    const pollInterval = config.public.statusPollInterval as number;
    const status = useState<Record<string, MonitorStatus>>("monitor-status", () => ({}));

    /**
     * Fetch latest status from the catalog API
     */
    async function refresh() {
        try {
            const data = await $fetch<StatusResponse>("/api/status");
            status.value = data.status;
        } catch (err) {
            console.warn("[useStatus] Failed to fetch:", err);
        }
    }

    onMounted(() => {
        refresh();
        const interval = setInterval(refresh, pollInterval);
        onUnmounted(() => clearInterval(interval));
    });

    return { status, refresh };
}
