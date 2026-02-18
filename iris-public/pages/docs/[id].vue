<template>
    <div class="catalog-layout">
        <!-- Mobile top bar (visible only on small screens) -->
        <div class="mobile-bar">
            <button class="mobile-btn" @click="showTree = true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
            </button>
            <NuxtLink to="/" class="mobile-title">Iris</NuxtLink>
            <button class="mobile-btn" @click="showStatus = true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            </button>
        </div>

        <!-- Overlay (mobile drawers) -->
        <div class="drawer-overlay" v-if="showTree || showStatus" @click="showTree = false; showStatus = false"></div>

        <!-- Left panel: Service tree navigation -->
        <aside class="panel panel-left" :class="{ 'drawer-open': showTree }">
            <div class="panel-top">
                <NuxtLink to="/docs" class="back-link">&larr; Docs</NuxtLink>
            </div>
            <ServiceTree
                :tree="tree"
                :loading="loading"
                :selected-id="selectedId"
                :status="status"
                :is-collapsed="isCollapsed"
                @select="selectMonitorMobile"
            />
        </aside>

        <!-- Middle panel: Documentation content -->
        <main class="panel panel-center">
            <DocContent :monitor="selectedMonitor" :monitors="monitors" />
        </main>

        <!-- Right panel: Live monitor status -->
        <aside class="panel panel-right" :class="{ 'drawer-open': showStatus }">
            <MonitorStatus
                :monitors="rightPanelMonitors"
                :status="status"
                :last-updated="lastUpdated"
            />
        </aside>
    </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: "docs" });

import type { MonitorData } from "~/server/utils/kuma-state";

const route = useRoute();
const router = useRouter();
const { monitors, loading } = useMonitors();
const { status, lastUpdated } = useStatus();

// Selected monitor ID from route
const selectedId = computed<number | null>(() => {
    const id = parseInt(route.params.id as string);
    return isNaN(id) ? null : id;
});

// Pass selectedId so the tree auto-expands only the focused service path
const { tree, isCollapsed } = useMonitorTree(monitors, selectedId);

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

// Mobile drawer state
const showTree = ref(false);
const showStatus = ref(false);

/**
 * Navigate to a monitor's catalog page
 * @param id - monitor ID
 */
function selectMonitor(id: number) {
    router.push(`/docs/${id}`);
}

/**
 * Navigate and close the mobile tree drawer
 * @param id - monitor ID
 */
function selectMonitorMobile(id: number) {
    showTree.value = false;
    router.push(`/docs/${id}`);
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
    border-right: 1px solid var(--bg2);
    background: var(--bg0);
}

.panel-center {
    overflow-y: auto;
    background: var(--bg-dim);
}

.panel-right {
    border-left: 1px solid var(--bg2);
    background: var(--bg0);
}

.panel-top {
    padding: 12px 16px;
    border-bottom: 1px solid var(--bg2);
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--bg0);
}

.back-link {
    font-size: 13px;
    color: var(--grey1);
    text-decoration: none;
}

.back-link:hover {
    color: var(--green);
}

/* Mobile top bar (hidden on desktop) */
.mobile-bar {
    display: none;
}

.drawer-overlay {
    display: none;
}

/* Responsive: slide-in drawers on small screens */
@media (max-width: 1024px) {
    .catalog-layout {
        grid-template-columns: 1fr;
        height: 100vh;
    }

    .mobile-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        background: var(--bg0);
        border-bottom: 1px solid var(--bg2);
    }

    .mobile-btn {
        background: none;
        border: none;
        color: var(--grey1);
        cursor: pointer;
        padding: 6px;
        border-radius: 6px;
    }

    .mobile-btn:hover {
        color: var(--fg);
        background: var(--bg1);
    }

    .mobile-title {
        font-size: 14px;
        font-weight: 700;
        color: var(--fg);
        text-decoration: none;
    }

    .drawer-overlay {
        display: block;
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 49;
    }

    .panel-left, .panel-right {
        position: fixed;
        top: 0;
        bottom: 0;
        width: 280px;
        z-index: 50;
        transition: transform 0.25s ease;
    }

    .panel-left {
        left: 0;
        transform: translateX(-100%);
    }

    .panel-left.drawer-open {
        transform: translateX(0);
    }

    .panel-right {
        right: 0;
        width: 300px;
        transform: translateX(100%);
    }

    .panel-right.drawer-open {
        transform: translateX(0);
    }
}
</style>
