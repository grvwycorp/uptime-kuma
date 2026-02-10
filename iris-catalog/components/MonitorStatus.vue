<template>
    <div class="monitor-status">
        <div class="status-header">Live Status</div>

        <div v-if="monitors.length === 0" class="status-empty">
            Select a service to see monitor status
        </div>

        <div v-for="m in monitors" :key="m.id" class="monitor-row">
            <div class="monitor-main" @click="toggleExpand(m.id)">
                <StatusBadge :status="getAggregated(m.id)" />
                <span class="monitor-name">{{ m.name }}</span>
                <span class="monitor-rt">{{ getResponseTime(m.id) }}</span>
                <span v-if="hasMultipleProbes(m.id)" class="expand-icon" :class="{ expanded: expanded[m.id] }">
                    &#9654;
                </span>
            </div>

            <!-- Per-probe drill-down -->
            <ProbeBreakdown
                v-if="expanded[m.id]"
                :probes="getProbes(m.id)"
            />

            <!-- Probe summary -->
            <div v-if="hasMultipleProbes(m.id) && !expanded[m.id]" class="probe-summary">
                {{ getHealthySummary(m.id) }}
            </div>
        </div>

        <div v-if="lastUpdated" class="status-footer">
            Updated {{ lastUpdatedText }}
        </div>
    </div>
</template>

<script setup lang="ts">
import type { MonitorData } from "~/server/utils/kuma-state";
import type { MonitorStatus as MonitorStatusType, ProbeStatus } from "~/server/utils/prom-client";

const props = defineProps<{
    monitors: MonitorData[];
    status: Record<string, MonitorStatusType>;
    lastUpdated: number;
}>();

const expanded = ref<Record<number, boolean>>({});

// Reactive timer for smooth "Updated Xs ago" display
const now = ref(Date.now());
let tickInterval: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
    tickInterval = setInterval(() => {
        now.value = Date.now();
    }, 5000);
});

onUnmounted(() => {
    if (tickInterval) {
        clearInterval(tickInterval);
    }
});

const lastUpdatedText = computed(() => {
    if (!props.lastUpdated) {
        return "";
    }
    const seconds = Math.round((now.value - props.lastUpdated) / 1000);
    if (seconds < 5) {
        return "just now";
    }
    if (seconds < 60) {
        return `${seconds}s ago`;
    }
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
});

/**
 * Toggle the per-probe drill-down for a monitor
 * @param id - monitor ID
 */
function toggleExpand(id: number) {
    expanded.value = { ...expanded.value, [id]: !expanded.value[id] };
}

/**
 * Get aggregated status for a monitor
 * @param id - monitor ID
 * @returns aggregated status string
 */
function getAggregated(id: number): "up" | "down" | "degraded" | "unknown" {
    return props.status[String(id)]?.aggregated || "unknown";
}

/**
 * Get formatted response time (average across probes)
 * @param id - monitor ID
 * @returns formatted string like "12ms" or "—"
 */
function getResponseTime(id: number): string {
    const probes = props.status[String(id)]?.probes;
    if (!probes) {
        return "—";
    }
    const values = Object.values(probes).filter(p => p.responseTime > 0);
    if (values.length === 0) {
        return "—";
    }
    const avg = Math.round(values.reduce((sum, p) => sum + p.responseTime, 0) / values.length);
    return `${avg}ms`;
}

/**
 * Check if monitor has data from multiple probes
 * @param id - monitor ID
 * @returns true if more than one probe
 */
function hasMultipleProbes(id: number): boolean {
    const probes = props.status[String(id)]?.probes;
    return !!probes && Object.keys(probes).length > 1;
}

/**
 * Get the probes map for a monitor
 * @param id - monitor ID
 * @returns probes record or undefined
 */
function getProbes(id: number): Record<string, ProbeStatus> | undefined {
    return props.status[String(id)]?.probes;
}

/**
 * Get healthy probe summary text
 * @param id - monitor ID
 * @returns text like "2/3 probes healthy"
 */
function getHealthySummary(id: number): string {
    const probes = props.status[String(id)]?.probes;
    if (!probes) {
        return "";
    }
    const total = Object.keys(probes).length;
    const healthy = Object.values(probes).filter(p => p.up).length;
    return `${healthy}/${total} probes healthy`;
}
</script>

<style scoped>
.monitor-status {
    height: 100%;
    overflow-y: auto;
    padding: 12px 0;
}

.status-header {
    padding: 0 16px 12px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--grey0);
}

.status-empty {
    padding: 16px;
    color: var(--grey1);
    font-size: 13px;
}

.monitor-row {
    border-bottom: 1px solid var(--bg2);
}

.monitor-main {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    cursor: pointer;
    transition: background 0.1s;
}

.monitor-main:hover {
    background: var(--bg1);
}

.monitor-name {
    flex: 1;
    font-size: 13px;
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.monitor-rt {
    font-size: 12px;
    color: var(--grey1);
    font-variant-numeric: tabular-nums;
}

.expand-icon {
    font-size: 9px;
    color: var(--grey0);
    transition: transform 0.15s;
}

.expand-icon.expanded {
    transform: rotate(90deg);
}

.probe-summary {
    padding: 2px 16px 8px 52px;
    font-size: 11px;
    color: var(--grey0);
}

.status-footer {
    padding: 8px 16px;
    font-size: 11px;
    color: var(--grey0);
    text-align: right;
    border-top: 1px solid var(--bg2);
    margin-top: auto;
}
</style>
