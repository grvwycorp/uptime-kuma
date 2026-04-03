import type { MonitorData } from "~/server/utils/kuma-state";
import type { MonitorStatus } from "~/server/utils/prom-client";
import type { PublicCatalogResponse } from "~/types/public";

let pollHandle: ReturnType<typeof setInterval> | null = null;
let subscriberCount = 0;

export function usePublicCatalog() {
    const config = useRuntimeConfig();
    const pollInterval = config.public.statusPollInterval as number;

    const monitors = useState<Record<string, MonitorData>>("monitors", () => ({}));
    const connected = useState<boolean>("kuma-connected", () => false);
    const loading = useState<boolean>("monitors-loading", () => true);
    const initialized = useState<boolean>("public-catalog-initialized", () => false);
    const status = useState<Record<string, MonitorStatus>>("monitor-status", () => ({}));
    const lastUpdated = useState<number>("status-last-updated", () => 0);
    const monitorListUpdatedAt = useState<number>("public-catalog-monitor-list-updated-at", () => 0);

    async function refresh() {
        try {
            const data = await $fetch<PublicCatalogResponse>("/api/public/catalog");
            monitors.value = data.monitors as unknown as Record<string, MonitorData>;
            status.value = data.status;
            connected.value = data.connected;
            lastUpdated.value = data.statusLastUpdated;
            monitorListUpdatedAt.value = data.monitorListUpdatedAt;
            initialized.value = true;
        } catch (error) {
            console.warn("[usePublicCatalog] Failed to fetch:", error);
        } finally {
            loading.value = false;
        }
    }

    onMounted(() => {
        subscriberCount++;

        if (!initialized.value) {
            refresh();
        }

        if (!pollHandle) {
            pollHandle = setInterval(refresh, pollInterval);
        }
    });

    onUnmounted(() => {
        subscriberCount--;
        if (subscriberCount <= 0 && pollHandle) {
            clearInterval(pollHandle);
            pollHandle = null;
            subscriberCount = 0;
        }
    });

    return {
        monitors,
        connected,
        loading,
        status,
        lastUpdated,
        monitorListUpdatedAt,
        refresh,
    };
}
