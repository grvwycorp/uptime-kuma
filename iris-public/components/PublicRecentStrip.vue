<script setup lang="ts">
import type { PublicRecentData, ServiceRecentItem } from "~/types/public";
import { statusWord, timeAgo } from "~/utils/plain-language";

const props = defineProps<{
    recent: PublicRecentData | null | undefined;
}>();

const emit = defineEmits<{
    select: [item: ServiceRecentItem];
}>();

type SectionKind = "down" | "recovered" | "unstable" | "disagreement";

interface RecentSection {
    key: SectionKind;
    title: string;
    explainer?: string;
    emptyLabel: string;
    items: ServiceRecentItem[];
}

const sections = computed<RecentSection[]>(() => {
    const recent = props.recent;
    return [
        {
            key: "down",
            title: "Nya störningar",
            emptyLabel: "Inga nya störningar den senaste timmen.",
            items: recent?.newly_down ?? [],
        },
        {
            key: "recovered",
            title: "Åter i drift",
            emptyLabel: "Ingen tjänst har behövt återhämta sig.",
            items: recent?.newly_recovered ?? [],
        },
        {
            key: "unstable",
            title: "Återkommande problem",
            emptyLabel: "Inga återkommande problem just nu.",
            items: recent?.most_unstable ?? [],
        },
        {
            key: "disagreement",
            title: "Olika resultat från olika mätplatser",
            explainer: "Tjänsten kan fungera i en del av landet men inte i en annan.",
            emptyLabel: "Alla mätplatser ser samma sak.",
            items: recent?.probe_disagreement ?? [],
        },
    ];
});

/* The server's summary strings contain English jargon, so we compose
   our own Swedish sentence from the structured fields instead. */
function sentence(kind: SectionKind, item: ServiceRecentItem): string {
    const affected = item.affected_monitors?.length ?? 0;
    if (kind === "down") {
        if (affected === 1) {
            return "1 av våra kontroller slår larm";
        }
        if (affected > 1) {
            return `${affected} av våra kontroller slår larm`;
        }
        return "Svarar inte som den ska";
    }
    if (kind === "recovered") {
        return "Fungerar igen";
    }
    if (kind === "unstable") {
        return "Har gått upp och ner flera gånger";
    }
    return "Mätplatserna får olika svar just nu";
}

function itemLabel(item: ServiceRecentItem): string {
    return statusWord(item.current_status);
}
</script>

<template>
    <section class="recent-strip" aria-labelledby="recent-title">
        <header class="recent-header">
            <div>
                <h2 id="recent-title" class="recent-title">Senaste timmen</h2>
                <p class="recent-sub">Det som hänt nyss — nya störningar och tjänster som kommit tillbaka.</p>
            </div>
            <ClientOnly>
                <p v-if="recent?.generated_at" class="recent-generated">
                    Uppdaterad {{ new Date(recent.generated_at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" }) }}
                </p>
            </ClientOnly>
        </header>

        <div v-if="!recent?.available" class="recent-unavailable">
            Vi kan inte visa den senaste timmens händelser just nu. Försök igen om en liten stund.
        </div>

        <div v-else class="recent-grid">
            <section v-for="section in sections" :key="section.key" class="recent-card" :aria-label="section.title">
                <header class="recent-card-header">
                    <h3>{{ section.title }}</h3>
                    <span
                        class="recent-card-count"
                        :class="{ active: section.items.length > 0 }"
                        aria-hidden="true"
                    >{{ section.items.length }}</span>
                </header>
                <p v-if="section.explainer" class="recent-explainer">{{ section.explainer }}</p>

                <p v-if="section.items.length === 0" class="recent-empty">
                    <StatusIcon status="up" :size="14" />
                    {{ section.emptyLabel }}
                </p>

                <ul v-else class="recent-items">
                    <li v-for="item in section.items" :key="`${section.key}-${item.service_id}`">
                        <button
                            type="button"
                            class="recent-item"
                            @click="emit('select', item)"
                        >
                            <span class="recent-item-main">
                                <span class="recent-service">{{ item.service_name }}</span>
                                <span class="recent-summary">{{ sentence(section.key, item) }}</span>
                            </span>
                            <span class="recent-item-side">
                                <span class="recent-badge" :class="`badge--${item.current_status}`">
                                    <StatusIcon :status="item.current_status" :size="13" />
                                    {{ itemLabel(item) }}
                                </span>
                                <ClientOnly>
                                    <span class="recent-age">{{ timeAgo(item.event_at) }}</span>
                                </ClientOnly>
                            </span>
                        </button>
                    </li>
                </ul>
            </section>
        </div>
    </section>
</template>

<style scoped>
.recent-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
}

.recent-title {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.01em;
    line-height: 1.2;
    margin-bottom: 4px;
}

.recent-sub,
.recent-generated {
    color: var(--color-text-muted);
    font-size: 13.5px;
}

.recent-generated {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
}

.recent-unavailable {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 18px 20px;
    color: var(--color-text-muted);
    font-size: 14px;
}

.recent-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
}

.recent-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 16px;
    padding: 16px 18px;
    box-shadow: var(--shadow-card);
}

.recent-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
}

.recent-card-header h3 {
    font-size: 14.5px;
    font-weight: 600;
    letter-spacing: 0.01em;
}

.recent-card-count {
    min-width: 26px;
    text-align: center;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--color-surface-hover);
    color: var(--color-text-subtle);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
}

.recent-card-count.active {
    background: var(--color-status-degraded-soft);
    color: var(--color-status-degraded);
    font-weight: 600;
}

.recent-explainer {
    color: var(--color-text-subtle);
    font-size: 12.5px;
    line-height: 1.5;
    margin-bottom: 10px;
}

.recent-empty {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text-muted);
    font-size: 13px;
    line-height: 1.6;
    padding: 6px 0 2px;
}

.recent-empty :deep(.status-icon) {
    color: var(--color-status-up);
}

.recent-items {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
}

.recent-items li + li .recent-item {
    border-top: 1px solid var(--color-border);
}

.recent-item {
    width: 100%;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 4px;
    background: transparent;
    border: none;
    border-radius: 8px;
    color: inherit;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
}

.recent-item:hover .recent-service {
    color: var(--color-accent);
}

.recent-item-main {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
}

.recent-service {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text);
    transition: color 0.15s;
}

.recent-summary,
.recent-age {
    color: var(--color-text-muted);
    font-size: 12.5px;
    line-height: 1.5;
}

.recent-item-side {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 5px;
    flex-shrink: 0;
}

.recent-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 600;
    white-space: nowrap;
}

.badge--up {
    background: var(--color-status-up-soft);
    color: var(--color-status-up);
}

.badge--down {
    background: var(--color-status-down-soft);
    color: var(--color-status-down);
}

.badge--degraded {
    background: var(--color-status-degraded-soft);
    color: var(--color-status-degraded);
}

.badge--unknown {
    background: var(--color-status-unknown-soft);
    color: var(--color-status-unknown);
}

@media (max-width: 720px) {
    .recent-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
    }

    .recent-grid {
        grid-template-columns: 1fr;
    }
}
</style>
