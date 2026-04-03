<script setup lang="ts">
import type { PublicServiceSummary } from "~/types/public";

const props = defineProps<{
    service: PublicServiceSummary;
    expanded?: boolean;
    highlighted?: boolean;
}>();

const emit = defineEmits<{
    toggle: [slug: string];
}>();

function statusColor(status: PublicServiceSummary["overall_status"]): string {
    if (status === "up") return "var(--color-status-up)";
    if (status === "degraded") return "var(--color-status-degraded)";
    if (status === "unknown") return "var(--color-status-unknown)";
    return "var(--color-status-down)";
}

function borderColor(status: PublicServiceSummary["overall_status"]): string {
    if (status === "up") return "var(--color-status-up-border)";
    if (status === "degraded") return "var(--color-status-degraded-border)";
    if (status === "unknown") return "var(--color-status-unknown-border)";
    return "var(--color-status-down-border)";
}

function borderColorHover(status: PublicServiceSummary["overall_status"]): string {
    if (status === "up") return "var(--color-status-up-border-hover)";
    if (status === "degraded") return "var(--color-status-degraded-border-hover)";
    if (status === "unknown") return "var(--color-status-unknown-border-hover)";
    return "var(--color-status-down-border-hover)";
}

function probeLabel(service: PublicServiceSummary): string {
    if (service.probe_count === 0) return "No probes";
    return `${service.probes_up}/${service.probe_count} probes`;
}

function probeColor(service: PublicServiceSummary): string {
    if (service.probe_count === 0) return "var(--color-text-muted)";
    if (service.probes_up === service.probe_count) return "var(--color-status-up)";
    if (service.probes_up === 0) return "var(--color-status-down)";
    return "var(--color-status-degraded)";
}

function serviceStatusLabel(status: PublicServiceSummary["overall_status"]): string {
    if (status === "degraded") return "Degraded";
    if (status === "down") return "Down";
    if (status === "unknown") return "Unknown";
    return "Healthy";
}
</script>

<template>
    <div
        class="service-card"
        :class="{
            expanded: expanded,
            highlighted: highlighted,
        }"
        :style="{
            '--card-border': borderColor(service.overall_status),
            '--card-border-hover': borderColorHover(service.overall_status),
        }"
    >
        <div class="card-header" @click="emit('toggle', service.slug)">
            <div class="card-body">
                <div class="card-name-row">
                    <div class="card-name">{{ service.name }}</div>
                    <span class="card-state" :class="`status-${service.overall_status}`">
                        {{ serviceStatusLabel(service.overall_status) }}
                    </span>
                </div>

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
                <span class="chevron" :class="{ open: expanded }">&#9662;</span>
            </div>
        </div>

        <PublicServiceDetail v-if="expanded" :service="service" />
    </div>
</template>

<style scoped>
.service-card {
    background: var(--color-surface);
    border: 1px solid var(--card-border, var(--color-border));
    border-radius: 14px;
    overflow: hidden;
    transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
}

.service-card:hover {
    border-color: var(--card-border-hover, var(--color-border));
}

.service-card.expanded {
    border-color: var(--color-focus);
    box-shadow: 0 0 0 1px var(--color-focus), 0 10px 30px rgba(0, 0, 0, 0.12);
}

.service-card.highlighted {
    box-shadow: 0 0 0 1px var(--color-focus), 0 0 0 8px rgba(137, 174, 207, 0.08);
}

.card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 18px 20px;
    cursor: pointer;
    gap: 12px;
    transition: background 0.15s;
}

.card-header:hover {
    background: var(--color-surface-hover);
}

.card-body {
    flex: 1;
    min-width: 0;
}

.card-name-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
}

.card-name {
    font-weight: 600;
    font-size: 18px;
    line-height: 1.3;
    color: var(--color-text);
}

.card-state {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 84px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    flex-shrink: 0;
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

.chevron {
    color: var(--color-text-muted);
    font-size: 13px;
    transition: transform 0.25s ease;
    display: inline-block;
}

.chevron.open {
    transform: rotate(180deg);
}

@media (max-width: 640px) {
    .card-header {
        padding: 16px;
    }

    .card-name-row {
        align-items: flex-start;
        flex-direction: column;
    }
}
</style>
