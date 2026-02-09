/**
 * Composable: builds a collapsible tree structure from a flat monitor list.
 * Groups (type="group") become tree nodes, other monitors are leaves.
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

export function useMonitorTree(monitors: Ref<Record<string, MonitorData>>) {
    const tree = computed(() => buildTree(monitors.value));
    const collapsed = useState<Record<number, boolean>>("tree-collapsed", () => ({}));

    /**
     * Toggle collapse state for a tree node
     * @param id - monitor ID to toggle
     */
    function toggle(id: number) {
        collapsed.value = { ...collapsed.value, [id]: !collapsed.value[id] };
    }

    /**
     * Check if a node is collapsed
     * @param id - monitor ID
     * @returns true if collapsed
     */
    function isCollapsed(id: number): boolean {
        return !!collapsed.value[id];
    }

    return { tree, toggle, isCollapsed };
}
