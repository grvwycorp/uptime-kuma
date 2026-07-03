<script setup lang="ts">
/**
 * Consistent inline-SVG status iconography (CSP forbids external assets).
 * Shape + text always accompany color, so status is never conveyed by
 * color alone. Icons inherit `currentColor` from their parent.
 */
withDefaults(defineProps<{
    status: "up" | "down" | "degraded" | "unknown";
    size?: number;
}>(), {
    size: 16,
});
</script>

<template>
    <svg
        :width="size"
        :height="size"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        class="status-icon"
    >
        <template v-if="status === 'up'">
            <circle cx="12" cy="12" r="9" />
            <path d="M8.2 12.6l2.6 2.6 5-5.6" />
        </template>
        <template v-else-if="status === 'degraded'">
            <path d="M12 3.8 21.4 20H2.6L12 3.8z" />
            <path d="M12 10v4.2" />
            <path d="M12 17.4h.01" />
        </template>
        <template v-else-if="status === 'down'">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" />
        </template>
        <template v-else>
            <circle cx="12" cy="12" r="9" />
            <path d="M9.4 9.6a2.6 2.6 0 1 1 3.7 2.4c-.75.35-1.1.9-1.1 1.8" />
            <path d="M12 16.6h.01" />
        </template>
    </svg>
</template>

<style scoped>
.status-icon {
    flex-shrink: 0;
    display: block;
}
</style>
