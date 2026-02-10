<template>
    <div class="landing">
        <header class="landing-header">
            <h1>Iris Catalog</h1>
            <p>Service documentation and live monitoring reference</p>
        </header>

        <div v-if="loading" class="landing-loading">Loading monitors...</div>

        <div v-else class="service-grid">
            <NuxtLink
                v-for="group in topLevelGroups"
                :key="group.id"
                :to="`/catalog/${group.id}`"
                class="service-card"
            >
                <div class="card-status">
                    <StatusBadge :status="getAggregated(group.id)" />
                </div>
                <h2>{{ group.name }}</h2>
                <p class="card-desc" v-if="group.description">
                    {{ truncate(group.description, 120) }}
                </p>
                <div class="card-meta">
                    <span>{{ getChildCount(group.id) }} monitors</span>
                    <span v-if="group.tags?.length">
                        {{ group.tags.map((t: any) => t.name).join(', ') }}
                    </span>
                </div>
            </NuxtLink>
        </div>

        <div v-if="!loading && topLevelGroups.length === 0" class="landing-empty">
            <p>No monitor groups found. Connect to an Uptime Kuma instance with monitors.</p>
        </div>

        <div v-if="lastUpdated" class="landing-footer">
            Status updated {{ formatAge(lastUpdated) }}
        </div>
    </div>
</template>

<script setup lang="ts">
import type { MonitorData } from "~/server/utils/kuma-state";

const { monitors, loading } = useMonitors();
const { status, lastUpdated } = useStatus();

const topLevelGroups = computed(() => {
    return Object.values(monitors.value)
        .filter((m: MonitorData) => m.type === "group" && !m.parent)
        .sort((a, b) => (a.weight ?? 2000) - (b.weight ?? 2000));
});

/**
 * Get aggregated status across all probes
 * @param id - monitor ID
 * @returns status string
 */
function getAggregated(id: number): "up" | "down" | "degraded" | "unknown" {
    return status.value[String(id)]?.aggregated || "unknown";
}

/**
 * Count all child monitors (recursive)
 * @param id - group monitor ID
 * @returns child count
 */
function getChildCount(id: number): number {
    const m = monitors.value[String(id)];
    return m?.childrenIDs?.length ?? 0;
}

/**
 * Truncate text to max length
 * @param text - input text
 * @param max - max characters
 * @returns truncated text
 */
function truncate(text: string, max: number): string {
    if (text.length <= max) {
        return text;
    }
    return text.slice(0, max).trimEnd() + "...";
}

/**
 * Format a timestamp as a human-readable age
 * @param ts - timestamp in milliseconds
 * @returns formatted string like "8s ago" or "2m ago"
 */
function formatAge(ts: number): string {
    const seconds = Math.round((Date.now() - ts) / 1000);
    if (seconds < 5) {
        return "just now";
    }
    if (seconds < 60) {
        return `${seconds}s ago`;
    }
    return `${Math.floor(seconds / 60)}m ago`;
}
</script>

<style scoped>
.landing {
    max-width: 1200px;
    margin: 0 auto;
    padding: 48px 24px;
}

.landing-header {
    text-align: center;
    margin-bottom: 48px;
}

.landing-header h1 {
    font-size: 32px;
    font-weight: 800;
    margin: 0 0 8px;
    color: var(--fg);
}

.landing-header p {
    color: var(--grey1);
    font-size: 16px;
}

.landing-loading, .landing-empty {
    text-align: center;
    color: var(--grey1);
    padding: 48px;
}

.service-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
}

.service-card {
    display: block;
    padding: 20px;
    background: var(--bg1);
    border: 1px solid var(--bg2);
    border-radius: 12px;
    text-decoration: none;
    color: var(--fg);
    transition: box-shadow 0.15s, border-color 0.15s;
}

.service-card:hover {
    border-color: var(--green);
    box-shadow: 0 2px 12px rgba(167, 192, 128, 0.12);
}

.card-status {
    margin-bottom: 8px;
}

.service-card h2 {
    font-size: 18px;
    font-weight: 700;
    margin: 0 0 6px;
    color: var(--fg);
}

.card-desc {
    font-size: 13px;
    color: var(--grey1);
    margin: 0 0 12px;
    line-height: 1.5;
}

.card-meta {
    display: flex;
    gap: 12px;
    font-size: 12px;
    color: var(--grey0);
}

.landing-footer {
    text-align: center;
    margin-top: 32px;
    font-size: 12px;
    color: var(--grey0);
}
</style>
