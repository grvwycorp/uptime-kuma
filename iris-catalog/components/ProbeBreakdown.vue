<template>
    <div v-if="probes && Object.keys(probes).length > 0" class="probe-breakdown">
        <div
            v-for="(probe, probeId) in probes"
            :key="probeId"
            class="probe-row"
        >
            <StatusBadge :status="probe.up ? 'up' : 'down'" />
            <span class="probe-name">{{ probeId }}</span>
            <span class="probe-rt">{{ probe.responseTime > 0 ? probe.responseTime + 'ms' : '—' }}</span>
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
