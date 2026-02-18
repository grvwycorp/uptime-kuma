<script setup lang="ts">
interface Monitor {
    id: number;
    name: string;
    type: string;
    status: "up" | "down" | "degraded" | "unknown";
    response_time: number | null;
    uptime_24h: number | null;
    uptime_7d: number | null;
    uptime_30d: number | null;
}

interface Service {
    name: string;
    slug: string;
    monitors: Monitor[];
    overall_status: "up" | "degraded" | "down" | "unknown";
}

interface StatusData {
    generated_at: string;
    services: Service[];
}

const config = useRuntimeConfig();
const { data, refresh } = await useFetch<StatusData>("/api/status");

onMounted(() => {
    const interval = setInterval(refresh, config.public.statusPollInterval as number);
    onUnmounted(() => clearInterval(interval));
});

const expanded = ref<Set<string>>(new Set());

function toggle(slug: string) {
    if (expanded.value.has(slug)) {
        expanded.value.delete(slug);
    } else {
        expanded.value.add(slug);
    }
}

function statusColor(status: string): string {
    if (status === "up") return "#22c55e";
    if (status === "degraded") return "#eab308";
    if (status === "unknown") return "#6b6b80";
    return "#ef4444";
}

function uptimeColor(pct: number | null): string {
    if (pct === null) return "#6b6b80";
    if (pct >= 99.9) return "#22c55e";
    if (pct >= 99.0) return "#a3e635";
    if (pct >= 95.0) return "#eab308";
    return "#ef4444";
}

function formatUptime(pct: number | null): string {
    if (pct === null) return "\u2014";
    if (pct === 100) return "100%";
    if (pct === 0) return "0%";
    return pct.toFixed(2) + "%";
}

function formatResponseTime(ms: number | null): string {
    if (ms === null) return "\u2014";
    return ms + "ms";
}

function formatTime(iso: string): string {
    return new Date(iso).toLocaleString();
}

function typeLabel(type: string): string {
    const labels: Record<string, string> = {
        "http": "HTTP",
        "keyword": "Keyword",
        "json-query": "JSON",
        "dns": "DNS",
        "ping": "Ping",
        "port": "Port",
    };
    return labels[type] || type;
}

const overallStatus = computed(() => {
    if (!data.value || data.value.services.length === 0) return "unknown";
    const statuses = data.value.services.map(s => s.overall_status);
    if (statuses.includes("down")) return "down";
    if (statuses.includes("degraded")) return "degraded";
    if (statuses.every(s => s === "unknown")) return "unknown";
    return "up";
});

const overallLabel = computed(() => {
    if (overallStatus.value === "up") return "All Systems Operational";
    if (overallStatus.value === "degraded") return "Partial Service Disruption";
    if (overallStatus.value === "unknown") return "Connecting to monitoring...";
    return "Major Service Disruption";
});
</script>

<template>
    <div class="page">
        <header class="header">
            <h1>Swedish Infrastructure Status</h1>
            <p class="subtitle">Independent monitoring of critical Swedish digital services</p>
        </header>

        <div
            class="overall-banner"
            :style="{ borderColor: statusColor(overallStatus) }"
        >
            <span
                class="status-dot"
                :style="{ background: statusColor(overallStatus) }"
            />
            {{ overallLabel }}
        </div>

        <div v-if="data" class="services">
            <div
                v-for="service in data.services"
                :key="service.slug"
                class="service-card"
            >
                <div class="service-header" @click="toggle(service.slug)">
                    <div class="service-left">
                        <span
                            class="status-dot"
                            :style="{ background: statusColor(service.overall_status) }"
                        />
                        <span class="service-name">{{ service.name }}</span>
                        <span class="monitor-count">{{ service.monitors.length }} monitors</span>
                    </div>
                    <div class="service-right">
                        <span class="expand-icon">{{ expanded.has(service.slug) ? "\u25B2" : "\u25BC" }}</span>
                    </div>
                </div>

                <div v-if="expanded.has(service.slug)" class="monitor-list">
                    <div
                        v-for="monitor in service.monitors"
                        :key="monitor.id"
                        class="monitor-row"
                    >
                        <div class="monitor-left">
                            <span
                                class="status-dot small"
                                :style="{ background: statusColor(monitor.status) }"
                            />
                            <span class="monitor-name">{{ monitor.name }}</span>
                            <span class="monitor-type">{{ typeLabel(monitor.type) }}</span>
                        </div>
                        <div class="monitor-right">
                            <span class="response-time" :style="{ color: statusColor(monitor.status) }">
                                {{ formatResponseTime(monitor.response_time) }}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <footer class="footer">
            <p>
                Powered by <strong>Iris</strong> &mdash;
                Data refreshed
                <span v-if="data">{{ formatTime(data.generated_at) }}</span>
            </p>
        </footer>
    </div>
</template>

<style>
:root {
    --bg: #0a0a0f;
    --surface: #12121a;
    --surface-hover: #1a1a25;
    --border: #1e1e2e;
    --text: #e0e0e8;
    --text-muted: #6b6b80;
    --green: #22c55e;
    --yellow: #eab308;
    --red: #ef4444;
}

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
}

.page {
    max-width: 800px;
    margin: 0 auto;
    padding: 40px 20px;
}

.header {
    text-align: center;
    margin-bottom: 32px;
}

.header h1 {
    font-size: 24px;
    font-weight: 600;
    letter-spacing: -0.02em;
}

.subtitle {
    color: var(--text-muted);
    font-size: 14px;
    margin-top: 4px;
}

.overall-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 20px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-left-width: 3px;
    border-radius: 8px;
    margin-bottom: 24px;
    font-weight: 500;
    font-size: 15px;
}

.status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
}

.status-dot.small {
    width: 8px;
    height: 8px;
}

.services {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.service-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
}

.service-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    cursor: pointer;
    transition: background 0.15s;
}

.service-header:hover {
    background: var(--surface-hover);
}

.service-left {
    display: flex;
    align-items: center;
    gap: 10px;
}

.service-name {
    font-weight: 500;
    font-size: 15px;
}

.monitor-count {
    color: var(--text-muted);
    font-size: 12px;
}

.service-right {
    display: flex;
    align-items: center;
    gap: 12px;
}

.response-time {
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

.expand-icon {
    color: var(--text-muted);
    font-size: 10px;
}

.monitor-list {
    border-top: 1px solid var(--border);
}

.monitor-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 20px 10px 40px;
    border-bottom: 1px solid var(--border);
}

.monitor-row:last-child {
    border-bottom: none;
}

.monitor-left {
    display: flex;
    align-items: center;
    gap: 8px;
}

.monitor-name {
    font-size: 13px;
}

.monitor-type {
    font-size: 11px;
    color: var(--text-muted);
    background: var(--bg);
    padding: 1px 6px;
    border-radius: 4px;
}

.monitor-right {
    flex-shrink: 0;
}


.footer {
    text-align: center;
    margin-top: 40px;
    color: var(--text-muted);
    font-size: 13px;
}

.footer strong {
    color: var(--text);
}
</style>
