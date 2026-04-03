<script setup lang="ts">
import type { PublicRecentData, PublicServiceSummary, PublicStatusData, ServiceRecentItem } from "~/types/public";

definePageMeta({ layout: "public" });

type ServiceFilter = "all" | "degraded" | "down" | "recovered";

const config = useRuntimeConfig();
const statusPollInterval = config.public.statusPollInterval as number;
const recentPollInterval = 60_000;

const { data: statusData, refresh: refreshStatus } = await useFetch<PublicStatusData>("/api/public/status");
const { data: recentData, refresh: refreshRecent } = await useFetch<PublicRecentData>("/api/public/recent");
const { toggle, modeLabel, modeIcon } = useColorMode();

type ServiceRow = {
    key: string;
    expandedService: PublicServiceSummary | null;
    services: PublicServiceSummary[];
};

const expandedSlug = ref<string | null>(null);
const highlightedSlug = ref<string | null>(null);
const activeFilter = ref<ServiceFilter>("all");
const rawSearch = ref("");
const debouncedSearch = ref("");
const isSingleColumnLayout = ref(false);
const serviceRefs = shallowRef<Record<string, HTMLElement | null>>({});

let searchDebounceHandle: ReturnType<typeof setTimeout> | null = null;
let highlightResetHandle: ReturnType<typeof setTimeout> | null = null;
let statusRefreshHandle: ReturnType<typeof setInterval> | null = null;
let recentRefreshHandle: ReturnType<typeof setInterval> | null = null;
let layoutMediaQuery: MediaQueryList | null = null;
let layoutMediaHandler: ((event: MediaQueryListEvent) => void) | null = null;

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

    if (window.matchMedia) {
        layoutMediaQuery = window.matchMedia("(max-width: 640px)");
        isSingleColumnLayout.value = layoutMediaQuery.matches;
        layoutMediaHandler = (event: MediaQueryListEvent) => {
            isSingleColumnLayout.value = event.matches;
        };
        layoutMediaQuery.addEventListener("change", layoutMediaHandler);
    }
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
    if (layoutMediaQuery && layoutMediaHandler) {
        layoutMediaQuery.removeEventListener("change", layoutMediaHandler);
    }
});

function toggleCard(slug: string) {
    expandedSlug.value = expandedSlug.value === slug ? null : slug;
}

function isExpanded(slug: string): boolean {
    return expandedSlug.value === slug;
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

            if (activeFilter.value === "degraded") {
                return service.overall_status === "degraded";
            }
            if (activeFilter.value === "down") {
                return service.overall_status === "down";
            }
            if (activeFilter.value === "recovered") {
                return recoveredRecently;
            }

            return true;
        })
        .map(({ service }) => service);
});

watch(filteredServices, (services) => {
    if (expandedSlug.value && !services.some((service) => service.slug === expandedSlug.value)) {
        expandedSlug.value = null;
    }
});

function chunkServices(services: PublicServiceSummary[], size: number): PublicServiceSummary[][] {
    const rows: PublicServiceSummary[][] = [];
    for (let index = 0; index < services.length; index += size) {
        rows.push(services.slice(index, index + size));
    }
    return rows;
}

const serviceRows = computed<ServiceRow[]>(() => {
    return chunkServices(filteredServices.value, 3).map((row, index) => {
        const expandedService = expandedSlug.value
            ? row.find((service) => service.slug === expandedSlug.value) || null
            : null;

        return {
            key: `${index}-${row.map((service) => service.slug).join("-")}`,
            expandedService,
            services: expandedService
                ? row.filter((service) => service.slug !== expandedService.slug)
                : row,
        };
    });
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
const checksPerSecond = computed(() => statusData.value?.checks_per_second ?? null);

async function focusService(item: ServiceRecentItem) {
    rawSearch.value = "";
    debouncedSearch.value = "";
    activeFilter.value = "all";
    expandedSlug.value = item.service_slug;
    highlightedSlug.value = item.service_slug;

    if (highlightResetHandle) {
        clearTimeout(highlightResetHandle);
    }

    await nextTick();
    serviceRefs.value[item.service_slug]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
    });

    highlightResetHandle = setTimeout(() => {
        if (highlightedSlug.value === item.service_slug) {
            highlightedSlug.value = null;
        }
    }, 2500);
}
</script>

<template>
    <div class="page">
        <header class="header">
            <h1 class="brand">IRIS</h1>
            <p class="subtitle">Independent monitoring of critical Swedish digital services</p>
            <button class="theme-toggle" :title="modeLabel" @click="toggle">
                {{ modeIcon }}
            </button>
        </header>

        <div v-if="statusData" class="mission">
            We're currently watching <strong>{{ serviceCount }} services</strong>
            with <strong>{{ monitorsUp }}/{{ monitorsTotal }} monitors healthy</strong>
            across <strong>{{ probeCount }} probes</strong><template v-if="checksPerSecond">,
            doing roughly <strong>{{ checksPerSecond }} checks/sec</strong></template>.
            This page tries to answer two questions at once:
            <em>what is healthy right now, and what changed recently?</em>
        </div>

        <section v-if="statusData" class="service-explorer">
            <div class="explorer-head">
                <div>
                    <h2>Service Explorer</h2>
                    <p>Search by service name, filter by state, and expand any service for live detail.</p>
                </div>
                <div class="result-count">
                    Showing {{ filteredCount }} of {{ serviceCount }} services
                </div>
            </div>

            <div class="explorer-controls">
                <label class="search-box">
                    <span class="control-label">Search service</span>
                    <input
                        v-model="rawSearch"
                        type="search"
                        placeholder="Search Swedish infrastructure..."
                        inputmode="search"
                    >
                </label>

                <div class="filter-group" role="tablist" aria-label="Service filters">
                    <button
                        type="button"
                        class="filter-chip"
                        :class="{ active: activeFilter === 'all' }"
                        @click="activeFilter = 'all'"
                    >
                        All
                    </button>
                    <button
                        type="button"
                        class="filter-chip"
                        :class="{ active: activeFilter === 'degraded' }"
                        @click="activeFilter = 'degraded'"
                    >
                        Degraded
                    </button>
                    <button
                        type="button"
                        class="filter-chip"
                        :class="{ active: activeFilter === 'down' }"
                        @click="activeFilter = 'down'"
                    >
                        Down
                    </button>
                    <button
                        type="button"
                        class="filter-chip"
                        :class="{ active: activeFilter === 'recovered' }"
                        @click="activeFilter = 'recovered'"
                    >
                        Recovered Recently
                    </button>
                </div>
            </div>

            <div v-if="isSingleColumnLayout" class="services-mobile">
                <div
                    v-for="service in filteredServices"
                    :key="service.slug"
                    :ref="assignServiceRef(service.slug)"
                    class="service-slot"
                >
                    <PublicServiceCard
                        :service="service"
                        :expanded="isExpanded(service.slug)"
                        :highlighted="highlightedSlug === service.slug"
                        @toggle="toggleCard"
                    />
                </div>
            </div>

            <div v-else class="services-desktop">
                <div
                    v-for="row in serviceRows"
                    :key="row.key"
                    class="services-row-group"
                >
                    <div
                        v-if="row.expandedService"
                        :ref="assignServiceRef(row.expandedService.slug)"
                        class="service-slot service-slot-expanded"
                    >
                        <PublicServiceCard
                            :service="row.expandedService"
                            :expanded="true"
                            :highlighted="highlightedSlug === row.expandedService.slug"
                            @toggle="toggleCard"
                        />
                    </div>

                    <div v-if="row.services.length > 0" class="services-row">
                        <div
                            v-for="service in row.services"
                            :key="service.slug"
                            :ref="assignServiceRef(service.slug)"
                            class="service-slot"
                        >
                            <PublicServiceCard
                                :service="service"
                                :expanded="false"
                                :highlighted="highlightedSlug === service.slug"
                                @toggle="toggleCard"
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div v-if="filteredServices.length === 0" class="empty-state">
                <strong>No services matched.</strong>
                <span>Try a broader search or switch back to another filter.</span>
            </div>
        </section>

        <section v-if="statusData?.targets?.length" class="map-section">
            <ClientOnly>
                <GeoMap :targets="statusData.targets" />
            </ClientOnly>
        </section>

        <section class="recent-section">
            <PublicRecentStrip :recent="recentData" @select="focusService" />
        </section>

        <footer class="footer">
            <p>
                Powered by <strong>Iris</strong> -
                <ClientOnly>
                    <span v-if="statusData">Data refreshed {{ new Date(statusData.generated_at).toLocaleString() }}</span>
                </ClientOnly>
            </p>
            <p class="disclaimer">
                Independent monitoring - may not reflect actual service status.
                <NuxtLink to="/legal">Disclaimer &amp; Privacy</NuxtLink>
            </p>
        </footer>
    </div>
</template>

<style scoped>
.page {
    max-width: 1180px;
    margin: 0 auto;
    padding: 48px 24px;
}

.header {
    text-align: center;
    margin-bottom: 24px;
    position: relative;
}

.brand {
    font-size: 48px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--color-accent);
    line-height: 1.1;
    margin-bottom: 8px;
}

.subtitle {
    color: var(--color-text-muted);
    font-size: 15px;
}

.theme-toggle {
    position: absolute;
    top: 8px;
    right: 0;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 18px;
    cursor: pointer;
    color: var(--color-text-muted);
    transition: border-color 0.2s, color 0.2s;
    line-height: 1;
}

.theme-toggle:hover {
    border-color: var(--color-accent);
    color: var(--color-accent);
}

.mission {
    text-align: center;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 22px 24px;
    margin-bottom: 32px;
    font-size: 15px;
    color: var(--color-text-muted);
    line-height: 1.7;
}

.mission strong {
    color: var(--color-text);
    font-weight: 600;
}

.mission em {
    color: var(--color-accent);
    font-style: italic;
}

.service-explorer {
    margin-top: 8px;
}

.map-section {
    margin-top: 24px;
}

.recent-section {
    margin-top: 8px;
}

.explorer-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
}

.explorer-head h2 {
    font-size: 22px;
    margin-bottom: 4px;
}

.explorer-head p,
.result-count {
    color: var(--color-text-muted);
    font-size: 13px;
}

.explorer-controls {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
    flex-wrap: wrap;
}

.search-box {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: min(360px, 100%);
}

.control-label {
    display: block;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-subtle);
}

.search-box input {
    width: 100%;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 12px 14px;
    color: var(--color-text);
    font-size: 14px;
    outline: none;
}

.search-box input:focus {
    border-color: var(--color-focus);
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
    padding: 9px 12px;
    font-size: 13px;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s, background 0.2s;
}

.filter-chip:hover,
.filter-chip.active {
    border-color: var(--color-focus);
    color: var(--color-text);
    background: var(--color-surface-hover);
}

.services-desktop,
.services-mobile {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.services-row-group {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.services-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
}

.service-slot {
    min-width: 0;
}

.service-slot-expanded {
    width: 100%;
}

.empty-state {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
    justify-content: center;
    text-align: center;
    margin-top: 16px;
    padding: 28px;
    border-radius: 14px;
    border: 1px dashed var(--color-border);
    color: var(--color-text-muted);
}

.footer {
    text-align: center;
    margin-top: 48px;
    color: var(--color-text-muted);
    font-size: 13px;
}

.footer strong {
    color: var(--color-text);
}

.disclaimer {
    margin-top: 8px;
    font-size: 12px;
}

.disclaimer a {
    color: var(--color-text-muted);
    text-decoration: underline;
    text-underline-offset: 2px;
}

.disclaimer a:hover {
    color: var(--color-text);
}

@media (max-width: 860px) {
    .explorer-head,
    .explorer-controls {
        flex-direction: column;
        align-items: flex-start;
    }

    .search-box {
        min-width: 100%;
    }
}

@media (max-width: 640px) {
    .page {
        padding: 24px 16px;
    }

    .brand {
        font-size: 36px;
    }

    .theme-toggle {
        top: 0;
        right: 0;
        padding: 4px 8px;
        font-size: 16px;
    }

    .map-section {
        margin-top: 20px;
    }

    .recent-section {
        margin-top: 4px;
    }
}
</style>
