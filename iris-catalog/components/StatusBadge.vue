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

.up { color: #10b981; }
.up .dot { background: #10b981; }

.down { color: #ef4444; }
.down .dot { background: #ef4444; }

.degraded { color: #f59e0b; }
.degraded .dot { background: #f59e0b; }

.unknown { color: #6b7280; }
.unknown .dot { background: #6b7280; }
</style>
