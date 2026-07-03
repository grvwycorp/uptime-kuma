<script setup lang="ts">
import type { PublicServiceSummary } from "~/types/public";
import { formatMs, monitorTypeLabel, probePlaceName, speedWord, statusWord } from "~/utils/plain-language";

const props = defineProps<{
    service: PublicServiceSummary;
}>();

const whyMonitored = computed(() => {
    if (!props.service.why_monitored) {
        return null;
    }
    if (props.service.why_monitored === props.service.description_excerpt) {
        return null;
    }
    return props.service.why_monitored;
});

function speedLine(ms: number | null): string {
    if (ms === null) {
        return "—";
    }
    return speedWord(ms);
}
</script>

<template>
    <div class="service-detail">
        <p v-if="whyMonitored" class="detail-why">
            <span class="section-label">Därför övervakar vi</span>
            {{ whyMonitored }}
        </p>

        <div v-if="service.probes.length" class="detail-section">
            <h5 class="section-label">Mätplatser</h5>
            <ul class="probe-list">
                <li v-for="probe in service.probes" :key="probe.probe_id" class="probe-row">
                    <span class="probe-place">
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            aria-hidden="true"
                        >
                            <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z" />
                            <circle cx="12" cy="10" r="2.6" />
                        </svg>
                        {{ probePlaceName(probe.probe_id) }}
                    </span>
                    <span class="probe-status" :class="`text--${probe.overall_status}`">
                        <StatusIcon :status="probe.overall_status" :size="14" />
                        {{ statusWord(probe.overall_status) }}
                    </span>
                    <span class="probe-speed">
                        {{ speedLine(probe.avg_response_time) }}
                        <span v-if="probe.avg_response_time !== null" class="probe-ms">{{ formatMs(probe.avg_response_time) }}</span>
                    </span>
                </li>
            </ul>
        </div>

        <div v-if="service.monitors.length" class="detail-section">
            <h5 class="section-label">Det här kontrollerar vi</h5>
            <ul class="check-list">
                <li v-for="monitor in service.monitors" :key="monitor.id" class="check-row">
                    <div class="check-main">
                        <span class="check-label">{{ monitorTypeLabel(monitor.type) }}</span>
                        <span class="check-name">{{ monitor.name }}</span>
                    </div>
                    <span class="check-chip" :class="`chip--${monitor.status}`">
                        <StatusIcon :status="monitor.status" :size="13" />
                        {{ statusWord(monitor.status) }}
                    </span>
                </li>
            </ul>
        </div>

        <div class="detail-footer">
            <NuxtLink :to="service.docs_path" class="detail-link">
                Teknisk detalj
                <span aria-hidden="true">&rarr;</span>
            </NuxtLink>
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

.section-label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--color-text-subtle);
    margin-bottom: 8px;
}

.detail-why {
    color: var(--color-text-muted);
    font-size: 14px;
    line-height: 1.7;
}

.detail-section {
    display: flex;
    flex-direction: column;
}

.probe-list,
.check-list {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.probe-row {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1.2fr) minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    background: var(--color-surface-hover);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 10px 14px;
    font-size: 13.5px;
}

.probe-place {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-weight: 600;
    color: var(--color-text);
    min-width: 0;
}

.probe-place svg {
    color: var(--color-text-subtle);
    flex-shrink: 0;
}

.probe-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
}

.probe-speed {
    display: inline-flex;
    align-items: baseline;
    gap: 7px;
    justify-content: flex-end;
    color: var(--color-text-muted);
}

.probe-ms {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--color-text-subtle);
}

.check-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: var(--color-surface-hover);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 10px 14px;
}

.check-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}

.check-label {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--color-text);
}

.check-name {
    font-size: 12px;
    color: var(--color-text-subtle);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.check-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 600;
    white-space: nowrap;
    flex-shrink: 0;
}

.chip--up,
.text--up {
    color: var(--color-status-up);
}

.chip--down,
.text--down {
    color: var(--color-status-down);
}

.chip--degraded,
.text--degraded {
    color: var(--color-status-degraded);
}

.chip--unknown,
.text--unknown {
    color: var(--color-status-unknown);
}

.chip--up {
    background: var(--color-status-up-soft);
}

.chip--down {
    background: var(--color-status-down-soft);
}

.chip--degraded {
    background: var(--color-status-degraded-soft);
}

.chip--unknown {
    background: var(--color-status-unknown-soft);
}

.detail-footer {
    display: flex;
    justify-content: flex-end;
}

.detail-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
}

@media (max-width: 640px) {
    .service-detail {
        padding: 16px;
    }

    .probe-row {
        grid-template-columns: 1fr auto;
    }

    .probe-speed {
        grid-column: 1 / -1;
        justify-content: flex-start;
        padding-left: 21px;
    }
}
</style>
