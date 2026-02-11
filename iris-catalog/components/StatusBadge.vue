<template>
    <span class="status-badge" :class="status">
        <span class="dot"></span>
        {{ label }}
    </span>
</template>

<script setup lang="ts">
const props = defineProps<{
    status: "up" | "down" | "degraded" | "unknown";
}>();

const label = computed(() => {
    const labels: Record<string, string> = {
        up: "UP",
        down: "DOWN",
        degraded: "DEGRADED",
        unknown: "—",
    };
    return labels[props.status] || "—";
});
</script>

<style scoped>
.status-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 2px 8px;
    border-radius: 10px;
}

.dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
}

.up { color: var(--green); }
.up .dot { background: var(--green); }

.down { color: var(--red); }
.down .dot { background: var(--red); animation: pulse 2s ease-in-out infinite; }

.degraded { color: var(--yellow); }
.degraded .dot { background: var(--yellow); animation: pulse 3s ease-in-out infinite; }

@keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.5); opacity: 0.6; }
}

.unknown { color: var(--grey0); }
.unknown .dot { background: var(--grey0); }
</style>
