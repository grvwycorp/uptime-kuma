<script setup lang="ts">
import type { PublicServiceSummary } from "~/types/public";

const props = defineProps<{
    service: PublicServiceSummary;
}>();

function formatResponseTime(ms: number | null): string {
    if (ms === null) {
        return "—";
    }
    if (ms >= 1000) {
        return `${(ms / 1000).toFixed(1)}s`;
    }
    return `${ms}ms`;
}

function typeLabel(type: string): string {
    const labels: Record<string, string> = {
        http: "HTTP",
        keyword: "Keyword",
        "json-query": "JSON",
        dns: "DNS",
        ping: "Ping",
        port: "Port",
        push: "Push",
        steam: "Steam",
    };
    return labels[type] || type;
}

function statusLabel(status: PublicServiceSummary["overall_status"]): string {
    if (status === "degraded") {
        return "Degraded";
    }
    if (status === "down") {
        return "Down";
    }
    if (status === "unknown") {
        return "Unknown";
    }
    return "Healthy";
}

function probeStatusLabel(status: PublicServiceSummary["probes"][number]["overall_status"]): string {
    if (status === "degraded") {
        return "Mixed";
    }
    if (status === "down") {
        return "No signal";
    }
    if (status === "unknown") {
        return "Unknown";
    }
    return "Healthy";
}

const lastKnownResponse = computed(() => {
    const values = props.service.monitors
        .map((monitor) => monitor.response_time)
        .filter((value): value is number => typeof value === "number");

    if (values.length === 0) {
        return null;
    }

    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
});

const uniqueEndpoints = computed(() => {
    const endpoints = props.service.monitors
        .map((monitor) => monitor.endpoint)
        .filter((endpoint): endpoint is string => Boolean(endpoint));

    return Array.from(new Set(endpoints));
});

const whyMonitored = computed(() => {
    if (!props.service.why_monitored) {
        return null;
    }
    if (props.service.why_monitored === props.service.description_excerpt) {
        return null;
    }
    return props.service.why_monitored;
});
</script>

<template>
    <div class="service-detail">
        <div class="detail-top">
            <div class="detail-story">
                <p v-if="service.description_excerpt" class="detail-description">
                    {{ service.description_excerpt }}
                </p>
                <p v-if="whyMonitored" class="detail-why">
                    Why we monitor this: {{ whyMonitored }}
                </p>
            </div>

            <div class="detail-summary">
                <div class="summary-stat">
                    <span class="summary-label">Current state</span>
                    <span class="summary-value">{{ statusLabel(service.overall_status) }}</span>
                </div>
                <div class="summary-stat">
                    <span class="summary-label">Probe agreement</span>
                    <span class="summary-value">{{ service.probes_up }}/{{ service.probe_count }}</span>
                </div>
                <div class="summary-stat">
                    <span class="summary-label">Last response</span>
                    <span class="summary-value">{{ formatResponseTime(lastKnownResponse) }}</span>
                </div>
            </div>
        </div>

        <div v-if="uniqueEndpoints.length" class="detail-section">
            <div class="section-label">Endpoints</div>
            <div class="endpoint-list">
                <span v-for="endpoint in uniqueEndpoints" :key="endpoint" class="endpoint-chip">
                    {{ endpoint }}
                </span>
            </div>
        </div>

        <div v-if="service.probes.length" class="detail-section">
            <div class="section-label">Per-probe health</div>
            <div class="probe-grid">
                <div v-for="probe in service.probes" :key="probe.probe_id" class="probe-card">
                    <div class="probe-name">{{ probe.probe_id }}</div>
                    <div class="probe-state">{{ probeStatusLabel(probe.overall_status) }}</div>
                    <div class="probe-meta">
                        {{ probe.up_monitors }}/{{ probe.total_monitors }} checks healthy
                    </div>
                    <div class="probe-meta">
                        Avg response {{ formatResponseTime(probe.avg_response_time) }}
                    </div>
                </div>
            </div>
        </div>

        <div class="detail-section">
            <div class="detail-section-header">
                <div class="section-label">What is being checked</div>
                <NuxtLink :to="service.docs_path" class="detail-link">
                    Technical details
                </NuxtLink>
            </div>
            <div class="monitor-list">
                <div
                    v-for="monitor in service.monitors"
                    :key="monitor.id"
                    class="monitor-row"
                >
                    <div class="monitor-main">
                        <div class="monitor-name-row">
                            <span class="monitor-name">{{ monitor.name }}</span>
                            <span class="monitor-type">{{ typeLabel(monitor.type) }}</span>
                        </div>
                        <div v-if="monitor.endpoint" class="monitor-endpoint">
                            {{ monitor.endpoint }}
                        </div>
                        <div v-if="monitor.description_excerpt" class="monitor-description">
                            {{ monitor.description_excerpt }}
                        </div>
                    </div>
                    <div class="monitor-side">
                        <span class="monitor-state" :class="`status-${monitor.status}`">
                            {{ statusLabel(monitor.status) }}
                        </span>
                        <span class="monitor-response">{{ formatResponseTime(monitor.response_time) }}</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.service-detail {
    border-top: 1px solid var(--color-border);
    padding: 18px 20px 20px;
    display: flex;
    flex-direction: column;
    gap: 18px;
}

.detail-top {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
    gap: 18px;
}

.detail-story {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.detail-description,
.detail-why {
    color: var(--color-text-muted);
    font-size: 14px;
    line-height: 1.7;
}

.detail-summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
}

.summary-stat,
.probe-card {
    background: var(--color-surface-hover);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 12px;
}

.summary-label,
.section-label {
    display: block;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-subtle);
    margin-bottom: 6px;
}

.summary-value {
    font-size: 16px;
    font-weight: 600;
}

.detail-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.detail-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.detail-link {
    font-size: 13px;
    font-weight: 600;
}

.endpoint-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.endpoint-chip {
    display: inline-flex;
    align-items: center;
    padding: 6px 10px;
    border-radius: 999px;
    background: var(--color-surface-hover);
    border: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-size: 12px;
    font-family: var(--font-mono);
}

.probe-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
}

.probe-name {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 4px;
}

.probe-state {
    color: var(--color-text);
    font-size: 13px;
    margin-bottom: 8px;
}

.probe-meta {
    color: var(--color-text-muted);
    font-size: 12px;
    line-height: 1.6;
}

.monitor-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.monitor-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--color-surface-hover);
    border: 1px solid var(--color-border);
}

.monitor-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.monitor-name-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.monitor-name {
    font-size: 14px;
    font-weight: 600;
}

.monitor-type {
    font-size: 11px;
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
    padding: 1px 8px;
    border-radius: 999px;
    white-space: nowrap;
}

.monitor-endpoint,
.monitor-description {
    color: var(--color-text-muted);
    font-size: 12px;
    line-height: 1.6;
}

.monitor-endpoint {
    font-family: var(--font-mono);
}

.monitor-side {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    flex-shrink: 0;
}

.monitor-state {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 72px;
    padding: 3px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
}

.monitor-response {
    font-family: var(--font-mono);
    color: var(--color-text-muted);
    font-size: 12px;
}

.status-up {
    background: rgba(167, 196, 173, 0.14);
    color: var(--color-status-up);
}

.status-down {
    background: rgba(230, 126, 128, 0.14);
    color: var(--color-status-down);
}

.status-degraded {
    background: rgba(242, 193, 141, 0.14);
    color: var(--color-status-degraded);
}

.status-unknown {
    background: rgba(107, 112, 116, 0.14);
    color: var(--color-status-unknown);
}

@media (max-width: 860px) {
    .detail-top,
    .detail-summary {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 640px) {
    .service-detail {
        padding: 16px;
    }

    .monitor-row {
        flex-direction: column;
    }

    .monitor-side {
        align-items: flex-start;
    }
}
</style>
