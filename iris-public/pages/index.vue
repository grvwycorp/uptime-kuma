<script setup lang="ts">
import type { ComponentPublicInstance } from "vue";
import type { PublicRecentData, PublicServiceSummary, PublicStatusData, ServiceRecentItem } from "~/types/public";

definePageMeta({ layout: "public" });

type ServiceFilter = "all" | "degraded" | "down" | "recovered";

const STATUS_LABELS: Record<PublicServiceSummary["overall_status"], string> = {
    up: "Healthy",
    degraded: "Degraded",
    down: "Down",
    unknown: "Unknown",
};

const config = useRuntimeConfig();
const statusPollInterval = config.public.statusPollInterval as number;
const recentPollInterval = 60_000;

const { data: statusData, refresh: refreshStatus } = await useFetch<PublicStatusData>("/api/public/status");
const { data: recentData, refresh: refreshRecent } = await useFetch<PublicRecentData>("/api/public/recent");
const { toggle, modeLabel, modeIcon } = useColorMode();

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

function isExpanded(slug: string): boolean {
    return expandedSlug.value === slug;
}

function setServiceRef(slug: string, el: Element | ComponentPublicInstance | null) {
    serviceRefs.value[slug] = el instanceof HTMLElement ? el : null;
}

function statusColor(status: PublicServiceSummary["overall_status"]): string {
    if (status === "up") return "var(--color-status-up)";
    if (status === "degraded") return "var(--color-status-degraded)";
    if (status === "unknown") return "var(--color-status-unknown)";
    return "var(--color-status-down)";
}

function borderColor(status: PublicServiceSummary["overall_status"]): string {
    if (status === "up") return "var(--color-status-up-border)";
    if (status === "degraded") return "var(--color-status-degraded-border)";
    if (status === "unknown") return "var(--color-status-unknown-border)";
    return "var(--color-status-down-border)";
}

function borderColorHover(status: PublicServiceSummary["overall_status"]): string {
    if (status === "up") return "var(--color-status-up-border-hover)";
    if (status === "degraded") return "var(--color-status-degraded-border-hover)";
    if (status === "unknown") return "var(--color-status-unknown-border-hover)";
    return "var(--color-status-down-border-hover)";
}

function probeLabel(service: PublicServiceSummary): string {
    if (service.probe_count === 0) return "No probes";
    return `${service.probes_up}/${service.probe_count} probes`;
}

function probeColor(service: PublicServiceSummary): string {
    if (service.probe_count === 0) return "var(--color-text-muted)";
    if (service.probes_up === service.probe_count) return "var(--color-status-up)";
    if (service.probes_up === 0) return "var(--color-status-down)";
    return "var(--color-status-degraded)";
}

function serviceStatusLabel(status: PublicServiceSummary["overall_status"]): string {
    return STATUS_LABELS[status];
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

        <PublicRecentStrip :recent="recentData" @select="focusService" />

        <ClientOnly>
            <GeoMap v-if="statusData?.targets?.length" :targets="statusData.targets" />
        </ClientOnly>

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

            <div class="services">
                <div
                    v-for="service in filteredServices"
                    :key="service.slug"
                    :ref="(el) => setServiceRef(service.slug, el)"
                    class="service-card"
                    :class="{
                        expanded: isExpanded(service.slug),
                        highlighted: highlightedSlug === service.slug,
                    }"
                    :style="{
                        '--card-border': borderColor(service.overall_status),
                        '--card-border-hover': borderColorHover(service.overall_status),
                    }"
                >
                    <div class="card-header" @click="toggleCard(service.slug)">
                        <div class="card-body">
                            <div class="card-name-row">
                                <div class="card-name">{{ service.name }}</div>
                                <span class="card-state" :class="`status-${service.overall_status}`">
                                    {{ serviceStatusLabel(service.overall_status) }}
                                </span>
                            </div>

                            <p v-if="service.description_excerpt" class="card-description">
                                {{ service.description_excerpt }}
                            </p>

                            <div class="card-meta">
                                <span class="probe-count" :style="{ color: probeColor(service) }">
                                    {{ probeLabel(service) }}
                                </span>
                                <span class="meta-sep">&middot;</span>
                                <span class="monitor-count">{{ service.monitors.length }} monitors</span>
                            </div>
                        </div>

                        <div class="card-status">
                            <span
                                class="status-dot"
                                :style="{ background: statusColor(service.overall_status) }"
                            />
                            <span class="chevron" :class="{ open: isExpanded(service.slug) }">&#9662;</span>
                        </div>
                    </div>

                    <PublicServiceDetail v-if="isExpanded(service.slug)" :service="service" />
                </div>
            </div>

            <div v-if="filteredServices.length === 0" class="empty-state">
                <strong>No services matched.</strong>
                <span>Try a broader search or switch back to another filter.</span>
            </div>
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

.services {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
}

.service-card {
    background: var(--color-surface);
    border: 1px solid var(--card-border, var(--color-border));
    border-radius: 14px;
    overflow: hidden;
    transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
}

.service-card:hover {
    border-color: var(--card-border-hover, var(--color-border));
}

.service-card.expanded {
    grid-column: 1 / -1;
    border-color: var(--color-focus);
    box-shadow: 0 0 0 1px var(--color-focus), 0 10px 30px rgba(0, 0, 0, 0.12);
}

.service-card.highlighted {
    box-shadow: 0 0 0 1px var(--color-focus), 0 0 0 8px rgba(137, 174, 207, 0.08);
}

.card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 20px;
    cursor: pointer;
    gap: 12px;
    transition: background 0.15s;
}

.card-header:hover {
    background: var(--color-surface-hover);
}

.card-body {
    flex: 1;
    min-width: 0;
}

.card-name-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
}

.card-name {
    font-weight: 600;
    font-size: 18px;
    line-height: 1.3;
    color: var(--color-text);
}

.card-state {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 84px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    flex-shrink: 0;
}

.card-description {
    color: var(--color-text-muted);
    font-size: 13px;
    line-height: 1.6;
    margin-bottom: 14px;
}

.card-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
}

.probe-count {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
}

.meta-sep {
    color: var(--color-text-subtle);
}

.monitor-count {
    color: var(--color-text-muted);
}

.card-status {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding-top: 2px;
}

.status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
}

.status-up {
    background: rgba(167, 196, 173, 0.14);
    color: var(--color-status-up);
}

.status-down {
    background: rgba(230, 126, 128, 0.14);
    color: var(--color-status-down);
}

.status-degraded {
    background: rgba(242, 193, 141, 0.14);
    color: var(--color-status-degraded);
}

.status-unknown {
    background: rgba(107, 112, 116, 0.14);
    color: var(--color-status-unknown);
}

.chevron {
    color: var(--color-text-muted);
    font-size: 13px;
    transition: transform 0.25s ease;
    display: inline-block;
}

.chevron.open {
    transform: rotate(180deg);
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

    .services {
        grid-template-columns: 1fr;
    }

    .service-card.expanded {
        grid-column: 1;
    }

    .card-header {
        padding: 16px;
    }

    .card-name-row {
        align-items: flex-start;
        flex-direction: column;
    }

    .theme-toggle {
        top: 0;
        right: 0;
        padding: 4px 8px;
        font-size: 16px;
    }
}
</style>
