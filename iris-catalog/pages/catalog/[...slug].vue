<template>
    <div class="catalog-layout">
        <!-- Left panel: Service tree navigation -->
        <aside class="panel panel-left">
            <div class="panel-top">
                <NuxtLink to="/" class="back-link">&larr; Home</NuxtLink>
            </div>
            <ServiceTree
                :tree="tree"
                :loading="loading"
                :selected-id="selectedId"
                :status="status"
                :is-collapsed="isCollapsed"
                @select="selectMonitor"
            />
        </aside>

        <!-- Middle panel: Documentation content -->
        <main class="panel panel-center">
            <DocContent :monitor="selectedMonitor" />
        </main>

        <!-- Right panel: Live monitor status -->
        <aside class="panel panel-right">
            <MonitorStatus
                :monitors="rightPanelMonitors"
                :status="status"
            />
        </aside>
    </div>
</template>

<script setup lang="ts">
import type { MonitorData } from "~/server/utils/kuma-state";

const route = useRoute();
const router = useRouter();
const { monitors, loading } = useMonitors();
const { tree, isCollapsed } = useMonitorTree(monitors);
const { status } = useStatus();

// Selected monitor ID from route
const selectedId = computed<number | null>(() => {
    const slugParts = route.params.slug;
    if (Array.isArray(slugParts) && slugParts.length > 0) {
        const id = parseInt(slugParts[slugParts.length - 1]);
        return isNaN(id) ? null : id;
    }
    return null;
});

// The currently selected monitor data
const selectedMonitor = computed<MonitorData | null>(() => {
    if (!selectedId.value) {
        return null;
    }
    return monitors.value[String(selectedId.value)] || null;
});

// Monitors to show in the right panel (children of selected, or the selected itself)
const rightPanelMonitors = computed<MonitorData[]>(() => {
    const selected = selectedMonitor.value;
    if (!selected) {
        return [];
    }

    // If it's a group, show its children
    if (selected.type === "group" && selected.childrenIDs?.length > 0) {
        return selected.childrenIDs
            .map(id => monitors.value[String(id)])
            .filter(Boolean)
            .sort((a, b) => (a.weight ?? 2000) - (b.weight ?? 2000));
    }

    // Otherwise show the monitor itself + siblings under same parent
    if (selected.parent) {
        const parent = monitors.value[String(selected.parent)];
        if (parent?.childrenIDs?.length > 0) {
            return parent.childrenIDs
                .map(id => monitors.value[String(id)])
                .filter(Boolean)
                .sort((a, b) => (a.weight ?? 2000) - (b.weight ?? 2000));
        }
    }

    return [selected];
});

/**
 * Navigate to a monitor's catalog page
 * @param id - monitor ID
 */
function selectMonitor(id: number) {
    router.push(`/catalog/${id}`);
}
</script>

<style scoped>
.catalog-layout {
    display: grid;
    grid-template-columns: 280px 1fr 300px;
    height: 100vh;
    overflow: hidden;
}

.panel {
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

.panel-left {
    border-right: 1px solid #e5e7eb;
    background: #fafafa;
}

.panel-center {
    overflow-y: auto;
}

.panel-right {
    border-left: 1px solid #e5e7eb;
    background: #fafafa;
}

.panel-top {
    padding: 12px 16px;
    border-bottom: 1px solid #e5e7eb;
}

.back-link {
    font-size: 13px;
    color: #6b7280;
    text-decoration: none;
}

.back-link:hover {
    color: #3b82f6;
}

/* Responsive: collapse to single column on small screens */
@media (max-width: 1024px) {
    .catalog-layout {
        grid-template-columns: 1fr;
        height: auto;
    }

    .panel-left, .panel-right {
        display: none;
    }
}
</style>
