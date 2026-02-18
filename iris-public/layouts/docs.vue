<template>
    <div class="connection-banner" v-if="!connected && !loading">
        Disconnected from Uptime Kuma &mdash; data may be stale
    </div>
    <slot />
</template>

<script setup lang="ts">
const { connected, loading } = useMonitors();
const { status } = useStatus();

const fleetSummary = computed(() => {
    const entries = Object.values(status.value);
    if (entries.length === 0) {
        return { title: "Iris Docs", color: "#7A8478" };
    }
    const down = entries.filter(s => s.aggregated === "down").length;
    const degraded = entries.filter(s => s.aggregated === "degraded").length;
    if (down > 0) {
        return { title: `Iris Docs — ${down} DOWN`, color: "#E67E80" };
    }
    if (degraded > 0) {
        return { title: `Iris Docs — ${degraded} degraded`, color: "#DBBC7F" };
    }
    return { title: "Iris Docs — All Clear", color: "#A7C080" };
});

const faviconSvg = computed(() => {
    const c = fleetSummary.value.color;
    return `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='14' fill='${encodeURIComponent(c)}'/></svg>`;
});

useHead({
    title: fleetSummary.value.title,
    link: [{ rel: "icon", type: "image/svg+xml", href: faviconSvg.value }],
});

watch(fleetSummary, (s) => {
    useHead({
        title: s.title,
        link: [{ rel: "icon", type: "image/svg+xml", href: faviconSvg.value }],
    });
});
</script>

<style scoped>
.connection-banner {
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--red);
    color: var(--bg-dim);
    text-align: center;
    padding: 6px 16px;
    font-size: 13px;
    font-weight: 600;
}
</style>
