const { describe, test } = require("node:test");
const assert = require("node:assert");

/**
 * Since Monitor.buildMonitorTree requires a database connection,
 * we test the pure in-memory tree methods by constructing Maps directly.
 * These methods are the core of the performance optimization.
 */

// Import the Monitor class (path relative to test file)
// The static methods we test don't need DB so we can import directly.
const Monitor = require("../../server/model/monitor");

describe("Monitor Tree - getAllChildrenIDsFromTree", () => {
    test("returns empty array for monitor with no children", () => {
        const childrenMap = new Map([
            [1, []],
            [2, []],
        ]);
        const result = Monitor.getAllChildrenIDsFromTree(1, childrenMap);
        assert.deepStrictEqual(result, []);
    });

    test("returns direct children for single-level nesting", () => {
        const childrenMap = new Map([
            [1, [2, 3]],
            [2, []],
            [3, []],
        ]);
        const result = Monitor.getAllChildrenIDsFromTree(1, childrenMap);
        result.sort((a, b) => a - b);
        assert.deepStrictEqual(result, [2, 3]);
    });

    test("returns all descendants for 3-level nesting", () => {
        // Tree: 1 -> [2, 3], 2 -> [4, 5], 3 -> [6]
        const childrenMap = new Map([
            [1, [2, 3]],
            [2, [4, 5]],
            [3, [6]],
            [4, []],
            [5, []],
            [6, []],
        ]);
        const result = Monitor.getAllChildrenIDsFromTree(1, childrenMap);
        result.sort((a, b) => a - b);
        assert.deepStrictEqual(result, [2, 3, 4, 5, 6]);
    });

    test("returns only subtree descendants, not siblings", () => {
        // Tree: 1 -> [2, 3], 2 -> [4]
        const childrenMap = new Map([
            [1, [2, 3]],
            [2, [4]],
            [3, []],
            [4, []],
        ]);
        const result = Monitor.getAllChildrenIDsFromTree(2, childrenMap);
        assert.deepStrictEqual(result, [4]);
    });

    test("handles monitor ID not in map", () => {
        const childrenMap = new Map();
        const result = Monitor.getAllChildrenIDsFromTree(999, childrenMap);
        assert.deepStrictEqual(result, []);
    });
});

describe("Monitor Tree - getPathFromTree", () => {
    test("returns single-element path for root monitor", () => {
        const parentMap = new Map([[1, null]]);
        const nameMap = new Map([[1, "Root"]]);
        const result = Monitor.getPathFromTree(1, parentMap, nameMap);
        assert.deepStrictEqual(result, ["Root"]);
    });

    test("returns two-element path for single-level nesting", () => {
        const parentMap = new Map([
            [1, null],
            [2, 1],
        ]);
        const nameMap = new Map([
            [1, "Telia"],
            [2, "ns1.telia.se"],
        ]);
        const result = Monitor.getPathFromTree(2, parentMap, nameMap);
        assert.deepStrictEqual(result, ["Telia", "ns1.telia.se"]);
    });

    test("returns three-element path for 3-level nesting", () => {
        const parentMap = new Map([
            [1, null],
            [2, 1],
            [3, 2],
        ]);
        const nameMap = new Map([
            [1, "Telia"],
            [2, "Telia DNS"],
            [3, "ns1.telia.se"],
        ]);
        const result = Monitor.getPathFromTree(3, parentMap, nameMap);
        assert.deepStrictEqual(result, ["Telia", "Telia DNS", "ns1.telia.se"]);
    });
});

describe("Monitor Tree - isParentActiveFromTree", () => {
    test("returns true for root monitor (no parents)", () => {
        const parentMap = new Map([[1, null]]);
        const activeMap = new Map([[1, 1]]);
        const result = Monitor.isParentActiveFromTree(1, parentMap, activeMap);
        assert.strictEqual(result, true);
    });

    test("returns true when all ancestors are active", () => {
        const parentMap = new Map([
            [1, null],
            [2, 1],
            [3, 2],
        ]);
        const activeMap = new Map([
            [1, 1],
            [2, 1],
            [3, 1],
        ]);
        const result = Monitor.isParentActiveFromTree(3, parentMap, activeMap);
        assert.strictEqual(result, true);
    });

    test("returns false when immediate parent is inactive", () => {
        const parentMap = new Map([
            [1, null],
            [2, 1],
            [3, 2],
        ]);
        const activeMap = new Map([
            [1, 1],
            [2, 0], // inactive
            [3, 1],
        ]);
        const result = Monitor.isParentActiveFromTree(3, parentMap, activeMap);
        assert.strictEqual(result, false);
    });

    test("returns false when grandparent is inactive", () => {
        const parentMap = new Map([
            [1, null],
            [2, 1],
            [3, 2],
        ]);
        const activeMap = new Map([
            [1, 0], // inactive grandparent
            [2, 1],
            [3, 1],
        ]);
        const result = Monitor.isParentActiveFromTree(3, parentMap, activeMap);
        assert.strictEqual(result, false);
    });
});

describe("Monitor Tree - buildMonitorTree output structure", () => {
    test("tree methods work together for realistic scenario", () => {
        // Simulate: Telia(1) -> TeliaDS(2) -> ns1(3), ns2(4)
        //                     -> TeliaWeb(5) -> www(6)
        const parentMap = new Map([
            [1, null],
            [2, 1],
            [3, 2],
            [4, 2],
            [5, 1],
            [6, 5],
        ]);
        const childrenMap = new Map([
            [1, [2, 5]],
            [2, [3, 4]],
            [3, []],
            [4, []],
            [5, [6]],
            [6, []],
        ]);
        const nameMap = new Map([
            [1, "Telia"],
            [2, "Telia DNS"],
            [3, "ns1.telia.se"],
            [4, "ns2.telia.se"],
            [5, "Telia Websites"],
            [6, "www.telia.se"],
        ]);
        const activeMap = new Map([
            [1, 1],
            [2, 1],
            [3, 1],
            [4, 1],
            [5, 1],
            [6, 1],
        ]);

        // Test children of root
        const teliaChildren = Monitor.getAllChildrenIDsFromTree(1, childrenMap);
        teliaChildren.sort((a, b) => a - b);
        assert.deepStrictEqual(teliaChildren, [2, 3, 4, 5, 6]);

        // Test children of sub-group
        const dnsChildren = Monitor.getAllChildrenIDsFromTree(2, childrenMap);
        dnsChildren.sort((a, b) => a - b);
        assert.deepStrictEqual(dnsChildren, [3, 4]);

        // Test path for leaf monitor
        assert.deepStrictEqual(
            Monitor.getPathFromTree(3, parentMap, nameMap),
            ["Telia", "Telia DNS", "ns1.telia.se"]
        );

        // Test path for sub-group
        assert.deepStrictEqual(
            Monitor.getPathFromTree(2, parentMap, nameMap),
            ["Telia", "Telia DNS"]
        );

        // Test parent active status
        assert.strictEqual(Monitor.isParentActiveFromTree(3, parentMap, activeMap), true);
        assert.strictEqual(Monitor.isParentActiveFromTree(6, parentMap, activeMap), true);

        // Deactivate Telia DNS group
        activeMap.set(2, 0);
        assert.strictEqual(Monitor.isParentActiveFromTree(3, parentMap, activeMap), false);
        assert.strictEqual(Monitor.isParentActiveFromTree(4, parentMap, activeMap), false);
        // www.telia.se should still be active (different branch)
        assert.strictEqual(Monitor.isParentActiveFromTree(6, parentMap, activeMap), true);
    });
});
