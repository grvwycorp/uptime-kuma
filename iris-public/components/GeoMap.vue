<script setup lang="ts">
interface Target {
    lat: number;
    lon: number;
    country: string;
    city: string;
    asn: string;
    ip: string;
    monitorName: string;
    status: "up" | "down" | "degraded" | "unknown";
}

const props = defineProps<{
    targets: Target[];
}>();

const { resolved } = useColorMode();

const mapContainer = ref<HTMLElement | null>(null);
let map: any = null;
let tileLayer: any = null;
let markerGroup: any = null;
let L: any = null;

const TILES_DARK = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILES_LIGHT = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const TILES_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

const STATUS_COLORS: Record<string, string> = {
    up: "#A7C4AD",
    down: "#E67E80",
    degraded: "#F2C18D",
    unknown: "#6B7074",
};

function statusColor(status: string): string {
    return STATUS_COLORS[status] || STATUS_COLORS.unknown;
}

function addMarkers() {
    if (!map || !L || !markerGroup) {
        return;
    }
    markerGroup.clearLayers();
    for (const t of props.targets) {
        const marker = L.circleMarker([t.lat, t.lon], {
            radius: 6,
            fillColor: statusColor(t.status),
            fillOpacity: 0.85,
            color: resolved.value === "dark" ? "#1A1C1E" : "#FFFFFF",
            weight: 2,
        });
        const location = [t.city, t.country].filter(Boolean).join(", ");
        marker.bindTooltip(
            `<strong>${t.monitorName}</strong><br>${location}<br>${t.asn}<br><code>${t.ip}</code>`,
            { className: "iris-map-tooltip" },
        );
        markerGroup.addLayer(marker);
    }
}

onMounted(async () => {
    const leaflet = await import("leaflet");
    await import("leaflet/dist/leaflet.css");
    L = leaflet.default || leaflet;

    if (!mapContainer.value) {
        return;
    }

    map = L.map(mapContainer.value, {
        scrollWheelZoom: false,
        zoomControl: true,
        attributionControl: true,
    }).setView([59, 18], 5);

    tileLayer = L.tileLayer(
        resolved.value === "dark" ? TILES_DARK : TILES_LIGHT,
        { attribution: TILES_ATTR, maxZoom: 18 },
    ).addTo(map);

    markerGroup = L.layerGroup().addTo(map);
    addMarkers();
});

watch(() => props.targets, () => {
    addMarkers();
}, { deep: true });

watch(resolved, (theme) => {
    if (!map || !L || !tileLayer) {
        return;
    }
    const url = theme === "dark" ? TILES_DARK : TILES_LIGHT;
    tileLayer.setUrl(url);
});

onUnmounted(() => {
    if (map) {
        map.remove();
        map = null;
    }
});
</script>

<template>
    <div class="geo-map-wrapper">
        <div ref="mapContainer" class="geo-map" />
    </div>
</template>

<style scoped>
.geo-map-wrapper {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    overflow: hidden;
    margin-bottom: 32px;
}

.geo-map {
    height: 300px;
    width: 100%;
}

@media (max-width: 640px) {
    .geo-map {
        height: 200px;
    }

    .geo-map-wrapper {
        margin-bottom: 24px;
    }
}
</style>

<style>
/* Tooltip styling — must be unscoped to affect Leaflet DOM */
.iris-map-tooltip {
    background: var(--color-surface-elevated, #2E3235) !important;
    color: var(--color-text, #E2E2E6) !important;
    border: 1px solid var(--color-border, #3A3E42) !important;
    border-radius: 6px !important;
    padding: 8px 10px !important;
    font-size: 13px !important;
    line-height: 1.5 !important;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25) !important;
}

.iris-map-tooltip::before {
    border-top-color: var(--color-border, #3A3E42) !important;
}

.iris-map-tooltip code {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--color-text-muted, #9BA0A6);
}

.iris-map-tooltip strong {
    color: var(--color-accent, #89AECF);
}

/* Hide default Leaflet attribution background */
.geo-map-wrapper .leaflet-control-attribution {
    background: var(--color-surface, #24272A) !important;
    color: var(--color-text-subtle, #6B7074) !important;
    font-size: 10px !important;
}

.geo-map-wrapper .leaflet-control-attribution a {
    color: var(--color-text-muted, #9BA0A6) !important;
}

/* Zoom control styling */
.geo-map-wrapper .leaflet-control-zoom a {
    background: var(--color-surface, #24272A) !important;
    color: var(--color-text, #E2E2E6) !important;
    border-color: var(--color-border, #3A3E42) !important;
}

.geo-map-wrapper .leaflet-control-zoom a:hover {
    background: var(--color-surface-hover, #2E3235) !important;
}
</style>
