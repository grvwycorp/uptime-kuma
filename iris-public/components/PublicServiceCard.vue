<script setup lang="ts">
import type { PublicServiceSummary } from "~/types/public";
import { placesPhrase, statusWord } from "~/utils/plain-language";

const props = defineProps<{
    service: PublicServiceSummary;
    expanded?: boolean;
    highlighted?: boolean;
}>();

const emit = defineEmits<{
    toggle: [slug: string];
}>();

const detailId = computed(() => `service-detail-${props.service.slug}`);

/* Smooth height expand/collapse via JS transition hooks (works with v-if,
   collapses gracefully under prefers-reduced-motion thanks to the global
   transition-duration override). */
function onEnter(el: Element) {
    const element = el as HTMLElement;
    element.style.height = "0";
    element.style.opacity = "0";
    requestAnimationFrame(() => {
        element.style.height = `${element.scrollHeight}px`;
        element.style.opacity = "1";
    });
}

function onAfterEnter(el: Element) {
    const element = el as HTMLElement;
    element.style.height = "";
    element.style.opacity = "";
}

function onLeave(el: Element) {
    const element = el as HTMLElement;
    element.style.height = `${element.scrollHeight}px`;
    requestAnimationFrame(() => {
        element.style.height = "0";
        element.style.opacity = "0";
    });
}
</script>

<template>
    <article
        class="service-card"
        :class="[`card--${service.overall_status}`, { expanded, highlighted }]"
    >
        <button
            type="button"
            class="card-header"
            :aria-expanded="expanded"
            :aria-controls="detailId"
            @click="emit('toggle', service.slug)"
        >
            <div class="card-main">
                <div class="card-name-row">
                    <h4 class="card-name">{{ service.name }}</h4>
                    <span class="card-chip" :class="`chip--${service.overall_status}`">
                        <StatusIcon :status="service.overall_status" :size="14" />
                        {{ statusWord(service.overall_status) }}
                    </span>
                </div>

                <p v-if="service.description_excerpt" class="card-description">
                    {{ service.description_excerpt }}
                </p>

                <div class="card-meta">
                    <span>{{ placesPhrase(service.probe_count) }}</span>
                    <span class="chevron" :class="{ open: expanded }" aria-hidden="true">&#9662;</span>
                </div>
            </div>
        </button>

        <Transition name="detail" @enter="onEnter" @after-enter="onAfterEnter" @leave="onLeave">
            <div v-if="expanded" :id="detailId" class="detail-wrap">
                <PublicServiceDetail :service="service" />
            </div>
        </Transition>
    </article>
</template>

<style scoped>
.service-card {
    background: var(--color-surface);
    border: 1px solid var(--card-border, var(--color-border));
    border-radius: 16px;
    overflow: hidden;
    box-shadow: var(--shadow-card);
    transition: border-color 0.2s, box-shadow 0.25s;
}

.card--up {
    --card-border: var(--color-status-up-border);
    --card-border-hover: var(--color-status-up-border-hover);
}

.card--down {
    --card-border: var(--color-status-down-border);
    --card-border-hover: var(--color-status-down-border-hover);
}

.card--degraded {
    --card-border: var(--color-status-degraded-border);
    --card-border-hover: var(--color-status-degraded-border-hover);
}

.card--unknown {
    --card-border: var(--color-status-unknown-border);
    --card-border-hover: var(--color-status-unknown-border-hover);
}

.service-card:hover {
    border-color: var(--card-border-hover, var(--color-border));
}

.service-card.expanded {
    border-color: var(--color-focus);
    box-shadow: 0 0 0 1px var(--color-focus), var(--shadow-elevated);
}

.service-card.highlighted {
    box-shadow: 0 0 0 1px var(--color-focus), 0 0 0 8px var(--focus-halo);
}

.card-header {
    display: block;
    width: 100%;
    padding: 18px 20px;
    background: none;
    border: none;
    font-family: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
}

.card-header:hover {
    background: var(--color-surface-hover);
}

.card-header:focus-visible {
    outline-offset: -2px;
}

.card-name-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
}

.card-name {
    font-weight: 600;
    font-size: 17px;
    line-height: 1.3;
    color: var(--color-text);
}

.card-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 11px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    flex-shrink: 0;
}

.chip--up {
    background: var(--color-status-up-soft);
    color: var(--color-status-up);
}

.chip--down {
    background: var(--color-status-down-soft);
    color: var(--color-status-down);
}

.chip--degraded {
    background: var(--color-status-degraded-soft);
    color: var(--color-status-degraded);
}

.chip--unknown {
    background: var(--color-status-unknown-soft);
    color: var(--color-status-unknown);
}

.card-description {
    color: var(--color-text-muted);
    font-size: 13.5px;
    line-height: 1.6;
    margin-bottom: 10px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.card-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--color-text-subtle);
    font-size: 12.5px;
}

.chevron {
    font-size: 12px;
    color: var(--color-text-muted);
    transition: transform 0.25s ease;
    display: inline-block;
}

.chevron.open {
    transform: rotate(180deg);
}

.detail-wrap {
    overflow: hidden;
}

.detail-enter-active,
.detail-leave-active {
    transition: height 0.32s ease, opacity 0.32s ease;
}

@media (max-width: 640px) {
    .card-header {
        padding: 16px;
    }
}
</style>
