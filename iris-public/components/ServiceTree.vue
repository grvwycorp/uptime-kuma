<template>
    <nav class="service-tree" tabindex="0" @keydown="onKeydown">
        <div class="tree-header">Services</div>
        <div class="tree-search">
            <input
                v-model="searchQuery"
                type="text"
                class="search-input"
                placeholder="Filter services..."
            />
            <button
                v-if="searchQuery"
                class="search-clear"
                @click="searchQuery = ''"
            >&times;</button>
        </div>
        <div v-if="loading" class="tree-skeleton">
            <div v-for="i in 5" :key="i" class="skeleton-row">
                <div class="skeleton" :style="{ width: (50 + Math.random() * 40) + '%', height: '12px' }"></div>
            </div>
        </div>
        <div v-else-if="tree.length === 0 && !searchQuery" class="tree-empty">No monitors found</div>
        <div v-else-if="tree.length === 0 && searchQuery" class="tree-empty">No matches</div>
        <TreeNodeItem
            v-for="node in tree"
            :key="node.monitor.id"
            :node="node"
            :depth="0"
            :selected-id="selectedId"
            :focused-id="focusedId"
            :status="status"
            :is-collapsed="isCollapsed"
            @select="(id: number) => $emit('select', id)"
            @toggle="toggle"
        />
    </nav>
</template>

<script setup lang="ts">
import type { TreeNode } from "~/composables/useMonitorTree";
import type { MonitorStatus } from "~/server/utils/prom-client";

const props = defineProps<{
    tree: TreeNode[];
    loading: boolean;
    selectedId: number | null;
    status: Record<string, MonitorStatus>;
    isCollapsed: (id: number) => boolean;
}>();

const emit = defineEmits<{
    select: [id: number];
}>();

const { toggle, searchQuery } = useMonitorTree(useState("monitors", () => ({})));
const focusedId = ref<number | null>(null);

/**
 * Build a flat list of visible node IDs (respecting collapsed groups)
 * @param nodes - tree nodes
 * @returns array of monitor IDs in display order
 */
function getVisibleIds(nodes: TreeNode[]): number[] {
    const ids: number[] = [];
    for (const node of nodes) {
        ids.push(node.monitor.id);
        if (node.monitor.type === "group" && !props.isCollapsed(node.monitor.id)) {
            ids.push(...getVisibleIds(node.children));
        }
    }
    return ids;
}

/**
 * Handle keyboard navigation in the tree
 * @param e - keyboard event
 */
function onKeydown(e: KeyboardEvent) {
    // Skip if focus is in the search input
    if ((e.target as HTMLElement)?.tagName === "INPUT") {
        return;
    }

    const visibleIds = getVisibleIds(props.tree);
    if (visibleIds.length === 0) {
        return;
    }

    const currentIdx = focusedId.value !== null ? visibleIds.indexOf(focusedId.value) : -1;

    if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = currentIdx < visibleIds.length - 1 ? currentIdx + 1 : 0;
        focusedId.value = visibleIds[next];
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = currentIdx > 0 ? currentIdx - 1 : visibleIds.length - 1;
        focusedId.value = visibleIds[prev];
    } else if (e.key === "ArrowRight" && focusedId.value !== null) {
        e.preventDefault();
        // Expand group if collapsed
        if (props.isCollapsed(focusedId.value)) {
            toggle(focusedId.value);
        }
    } else if (e.key === "ArrowLeft" && focusedId.value !== null) {
        e.preventDefault();
        // Collapse group if expanded, otherwise move to parent
        if (!props.isCollapsed(focusedId.value)) {
            toggle(focusedId.value);
        }
    } else if (e.key === "Enter" && focusedId.value !== null) {
        e.preventDefault();
        emit("select", focusedId.value);
    }
}
</script>

<style scoped>
.service-tree {
    height: 100%;
    overflow-y: auto;
    padding: 12px 0;
    outline: none;
}

.tree-header {
    padding: 0 16px 4px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--grey0);
}

.tree-search {
    position: relative;
    padding: 0 12px 8px;
}

.search-input {
    width: 100%;
    padding: 6px 28px 6px 10px;
    font-size: 12px;
    color: var(--fg);
    background: var(--bg1);
    border: 1px solid var(--bg3);
    border-radius: 6px;
    outline: none;
    transition: border-color 0.15s;
}

.search-input::placeholder {
    color: var(--grey0);
}

.search-input:focus {
    border-color: var(--green);
}

.search-clear {
    position: absolute;
    right: 18px;
    top: 50%;
    transform: translateY(calc(-50% - 4px));
    background: none;
    border: none;
    color: var(--grey1);
    font-size: 16px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
}

.search-clear:hover {
    color: var(--fg);
}

.tree-empty {
    padding: 16px;
    color: var(--grey1);
    font-size: 13px;
}

.tree-skeleton {
    padding: 8px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.skeleton-row {
    padding: 4px 0;
}
</style>
