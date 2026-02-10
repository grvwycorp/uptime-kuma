<template>
    <nav class="service-tree">
        <div class="tree-header">Services</div>
        <div v-if="loading" class="tree-loading">Loading...</div>
        <div v-else-if="tree.length === 0" class="tree-empty">No monitors found</div>
        <TreeNodeItem
            v-for="node in tree"
            :key="node.monitor.id"
            :node="node"
            :depth="0"
            :selected-id="selectedId"
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

defineProps<{
    tree: TreeNode[];
    loading: boolean;
    selectedId: number | null;
    status: Record<string, MonitorStatus>;
    isCollapsed: (id: number) => boolean;
}>();

defineEmits<{
    select: [id: number];
}>();

const { toggle } = useMonitorTree(useState("monitors", () => ({})));
</script>

<style scoped>
.service-tree {
    height: 100%;
    overflow-y: auto;
    padding: 12px 0;
}

.tree-header {
    padding: 0 16px 12px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--grey0);
}

.tree-loading, .tree-empty {
    padding: 16px;
    color: var(--grey1);
    font-size: 13px;
}
</style>
