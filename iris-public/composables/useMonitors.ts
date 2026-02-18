/**
 * Composable: reactive monitor config state from the catalog server.
 * Fetches monitor list on mount and refreshes on interval.
 */
import type { MonitorData } from "~/server/utils/kuma-state";

interface MonitorsResponse {
    connected: boolean;
    lastUpdate: number;
    monitors: Record<string, MonitorData>;
}

export function useMonitors() {
    const monitors = useState<Record<string, MonitorData>>("monitors", () => ({}));
    const connected = useState<boolean>("kuma-connected", () => false);
    const loading = useState<boolean>("monitors-loading", () => true);

    /**
     * Fetch monitors from the catalog API
     */
    async function refresh() {
        try {
            const data = await $fetch<MonitorsResponse>("/api/monitors");
            monitors.value = data.monitors;
            connected.value = data.connected;
        } catch (err) {
            console.warn("[useMonitors] Failed to fetch:", err);
        } finally {
            loading.value = false;
        }
    }

    // Initial fetch + periodic refresh (every 30s for config changes)
    onMounted(() => {
        refresh();
        const interval = setInterval(refresh, 30000);
        onUnmounted(() => clearInterval(interval));
    });

    return { monitors, connected, loading, refresh };
}
