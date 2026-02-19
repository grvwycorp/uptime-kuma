<script setup lang="ts">
definePageMeta({ layout: "public" });

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
    probe_count: number;
    probes_up: number;
}

interface StatusData {
    generated_at: string;
    services: Service[];
}

const config = useRuntimeConfig();
const { data, refresh } = await useFetch<StatusData>("/api/public/status");

onMounted(() => {
    const interval = setInterval(refresh, config.public.statusPollInterval as number);
    onUnmounted(() => clearInterval(interval));
});

const expandedSlug = ref<string | null>(null);

function toggle(slug: string) {
    expandedSlug.value = expandedSlug.value === slug ? null : slug;
}

function isExpanded(slug: string): boolean {
    return expandedSlug.value === slug;
}

function statusColor(status: string): string {
    if (status === "up") return "var(--color-status-up)";
    if (status === "degraded") return "var(--color-status-degraded)";
    if (status === "unknown") return "var(--color-status-unknown)";
    return "var(--color-status-down)";
}

function formatResponseTime(ms: number | null): string {
    if (ms === null) return "\u2014";
    if (ms >= 1000) return (ms / 1000).toFixed(1) + "s";
    return ms + "ms";
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

function probeLabel(service: Service): string {
    if (service.probe_count === 0) return "No probes";
    return `${service.probes_up}/${service.probe_count} probes`;
}

function probeColor(service: Service): string {
    if (service.probe_count === 0) return "var(--color-text-muted)";
    if (service.probes_up === service.probe_count) return "var(--color-status-up)";
    if (service.probes_up === 0) return "var(--color-status-down)";
    return "var(--color-status-degraded)";
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
                :class="{ expanded: isExpanded(service.slug) }"
                :style="{ borderLeftColor: statusColor(service.overall_status) }"
            >
                <div class="card-header" @click="toggle(service.slug)">
                    <div class="card-body">
                        <div class="card-name">{{ service.name }}</div>
                        <div class="card-meta">
                            <span class="probe-count" :style="{ color: probeColor(service) }">
                                {{ probeLabel(service) }}
                            </span>
                            <span class="monitor-count">{{ service.monitors.length }} monitors</span>
                        </div>
                    </div>
                    <div class="card-expand">
                        <span class="chevron" :class="{ open: isExpanded(service.slug) }">&#9662;</span>
                    </div>
                </div>

                <div v-if="isExpanded(service.slug)" class="monitor-list">
                    <div
                        v-for="monitor in service.monitors"
                        :key="monitor.id"
                        class="monitor-item"
                    >
                        <span
                            class="status-dot small"
                            :style="{ background: statusColor(monitor.status) }"
                        />
                        <span class="monitor-name">{{ monitor.name }}</span>
                        <span class="monitor-type">{{ typeLabel(monitor.type) }}</span>
                        <span class="response-time" :style="{ color: statusColor(monitor.status) }">
                            {{ formatResponseTime(monitor.response_time) }}
                        </span>
                    </div>
                </div>
            </div>
        </div>

        <footer class="footer">
            <p>
                Powered by <strong>Iris</strong> &mdash;
                <ClientOnly>
                    <span v-if="data">Data refreshed {{ new Date(data.generated_at).toLocaleString() }}</span>
                </ClientOnly>
            </p>
            <p class="disclaimer">
                Independent monitoring &mdash; may not reflect actual service status.
                <NuxtLink to="/legal">Disclaimer &amp; Privacy</NuxtLink>
            </p>
        </footer>
    </div>
</template>

<style scoped>
.page {
    max-width: 900px;
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
    color: var(--color-text);
}

.subtitle {
    color: var(--color-text-muted);
    font-size: 14px;
    margin-top: 4px;
}

.overall-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 20px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
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

/* ── Card grid ── */

.services {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
}

.service-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-left-width: 3px;
    border-radius: 8px;
    overflow: hidden;
}

.service-card.expanded {
    grid-column: 1 / -1;
}

.card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 16px;
    cursor: pointer;
    min-height: 120px;
    transition: background 0.15s;
}

.card-header:hover {
    background: var(--color-surface-hover);
}

.card-body {
    flex: 1;
}

.card-name {
    font-weight: 600;
    font-size: 15px;
    margin-bottom: 12px;
    line-height: 1.3;
}

.card-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
}

.probe-count {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
}

.monitor-count {
    color: var(--color-text-muted);
}

.card-expand {
    padding-top: 2px;
}

.chevron {
    color: var(--color-text-muted);
    font-size: 14px;
    transition: transform 0.25s ease;
    display: inline-block;
}

.chevron.open {
    transform: rotate(180deg);
}

/* ── Expanded monitor list ── */

.monitor-list {
    border-top: 1px solid var(--color-border);
    padding: 12px 16px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.monitor-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--color-bg);
    border-radius: 6px;
    font-size: 13px;
}

.monitor-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.monitor-type {
    font-size: 11px;
    color: var(--color-text-muted);
    background: var(--color-border);
    padding: 1px 6px;
    border-radius: 4px;
    white-space: nowrap;
    flex-shrink: 0;
}

.response-time {
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    flex-shrink: 0;
}

/* ── Footer ── */

.footer {
    text-align: center;
    margin-top: 40px;
    color: var(--color-text-muted);
    font-size: 13px;
}

.footer strong {
    color: var(--color-text);
}

.disclaimer {
    margin-top: 8px;
    font-size: 12px;
}

.disclaimer a {
    color: var(--color-text-muted);
    text-decoration: underline;
    text-underline-offset: 2px;
}

.disclaimer a:hover {
    color: var(--color-text);
}

/* ── Mobile ── */

@media (max-width: 640px) {
    .page {
        padding: 24px 16px;
    }

    .services {
        grid-template-columns: 1fr;
    }

    .service-card.expanded {
        grid-column: 1;
    }

    .monitor-list {
        flex-direction: column;
    }
}
</style>
