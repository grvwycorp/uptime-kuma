<script setup lang="ts">
import type { PublicServiceSummary } from "~/types/public";
import { statusWord } from "~/utils/plain-language";

const props = defineProps<{
    services: PublicServiceSummary[];
}>();

const emit = defineEmits<{
    selectService: [slug: string];
}>();

const explainerOpen = ref(false);

const downServices = computed(() =>
    props.services.filter((service) => service.overall_status === "down"),
);
const degradedServices = computed(() =>
    props.services.filter((service) => service.overall_status === "degraded"),
);
const troubledServices = computed(() => [...downServices.value, ...degradedServices.value]);

const heroState = computed<"up" | "degraded" | "down" | "unknown">(() => {
    if (props.services.length === 0) {
        return "unknown";
    }
    if (downServices.value.length > 0) {
        return "down";
    }
    if (degradedServices.value.length > 0) {
        return "degraded";
    }
    return "up";
});

const headline = computed(() => {
    if (heroState.value === "unknown") {
        return "Vi har ingen data just nu";
    }
    if (troubledServices.value.length === 0) {
        return "Alla tjänster nåbara";
    }
    if (troubledServices.value.length === 1) {
        return "1 tjänst ej nåbar från våra mätpunkter";
    }
    return `${troubledServices.value.length} tjänster ej nåbara från våra mätpunkter`;
});

const subline = computed(() =>
    `Vi kontrollerar ${props.services.length} svenska tjänster från flera platser i Sverige — dygnet runt, oberoende av tjänsterna själva.`,
);

/* No chipWord override — use statusWord() everywhere so the vocabulary
   stays consistent and honest ("Ej nåbar" instead of "Fungerar inte"). */
</script>

<template>
    <section class="hero" :class="`hero--${heroState}`" aria-labelledby="hero-headline">
        <div class="hero-mark" :class="`mark--${heroState}`">
            <StatusIcon :status="heroState" :size="34" />
        </div>

        <h2 id="hero-headline" class="hero-headline">{{ headline }}</h2>
        <p class="hero-subline">{{ subline }}</p>

        <ul v-if="troubledServices.length" class="hero-chips" aria-label="Tjänster som inte nås från våra mätpunkter">
            <li v-for="service in troubledServices" :key="service.slug">
                <button
                    type="button"
                    class="hero-chip"
                    :class="`chip--${service.overall_status}`"
                    @click="emit('selectService', service.slug)"
                >
                    <StatusIcon :status="service.overall_status" :size="15" />
                    <span class="chip-name">{{ service.name }}</span>
                    <span class="chip-state">{{ statusWord(service.overall_status) }}</span>
                </button>
            </li>
        </ul>

        <div class="hero-explainer">
            <button
                type="button"
                class="explainer-toggle"
                :aria-expanded="explainerOpen"
                aria-controls="hero-explainer-body"
                @click="explainerOpen = !explainerOpen"
            >
                <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    aria-hidden="true"
                >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 11v5.5" />
                    <path d="M12 7.6h.01" />
                </svg>
                Hur funkar det här?
                <span class="explainer-chevron" :class="{ open: explainerOpen }" aria-hidden="true">&#9662;</span>
            </button>
            <div id="hero-explainer-body" class="explainer-reveal" :class="{ open: explainerOpen }">
                <div class="explainer-inner">
                    <p>
                        Vi skickar automatiska förfrågningar till varje tjänst från flera
                        platser i Sverige, flera gånger i minuten. Om svaren uteblir
                        rapporterar vi tjänsten som <em>ej nåbar</em>. Det kan betyda att
                        tjänsten är nere, att vår trafik blockeras, eller att det finns
                        ett nätverksproblem mellan oss och tjänsten.
                    </p>
                    <p>
                        Vi är fristående och har ingen koppling till tjänsterna vi mäter.
                    </p>
                </div>
            </div>
        </div>
    </section>
</template>

<style scoped>
.hero {
    position: relative;
    text-align: center;
    background:
        radial-gradient(120% 140% at 50% 0%, var(--hero-tint, transparent) 0%, transparent 65%),
        var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 24px;
    padding: 44px 28px 24px;
    overflow: hidden;
    box-shadow: var(--shadow-card);
}

.hero--up {
    --hero-tint: var(--hero-tint-up);
    --hero-status-color: var(--color-status-up);
    --hero-status-soft: var(--color-status-up-soft);
}

.hero--degraded {
    --hero-tint: var(--hero-tint-degraded);
    --hero-status-color: var(--color-status-degraded);
    --hero-status-soft: var(--color-status-degraded-soft);
}

.hero--down {
    --hero-tint: var(--hero-tint-down);
    --hero-status-color: var(--color-status-down);
    --hero-status-soft: var(--color-status-down-soft);
}

.hero--unknown {
    --hero-tint: var(--hero-tint-unknown);
    --hero-status-color: var(--color-status-unknown);
    --hero-status-soft: var(--color-status-unknown-soft);
}

.hero-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: var(--hero-status-soft);
    color: var(--hero-status-color);
    margin-bottom: 18px;
}

.hero-headline {
    font-size: clamp(26px, 5vw, 40px);
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.15;
    color: var(--color-text);
    margin-bottom: 12px;
}

.hero-subline {
    max-width: 560px;
    margin: 0 auto;
    color: var(--color-text-muted);
    font-size: 15px;
    line-height: 1.65;
}

.hero-chips {
    list-style: none;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
    margin-top: 22px;
}

.hero-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 9px 16px;
    border-radius: 999px;
    border: 1px solid transparent;
    font-size: 14px;
    font-family: inherit;
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}

.hero-chip:hover {
    transform: translateY(-1px);
    box-shadow: var(--shadow-card);
}

.chip--down {
    background: var(--color-status-down-soft);
    border-color: var(--color-status-down-border);
    color: var(--color-status-down);
}

.chip--down:hover {
    border-color: var(--color-status-down-border-hover);
}

.chip--degraded {
    background: var(--color-status-degraded-soft);
    border-color: var(--color-status-degraded-border);
    color: var(--color-status-degraded);
}

.chip--degraded:hover {
    border-color: var(--color-status-degraded-border-hover);
}

.chip-name {
    font-weight: 600;
    color: var(--color-text);
}

.chip-state {
    font-weight: 500;
}

.hero-explainer {
    margin-top: 26px;
    border-top: 1px solid var(--color-border);
    padding-top: 6px;
}

.explainer-toggle {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    background: none;
    border: none;
    padding: 10px 12px;
    border-radius: 10px;
    color: var(--color-text-muted);
    font-size: 13.5px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    transition: color 0.15s ease;
}

.explainer-toggle:hover {
    color: var(--color-accent);
}

.explainer-chevron {
    font-size: 11px;
    transition: transform 0.25s ease;
    display: inline-block;
}

.explainer-chevron.open {
    transform: rotate(180deg);
}

.explainer-reveal {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 0.3s ease;
}

.explainer-reveal.open {
    grid-template-rows: 1fr;
}

.explainer-inner {
    min-height: 0;
    overflow: hidden;
}

.explainer-inner p {
    max-width: 620px;
    margin: 0 auto;
    padding: 4px 8px 14px;
    color: var(--color-text-muted);
    font-size: 14px;
    line-height: 1.7;
}

@media (max-width: 640px) {
    .hero {
        padding: 32px 18px 16px;
        border-radius: 18px;
    }

    .hero-mark {
        width: 54px;
        height: 54px;
        margin-bottom: 14px;
    }

    .hero-chips {
        margin-top: 18px;
    }

    .hero-chip {
        width: 100%;
        justify-content: center;
    }
}
</style>
