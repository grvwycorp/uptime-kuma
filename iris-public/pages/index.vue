<script setup lang="ts">
import type { PublicRecentData, PublicServiceSummary, PublicStatusData, ServiceRecentItem } from "~/types/public";
import { CATEGORY_ORDER, categoryIdForSlug } from "~/utils/categories";

definePageMeta({ layout: "public" });

type ServiceFilter = "all" | "trouble" | "recovered";

const config = useRuntimeConfig();
const statusPollInterval = config.public.statusPollInterval as number;
const recentPollInterval = 60_000;

const { data: statusData, refresh: refreshStatus } = await useFetch<PublicStatusData>("/api/public/status");
const { data: recentData, refresh: refreshRecent } = await useFetch<PublicRecentData>("/api/public/recent");
const { resolved, toggle } = useColorMode();

const expandedSlug = ref<string | null>(null);
const highlightedSlug = ref<string | null>(null);
const activeFilter = ref<ServiceFilter>("all");
const rawSearch = ref("");
const debouncedSearch = ref("");
const serviceRefs = shallowRef<Record<string, HTMLElement | null>>({});

let searchDebounceHandle: ReturnType<typeof setTimeout> | null = null;
let highlightResetHandle: ReturnType<typeof setTimeout> | null = null;
let statusRefreshHandle: ReturnType<typeof setInterval> | null = null;
let recentRefreshHandle: ReturnType<typeof setInterval> | null = null;

const themeToggleLabel = computed(() =>
    resolved.value === "dark" ? "Byt till ljust läge" : "Byt till mörkt läge",
);

function normalizeSearchValue(value: string): string {
    return value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

watch(rawSearch, (value) => {
    if (searchDebounceHandle) {
        clearTimeout(searchDebounceHandle);
    }
    searchDebounceHandle = setTimeout(() => {
        debouncedSearch.value = normalizeSearchValue(value);
    }, 120);
});

onMounted(() => {
    statusRefreshHandle = setInterval(refreshStatus, statusPollInterval);
    recentRefreshHandle = setInterval(refreshRecent, recentPollInterval);
});

onUnmounted(() => {
    if (statusRefreshHandle) {
        clearInterval(statusRefreshHandle);
    }
    if (recentRefreshHandle) {
        clearInterval(recentRefreshHandle);
    }
    if (searchDebounceHandle) {
        clearTimeout(searchDebounceHandle);
    }
    if (highlightResetHandle) {
        clearTimeout(highlightResetHandle);
    }
});

function toggleCard(slug: string) {
    expandedSlug.value = expandedSlug.value === slug ? null : slug;
}

function setServiceRef(slug: string, el: Element | null) {
    serviceRefs.value[slug] = el instanceof HTMLElement ? el : null;
}

function assignServiceRef(slug: string) {
    return (el: Element | null) => setServiceRef(slug, el);
}

const services = computed(() => statusData.value?.services ?? []);
const recoveredRecently = computed(() =>
    new Set(recentData.value?.newly_recovered.map((item) => item.service_slug) ?? []),
);

const searchableServices = computed(() => services.value.map((service) => ({
    service,
    searchKey: normalizeSearchValue(service.name),
    recoveredRecently: recoveredRecently.value.has(service.slug),
})));

const filteredServices = computed(() => {
    return searchableServices.value
        .filter(({ service, searchKey, recoveredRecently }) => {
            if (debouncedSearch.value && !searchKey.includes(debouncedSearch.value)) {
                return false;
            }

            if (activeFilter.value === "trouble") {
                return service.overall_status === "down" || service.overall_status === "degraded";
            }
            if (activeFilter.value === "recovered") {
                return recoveredRecently;
            }

            return true;
        })
        .map(({ service }) => service);
});

watch(filteredServices, (visible) => {
    if (expandedSlug.value && !visible.some((service) => service.slug === expandedSlug.value)) {
        expandedSlug.value = null;
    }
});

const categoryGroups = computed(() => {
    const buckets = new Map<string, PublicServiceSummary[]>();
    for (const service of filteredServices.value) {
        const categoryId = categoryIdForSlug(service.slug);
        const bucket = buckets.get(categoryId);
        if (bucket) {
            bucket.push(service);
        } else {
            buckets.set(categoryId, [service]);
        }
    }

    return CATEGORY_ORDER
        .map((category) => ({
            id: category.id,
            title: category.title,
            services: buckets.get(category.id) ?? [],
        }))
        .filter((group) => group.services.length > 0);
});

const serviceCount = computed(() => services.value.length);
const filteredCount = computed(() => filteredServices.value.length);
const monitorsTotal = computed(() => statusData.value?.monitors_total ?? 0);
const monitorsUp = computed(() => statusData.value?.monitors_up ?? 0);
const probeCount = computed(() =>
    services.value.length > 0
        ? Math.max(...services.value.map((service) => service.probe_count))
        : 0,
);
const checksPerSecond = computed(() => {
    const value = statusData.value?.checks_per_second;
    if (value === null || value === undefined) {
        return null;
    }
    return new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 1 }).format(value);
});

const filterChips: Array<{ value: ServiceFilter; label: string }> = [
    { value: "all", label: "Alla" },
    { value: "trouble", label: "Med störningar" },
    { value: "recovered", label: "Nyligen åtgärdade" },
];

function resetFilters() {
    rawSearch.value = "";
    debouncedSearch.value = "";
    activeFilter.value = "all";
}

async function focusServiceBySlug(slug: string) {
    resetFilters();
    expandedSlug.value = slug;
    highlightedSlug.value = slug;

    if (highlightResetHandle) {
        clearTimeout(highlightResetHandle);
    }

    await nextTick();
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    serviceRefs.value[slug]?.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "center",
    });

    highlightResetHandle = setTimeout(() => {
        if (highlightedSlug.value === slug) {
            highlightedSlug.value = null;
        }
    }, 2500);
}

function focusService(item: ServiceRecentItem) {
    focusServiceBySlug(item.service_slug);
}
</script>

<template>
    <div class="page">
        <header class="site-header">
            <p class="brand" aria-label="Iris">IRIS</p>
            <h1 class="tagline">Fungerar Sveriges digitala tjänster just nu?</h1>
            <button
                class="theme-toggle"
                type="button"
                :title="themeToggleLabel"
                :aria-label="themeToggleLabel"
                @click="toggle"
            >
                <svg
                    v-if="resolved === 'dark'"
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    aria-hidden="true"
                >
                    <circle cx="12" cy="12" r="4.2" />
                    <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19" />
                </svg>
                <svg
                    v-else
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                >
                    <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />
                </svg>
            </button>
        </header>

        <main>
            <div v-if="statusData" class="rise" style="--stagger: 0">
                <HeroVerdict :services="services" @select-service="focusServiceBySlug" />
            </div>

            <section
                v-if="statusData"
                class="finder rise"
                style="--stagger: 1"
                aria-label="Sök och filtrera tjänster"
            >
                <div class="search-box">
                    <svg
                        class="search-icon"
                        width="17"
                        height="17"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        aria-hidden="true"
                    >
                        <circle cx="10.8" cy="10.8" r="6.8" />
                        <path d="m20 20-4.4-4.4" />
                    </svg>
                    <input
                        v-model="rawSearch"
                        type="search"
                        placeholder="Sök tjänst (t.ex. BankID, 1177, Swish)…"
                        inputmode="search"
                        aria-label="Sök tjänst"
                    >
                </div>

                <div class="finder-row">
                    <div class="filter-group" role="group" aria-label="Filtrera tjänster">
                        <button
                            v-for="chip in filterChips"
                            :key="chip.value"
                            type="button"
                            class="filter-chip"
                            :class="{ active: activeFilter === chip.value }"
                            :aria-pressed="activeFilter === chip.value"
                            @click="activeFilter = chip.value"
                        >
                            {{ chip.label }}
                        </button>
                    </div>
                    <p class="result-count" aria-live="polite">
                        Visar {{ filteredCount }} av {{ serviceCount }} tjänster
                    </p>
                </div>
            </section>

            <div v-if="statusData" class="categories rise" style="--stagger: 2">
                <CategorySection
                    v-for="group in categoryGroups"
                    :key="group.id"
                    :title="group.title"
                    :services="group.services"
                    :expanded-slug="expandedSlug"
                    :highlighted-slug="highlightedSlug"
                    :assign-ref="assignServiceRef"
                    @toggle="toggleCard"
                />

                <div v-if="filteredServices.length === 0" class="empty-state">
                    <strong>Ingen tjänst matchade.</strong>
                    <span>Prova ett annat namn, eller visa alla tjänster igen.</span>
                    <button type="button" class="empty-reset" @click="resetFilters">
                        Visa alla tjänster
                    </button>
                </div>
            </div>

            <section class="recent-section rise" style="--stagger: 3">
                <PublicRecentStrip :recent="recentData" @select="focusService" />
            </section>

            <section
                v-if="statusData?.targets?.length"
                class="map-section rise"
                style="--stagger: 4"
                aria-labelledby="map-title"
            >
                <h2 id="map-title" class="section-title">Servrarna vi håller koll på</h2>
                <p class="section-sub">
                    Varje punkt är en server hos någon av tjänsterna vi mäter — färgen visar om den svarar just nu.
                </p>
                <ClientOnly>
                    <GeoMap :targets="statusData.targets" />
                </ClientOnly>
            </section>

            <section v-if="statusData" class="stats-strip rise" style="--stagger: 5" aria-label="Siffror för nyfikna">
                <span><span class="num">{{ monitorsUp }}</span> av <span class="num">{{ monitorsTotal }}</span> kontroller gröna</span>
                <span v-if="checksPerSecond" class="stats-sep" aria-hidden="true">&middot;</span>
                <span v-if="checksPerSecond">~<span class="num">{{ checksPerSecond }}</span> kontroller per sekund</span>
                <span class="stats-sep" aria-hidden="true">&middot;</span>
                <span><span class="num">{{ probeCount }}</span> mätplatser</span>
            </section>
        </main>

        <footer class="footer">
            <ClientOnly>
                <p v-if="statusData" class="footer-updated">
                    <span class="live-dot" aria-hidden="true" />
                    Uppdaterad {{ new Date(statusData.generated_at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }}
                </p>
            </ClientOnly>
            <p class="footer-note">
                Iris övervakar oberoende — statusen här kan skilja sig från tjänsternas egna besked.
            </p>
            <nav class="footer-links" aria-label="Sidfotslänkar">
                <NuxtLink to="/legal">Ansvarsfriskrivning &amp; integritet</NuxtLink>
                <span class="stats-sep" aria-hidden="true">&middot;</span>
                <NuxtLink to="/docs">Teknisk dokumentation</NuxtLink>
            </nav>
        </footer>
    </div>
</template>

<style scoped>
.page {
    max-width: 1080px;
    margin: 0 auto;
    padding: 40px 24px 56px;
}

/* Entrance animation — sections rise in with a gentle stagger */
.rise {
    animation: rise-in 0.55s cubic-bezier(0.22, 0.61, 0.36, 1) both;
    animation-delay: calc(var(--stagger, 0) * 90ms);
}

.site-header {
    position: relative;
    text-align: center;
    margin-bottom: 28px;
    padding-top: 8px;
}

.brand {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.34em;
    color: var(--color-accent);
    margin-bottom: 10px;
}

.tagline {
    font-size: clamp(17px, 3vw, 21px);
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--color-text);
}

.theme-toggle {
    position: absolute;
    top: 0;
    right: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    cursor: pointer;
    color: var(--color-text-muted);
    transition: border-color 0.2s, color 0.2s;
}

.theme-toggle:hover {
    border-color: var(--color-accent);
    color: var(--color-accent);
}

.finder {
    margin-top: 28px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.search-box {
    position: relative;
}

.search-icon {
    position: absolute;
    top: 50%;
    left: 16px;
    transform: translateY(-50%);
    color: var(--color-text-subtle);
    pointer-events: none;
}

.search-box input {
    width: 100%;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 14px;
    padding: 14px 16px 14px 44px;
    color: var(--color-text);
    font-size: 15px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
}

.search-box input::placeholder {
    color: var(--color-text-subtle);
}

.search-box input:focus {
    border-color: var(--color-focus);
    box-shadow: 0 0 0 4px var(--focus-halo);
}

.finder-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
}

.filter-group {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.filter-chip {
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-muted);
    border-radius: 999px;
    padding: 8px 15px;
    font-size: 13.5px;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s, background 0.2s;
}

.filter-chip:hover {
    border-color: var(--color-focus);
    color: var(--color-text);
}

.filter-chip.active {
    border-color: var(--color-focus);
    background: var(--color-accent);
    color: var(--color-bg);
    font-weight: 600;
}

.result-count {
    color: var(--color-text-subtle);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
}

.categories {
    margin-top: 34px;
    display: flex;
    flex-direction: column;
    gap: 38px;
}

.empty-state {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 36px 24px;
    border-radius: 16px;
    border: 1px dashed var(--color-border);
    color: var(--color-text-muted);
}

.empty-reset {
    margin-top: 6px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    border-radius: 999px;
    padding: 9px 18px;
    font-size: 13.5px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 0.2s;
}

.empty-reset:hover {
    border-color: var(--color-accent);
}

.recent-section {
    margin-top: 52px;
}

.map-section {
    margin-top: 52px;
}

.section-title {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.01em;
    margin-bottom: 4px;
}

.section-sub {
    color: var(--color-text-muted);
    font-size: 13.5px;
    margin-bottom: 16px;
}

.stats-strip {
    margin-top: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    flex-wrap: wrap;
    color: var(--color-text-subtle);
    font-size: 13px;
    text-align: center;
}

.num {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--color-text-muted);
}

.stats-sep {
    color: var(--color-text-subtle);
}

.footer {
    text-align: center;
    margin-top: 44px;
    padding-top: 28px;
    border-top: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-size: 13px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
}

.footer-updated {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-variant-numeric: tabular-nums;
}

.live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-status-up);
    animation: live-pulse 2.4s ease-in-out infinite;
}

.footer-note {
    max-width: 520px;
    line-height: 1.6;
}

.footer-links {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: center;
}

.footer-links a {
    color: var(--color-text-muted);
    text-decoration: underline;
    text-underline-offset: 3px;
}

.footer-links a:hover {
    color: var(--color-text);
}

@media (max-width: 640px) {
    .page {
        padding: 20px 14px 40px;
    }

    .site-header {
        text-align: left;
        padding-right: 48px;
    }

    .categories {
        margin-top: 28px;
        gap: 30px;
    }

    .recent-section,
    .map-section {
        margin-top: 40px;
    }
}
</style>
