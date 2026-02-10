<template>
    <div class="tree-node">
        <div
            class="tree-item"
            :class="{ selected: selectedId === node.monitor.id, group: isGroup }"
            :style="{ paddingLeft: (depth * 16 + 16) + 'px' }"
            @click="$emit('select', node.monitor.id)"
        >
            <button
                v-if="isGroup && node.children.length > 0"
                class="toggle-btn"
                @click.stop="$emit('toggle', node.monitor.id)"
            >
                <span class="chevron" :class="{ collapsed: isCollapsed(node.monitor.id) }">&#9654;</span>
            </button>
            <span v-else class="toggle-spacer"></span>
            <span class="node-name">{{ node.monitor.name }}</span>
            <StatusBadge
                v-if="monitorStatus"
                :status="monitorStatus.aggregated"
                class="node-status"
            />
        </div>
        <div v-if="isGroup && !isCollapsed(node.monitor.id)">
            <TreeNodeItem
                v-for="child in node.children"
                :key="child.monitor.id"
                :node="child"
                :depth="depth + 1"
                :selected-id="selectedId"
                :status="status"
                :is-collapsed="isCollapsed"
                @select="(id: number) => $emit('select', id)"
                @toggle="(id: number) => $emit('toggle', id)"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import type { TreeNode } from "~/composables/useMonitorTree";
import type { MonitorStatus } from "~/server/utils/prom-client";

const props = defineProps<{
    node: TreeNode;
    depth: number;
    selectedId: number | null;
    status: Record<string, MonitorStatus>;
    isCollapsed: (id: number) => boolean;
}>();

defineEmits<{
    select: [id: number];
    toggle: [id: number];
}>();

const isGroup = computed(() => props.node.monitor.type === "group");

const monitorStatus = computed(() => {
    return props.status[String(props.node.monitor.id)];
});
</script>

<style scoped>
.tree-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 13px;
    border-left: 3px solid transparent;
    transition: background 0.1s;
}

.tree-item:hover {
    background: var(--bg1);
}

.tree-item.selected {
    background: var(--bg3);
    border-left-color: var(--green);
}

.tree-item.group .node-name {
    font-weight: 600;
}

.toggle-btn {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    width: 16px;
    font-size: 9px;
    color: var(--grey0);
    flex-shrink: 0;
}

.chevron {
    display: inline-block;
    transition: transform 0.15s;
}

.chevron.collapsed {
    transform: rotate(0deg);
}

.chevron:not(.collapsed) {
    transform: rotate(90deg);
}

.toggle-spacer {
    width: 16px;
    flex-shrink: 0;
}

.node-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg);
}

.node-status {
    flex-shrink: 0;
}
</style>
