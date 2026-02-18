<template>
    <div v-if="probes && Object.keys(probes).length > 0" class="probe-breakdown">
        <div
            v-for="(probe, probeId) in probes"
            :key="probeId"
            class="probe-row"
        >
            <StatusBadge :status="probe.up ? 'up' : 'down'" />
            <span class="probe-name">{{ probeId }}</span>
            <span class="probe-rt">{{ probe.responseTime > 0 ? formatMs(probe.responseTime) : '—' }}</span>
        </div>
    </div>
    <div v-else class="probe-breakdown empty">
        No probe data available
    </div>
</template>

<script setup lang="ts">
import type { ProbeStatus } from "~/server/utils/prom-client";

defineProps<{
    probes: Record<string, ProbeStatus> | undefined;
}>();

/**
 * Format milliseconds for display: "42ms" or "1.2s"
 * @param ms - value in milliseconds
 * @returns formatted string
 */
function formatMs(ms: number): string {
    if (ms >= 1000) {
        return `${(ms / 1000).toFixed(1)}s`;
    }
    return `${Math.round(ms)}ms`;
}
</script>

<style scoped>
.probe-breakdown {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 0;
    font-size: 13px;
}

.probe-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-radius: 4px;
    background: var(--bg1);
}

.probe-name {
    flex: 1;
    font-weight: 500;
    color: var(--fg);
}

.probe-rt {
    color: var(--grey1);
    font-variant-numeric: tabular-nums;
}

.empty {
    color: var(--grey1);
    font-style: italic;
    padding: 8px;
}
</style>
