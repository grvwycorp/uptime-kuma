/**
 * Composable: builds a collapsible tree structure from a flat monitor list.
 * Groups (type="group") become tree nodes, other monitors are leaves.
 *
 * All groups default to collapsed. When a selectedId is provided,
 * only the ancestor path to that monitor is auto-expanded.
 */
import type { MonitorData } from "~/server/utils/kuma-state";

export interface TreeNode {
    monitor: MonitorData;
    children: TreeNode[];
}

/**
 * Build tree from flat monitor map
 * @param monitors - flat map of monitors keyed by ID
 * @returns array of root-level tree nodes
 */
function buildTree(monitors: Record<string, MonitorData>): TreeNode[] {
    const list = Object.values(monitors);
    const nodeMap = new Map<number, TreeNode>();

    // Create nodes
    for (const m of list) {
        nodeMap.set(m.id, { monitor: m, children: [] });
    }

    // Link children to parents
    const roots: TreeNode[] = [];
    for (const m of list) {
        const node = nodeMap.get(m.id)!;
        if (m.parent && nodeMap.has(m.parent)) {
            nodeMap.get(m.parent)!.children.push(node);
        } else {
            roots.push(node);
        }
    }

    // Sort children by weight (lower = higher priority) then by name
    const sortNodes = (nodes: TreeNode[]) => {
        nodes.sort((a, b) => {
            const wDiff = (a.monitor.weight ?? 2000) - (b.monitor.weight ?? 2000);
            if (wDiff !== 0) {
                return wDiff;
            }
            return a.monitor.name.localeCompare(b.monitor.name);
        });
        for (const n of nodes) {
            sortNodes(n.children);
        }
    };
    sortNodes(roots);

    return roots;
}

/**
 * Walk up the parent chain and collect all group ancestor IDs.
 * If the selected monitor is itself a group, it is included.
 * @param id - selected monitor ID
 * @param monitors - flat monitor map
 * @returns array of group IDs in the ancestor path
 */
function getAncestorGroupIds(id: number, monitors: Record<string, MonitorData>): number[] {
    const groupIds: number[] = [];
    let current = monitors[String(id)];

    // If the selected item is a group, expand it
    if (current?.type === "group") {
        groupIds.push(current.id);
    }

    // Walk up the parent chain
    while (current?.parent) {
        current = monitors[String(current.parent)];
        if (current?.type === "group") {
            groupIds.push(current.id);
        }
    }

    return groupIds;
}

/**
 * Filter a tree to only include nodes matching the query (and their ancestors).
 * Returns a deep-cloned subtree so the original is not mutated.
 * @param nodes - tree nodes to filter
 * @param query - lowercase search string
 * @returns filtered tree (or original if query is empty)
 */
function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
    if (!query) {
        return nodes;
    }
    const result: TreeNode[] = [];
    for (const node of nodes) {
        const nameMatch = node.monitor.name.toLowerCase().includes(query);
        const filteredChildren = filterTree(node.children, query);
        if (nameMatch || filteredChildren.length > 0) {
            result.push({
                monitor: node.monitor,
                children: filteredChildren,
            });
        }
    }
    return result;
}

/**
 * Collect all group IDs from a tree (used to auto-expand during search)
 * @param nodes - tree nodes to scan
 * @returns set of group IDs
 */
function collectGroupIds(nodes: TreeNode[]): Set<number> {
    const ids = new Set<number>();
    for (const node of nodes) {
        if (node.monitor.type === "group") {
            ids.add(node.monitor.id);
        }
        for (const id of collectGroupIds(node.children)) {
            ids.add(id);
        }
    }
    return ids;
}

/**
 * @param monitors - reactive flat monitor map
 * @param selectedId - optional reactive selected monitor ID; when provided,
 *   auto-expands the ancestor path and collapses everything else on change
 */
const STORAGE_KEY = "iris-tree-expanded";

export function useMonitorTree(monitors: Ref<Record<string, MonitorData>>, selectedId?: Ref<number | null>) {
    const fullTree = computed(() => buildTree(monitors.value));
    const searchQuery = useState<string>("tree-search", () => "");

    // Restore from sessionStorage on client
    const initial: Record<number, boolean> = {};
    if (import.meta.client) {
        try {
            const saved = sessionStorage.getItem(STORAGE_KEY);
            if (saved) {
                Object.assign(initial, JSON.parse(saved));
            }
        } catch { /* ignore parse errors */ }
    }
    const expanded = useState<Record<number, boolean>>("tree-expanded", () => initial);

    // Persist to sessionStorage on change
    if (import.meta.client) {
        watch(expanded, (val) => {
            try {
                sessionStorage.setItem(STORAGE_KEY, JSON.stringify(val));
            } catch { /* storage full or unavailable */ }
        }, { deep: true });
    }

    const tree = computed(() => {
        const q = searchQuery.value.trim().toLowerCase();
        return filterTree(fullTree.value, q);
    });

    // When searching, auto-expand all matching groups
    watch(searchQuery, (q) => {
        const trimmed = q.trim().toLowerCase();
        if (!trimmed) {
            return;
        }
        const filtered = filterTree(fullTree.value, trimmed);
        const groupIds = collectGroupIds(filtered);
        const newExpanded: Record<number, boolean> = { ...expanded.value };
        for (const gid of groupIds) {
            newExpanded[gid] = true;
        }
        expanded.value = newExpanded;
    });

    // When selectedId changes, auto-expand only the ancestor path
    if (selectedId) {
        watch(selectedId, (id) => {
            if (!id) {
                return;
            }
            const ancestors = getAncestorGroupIds(id, monitors.value);
            const newExpanded: Record<number, boolean> = {};
            for (const gid of ancestors) {
                newExpanded[gid] = true;
            }
            expanded.value = newExpanded;
        }, { immediate: true });
    }

    /**
     * Toggle expand/collapse state for a tree node
     * @param id - monitor ID to toggle
     */
    function toggle(id: number) {
        expanded.value = { ...expanded.value, [id]: !expanded.value[id] };
    }

    /**
     * Check if a node is collapsed (default: collapsed)
     * @param id - monitor ID
     * @returns true if collapsed
     */
    function isCollapsed(id: number): boolean {
        return !expanded.value[id];
    }

    return { tree, toggle, isCollapsed, searchQuery };
}
