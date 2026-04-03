<script setup lang="ts">
import type { PublicRecentData, ServiceRecentItem } from "~/types/public";

const props = defineProps<{
    recent: PublicRecentData | null | undefined;
}>();

const emit = defineEmits<{
    select: [item: ServiceRecentItem];
}>();

interface RecentSection {
    key: string;
    title: string;
    emptyLabel: string;
    items: ServiceRecentItem[];
}

function statusLabel(status: ServiceRecentItem["current_status"]): string {
    if (status === "degraded") {
        return "Degraded";
    }
    if (status === "down") {
        return "Down";
    }
    if (status === "unknown") {
        return "Unknown";
    }
    return "Up";
}

function formatAge(eventAt: string): string {
    const seconds = Math.max(0, Math.round((Date.now() - Date.parse(eventAt)) / 1000));
    if (seconds < 60) {
        return `${seconds}s ago`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return `${minutes}m ago`;
    }
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
}

const sections = computed<RecentSection[]>(() => {
    const recent = props.recent;
    return [
        {
            key: "newly-down",
            title: "Newly Down",
            emptyLabel: "No newly degraded services in the last hour.",
            items: recent?.newly_down ?? [],
        },
        {
            key: "recovered",
            title: "Recovered",
            emptyLabel: "No fresh recoveries in the last hour.",
            items: recent?.newly_recovered ?? [],
        },
        {
            key: "unstable",
            title: "Most Unstable",
            emptyLabel: "No service churn detected in the last hour.",
            items: recent?.most_unstable ?? [],
        },
        {
            key: "disagreement",
            title: "Probe Disagreement",
            emptyLabel: "Probes currently agree on service health.",
            items: recent?.probe_disagreement ?? [],
        },
    ];
});
</script>

<template>
    <section class="recent-strip">
        <div class="recent-header">
            <div>
                <h2>What Changed Recently</h2>
                <p>One-hour view of new failures, recoveries, churn, and cross-probe disagreement.</p>
            </div>
            <div v-if="recent?.generated_at" class="recent-generated">
                Updated {{ new Date(recent.generated_at).toLocaleTimeString() }}
            </div>
        </div>

        <div v-if="!recent?.available" class="recent-unavailable">
            <strong>Recent history unavailable.</strong>
            <span>{{ recent?.reason || "VictoriaMetrics did not return a usable recent-history view." }}</span>
        </div>

        <div v-else class="recent-grid">
            <section v-for="section in sections" :key="section.key" class="recent-card">
                <header class="recent-card-header">
                    <h3>{{ section.title }}</h3>
                    <span class="recent-card-count">{{ section.items.length }}</span>
                </header>

                <div v-if="section.items.length === 0" class="recent-empty">
                    {{ section.emptyLabel }}
                </div>

                <button
                    v-for="item in section.items"
                    :key="`${section.key}-${item.service_id}`"
                    type="button"
                    class="recent-item"
                    @click="emit('select', item)"
                >
                    <div class="recent-item-main">
                        <span class="recent-service">{{ item.service_name }}</span>
                        <span class="recent-summary">{{ item.summary }}</span>
                        <span v-if="item.probes_summary" class="recent-meta">{{ item.probes_summary }}</span>
                    </div>
                    <div class="recent-item-side">
                        <span class="recent-badge" :class="`status-${item.current_status}`">
                            {{ statusLabel(item.current_status) }}
                        </span>
                        <span class="recent-age">{{ formatAge(item.event_at) }}</span>
                    </div>
                </button>
            </section>
        </div>
    </section>
</template>

<style scoped>
.recent-strip {
    margin-bottom: 32px;
}

.recent-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
}

.recent-header h2 {
    font-size: 20px;
    line-height: 1.2;
    margin-bottom: 4px;
}

.recent-header p,
.recent-generated {
    color: var(--color-text-muted);
    font-size: 13px;
}

.recent-unavailable {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 16px 18px;
    color: var(--color-text-muted);
}

.recent-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
}

.recent-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 14px;
    min-height: 220px;
}

.recent-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
}

.recent-card-header h3 {
    font-size: 14px;
    letter-spacing: 0.01em;
}

.recent-card-count {
    min-width: 28px;
    text-align: center;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--color-surface-hover);
    color: var(--color-text-muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
}

.recent-empty {
    color: var(--color-text-muted);
    font-size: 13px;
    line-height: 1.6;
}

.recent-item {
    width: 100%;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
    background: transparent;
    border: none;
    border-top: 1px solid var(--color-border);
    color: inherit;
    text-align: left;
    cursor: pointer;
}

.recent-item:first-of-type {
    border-top: none;
}

.recent-item:hover .recent-service {
    color: var(--color-accent);
}

.recent-item-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}

.recent-service {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text);
}

.recent-summary,
.recent-meta,
.recent-age {
    color: var(--color-text-muted);
    font-size: 12px;
    line-height: 1.5;
}

.recent-item-side {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    flex-shrink: 0;
}

.recent-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 74px;
    padding: 3px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
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

@media (max-width: 1024px) {
    .recent-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

@media (max-width: 640px) {
    .recent-header {
        flex-direction: column;
        align-items: flex-start;
    }

    .recent-grid {
        grid-template-columns: 1fr;
    }
}
</style>
