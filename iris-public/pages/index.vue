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

function borderColor(status: string): string {
    if (status === "up") return "rgba(167, 192, 128, 0.2)";
    if (status === "degraded") return "rgba(219, 188, 127, 0.2)";
    if (status === "unknown") return "rgba(122, 132, 120, 0.2)";
    return "rgba(230, 126, 128, 0.2)";
}

function borderColorHover(status: string): string {
    if (status === "up") return "rgba(167, 192, 128, 0.4)";
    if (status === "degraded") return "rgba(219, 188, 127, 0.4)";
    if (status === "unknown") return "rgba(122, 132, 120, 0.4)";
    return "rgba(230, 126, 128, 0.4)";
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
</script>

<template>
    <div class="page">
        <header class="header">
            <span class="brand">iris</span>
            <h1>Swedish Infrastructure Status</h1>
            <p class="subtitle">Independent monitoring of critical Swedish digital services</p>
        </header>

        <div class="mission">
            Iris is a small-scale project trying to answer the question:
            <em>How is Sweden doing on the internet today?</em>
            Measurements might be inaccurate, but we hope you enjoy looking around.
        </div>

        <div v-if="data" class="services">
            <div
                v-for="service in data.services"
                :key="service.slug"
                class="service-card"
                :class="{ expanded: isExpanded(service.slug) }"
                :style="{
                    '--card-border': borderColor(service.overall_status),
                    '--card-border-hover': borderColorHover(service.overall_status),
                }"
            >
                <div class="card-header" @click="toggle(service.slug)">
                    <div class="card-body">
                        <div class="card-name">{{ service.name }}</div>
                        <div class="card-meta">
                            <span class="probe-count" :style="{ color: probeColor(service) }">
                                {{ probeLabel(service) }}
                            </span>
                            <span class="meta-sep">&middot;</span>
                            <span class="monitor-count">{{ service.monitors.length }} monitors</span>
                        </div>
                    </div>
                    <div class="card-status">
                        <span
                            class="status-dot"
                            :style="{ background: statusColor(service.overall_status) }"
                        />
                        <span class="chevron" :class="{ open: isExpanded(service.slug) }">&#9662;</span>
                    </div>
                </div>

                <div v-if="isExpanded(service.slug)" class="monitor-list">
                    <div
                        v-for="(monitor, idx) in service.monitors"
                        :key="monitor.id"
                        class="monitor-row"
                        :class="{ last: idx === service.monitors.length - 1 }"
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
    max-width: 1100px;
    margin: 0 auto;
    padding: 48px 24px;
}

/* ── Header ── */

.header {
    margin-bottom: 24px;
}

.brand {
    display: block;
    font-size: 13px;
    font-weight: 300;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--color-focus);
    margin-bottom: 4px;
}

.header h1 {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--color-text);
    line-height: 1.2;
}

.subtitle {
    color: var(--color-text-muted);
    font-size: 14px;
    margin-top: 6px;
}

/* ── Mission statement ── */

.mission {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 16px 20px;
    margin-bottom: 32px;
    font-size: 14px;
    color: var(--color-text-muted);
    line-height: 1.6;
}

.mission em {
    color: var(--color-text);
    font-style: italic;
}

/* ── Card grid ── */

.services {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 16px;
}

/* ── Card ── */

.service-card {
    background: var(--color-surface);
    border: 1px solid var(--card-border, var(--color-border));
    border-radius: 10px;
    overflow: hidden;
    transition: border-color 0.2s;
}

.service-card:hover {
    border-color: var(--card-border-hover, var(--color-border));
}

.service-card.expanded {
    grid-column: 1 / -1;
    border-color: var(--color-focus);
    box-shadow: 0 0 0 1px var(--color-focus), 0 4px 20px rgba(0, 0, 0, 0.15);
}

.card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 20px;
    cursor: pointer;
    min-height: 110px;
    transition: background 0.15s;
}

.card-header:hover {
    background: var(--color-surface-hover);
}

.card-body {
    flex: 1;
    min-width: 0;
}

.card-name {
    font-weight: 600;
    font-size: 16px;
    margin-bottom: 12px;
    line-height: 1.3;
    color: var(--color-text);
}

.card-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
}

.probe-count {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
}

.meta-sep {
    color: var(--color-text-subtle);
}

.monitor-count {
    color: var(--color-text-muted);
}

.card-status {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding-top: 2px;
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

.chevron {
    color: var(--color-text-muted);
    font-size: 13px;
    transition: transform 0.25s ease;
    display: inline-block;
}

.chevron.open {
    transform: rotate(180deg);
}

/* ── Expanded monitor list ── */

.monitor-list {
    border-top: 1px solid var(--color-border);
    padding: 4px 20px;
}

.monitor-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 0;
    border-bottom: 1px solid var(--color-border);
}

.monitor-row.last {
    border-bottom: none;
}

.monitor-name {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.monitor-type {
    font-size: 11px;
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
    padding: 1px 8px;
    border-radius: 10px;
    white-space: nowrap;
    flex-shrink: 0;
}

.response-time {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    flex-shrink: 0;
    min-width: 56px;
    text-align: right;
}

/* ── Footer ── */

.footer {
    margin-top: 48px;
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

    .header h1 {
        font-size: 22px;
    }

    .services {
        grid-template-columns: 1fr;
    }

    .service-card.expanded {
        grid-column: 1;
    }

    .card-header {
        padding: 16px;
        min-height: 0;
    }

    .monitor-list {
        padding: 4px 16px;
    }

    .monitor-name {
        white-space: normal;
    }
}
</style>
