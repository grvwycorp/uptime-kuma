<script setup lang="ts">
import type { PublicServiceSummary } from "~/types/public";

const props = defineProps<{
    title: string;
    services: PublicServiceSummary[];
    expandedSlug: string | null;
    highlightedSlug: string | null;
    assignRef: (slug: string) => (el: Element | null) => void;
}>();

const emit = defineEmits<{
    toggle: [slug: string];
}>();

const STATUS_WEIGHT: Record<PublicServiceSummary["overall_status"], number> = {
    down: 0,
    degraded: 1,
    unknown: 2,
    up: 3,
};

/* Services with problems sort first; otherwise keep incoming order (stable sort). */
const sortedServices = computed(() =>
    [...props.services].sort((a, b) => STATUS_WEIGHT[a.overall_status] - STATUS_WEIGHT[b.overall_status]),
);

const troubledCount = computed(() =>
    props.services.filter((service) =>
        service.overall_status === "down" || service.overall_status === "degraded",
    ).length,
);

const countLine = computed(() => {
    const total = props.services.length;
    const noun = total === 1 ? "tjänst" : "tjänster";
    if (troubledCount.value === 0) {
        return `${total} ${noun} · ${total === 1 ? "fungerar" : "alla fungerar"}`;
    }
    return `${total} ${noun} · ${troubledCount.value} med störningar`;
});
</script>

<template>
    <section class="category" :aria-label="title">
        <header class="category-head">
            <h3 class="category-title">{{ title }}</h3>
            <p class="category-count" :class="{ troubled: troubledCount > 0 }">{{ countLine }}</p>
        </header>

        <div class="category-grid">
            <div
                v-for="service in sortedServices"
                :key="service.slug"
                :ref="assignRef(service.slug)"
                class="card-slot"
                :class="{ 'card-slot--expanded': expandedSlug === service.slug }"
            >
                <PublicServiceCard
                    :service="service"
                    :expanded="expandedSlug === service.slug"
                    :highlighted="highlightedSlug === service.slug"
                    @toggle="emit('toggle', $event)"
                />
            </div>
        </div>
    </section>
</template>

<style scoped>
.category-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 14px;
    flex-wrap: wrap;
}

.category-title {
    font-size: 19px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--color-text);
}

.category-count {
    font-size: 13px;
    color: var(--color-text-subtle);
}

.category-count.troubled {
    color: var(--color-status-degraded);
    font-weight: 500;
}

.category-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
}

.card-slot {
    min-width: 0;
}

.card-slot--expanded {
    grid-column: 1 / -1;
}

@media (max-width: 960px) {
    .category-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

@media (max-width: 620px) {
    .category-grid {
        grid-template-columns: 1fr;
    }
}
</style>
