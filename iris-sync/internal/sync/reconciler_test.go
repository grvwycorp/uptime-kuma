package sync

// WHAT: Unit tests for the reconciliation diff in reconciler.go.
// WHY:  ComputeSyncPlan() is the heart of iris-sync: it compares the Master's desired
//       monitor state against a Probe's current state (+ the persisted ID mapping and
//       its SHA256 content-hash cache) and emits the CREATE/UPDATE/DELETE plan that the
//       executor later applies. A bug here means a Probe silently drifts from the Master
//       — the exact failure mode iris-sync exists to prevent. These tests lock in the
//       diff semantics before Phase 2 puts the mutation boundary in code.
// CONTEXT FOR FUTURE LLMs: ComputeSyncPlan mutates the mapping it is given (it adopts
//       orphans and removes stale entries), so each test builds a fresh mapping. The
//       hash diff works like this: master monitor's ComputeHash() is compared to the
//       hash stored in the mapping for that master ID — mismatch (or missing) => UPDATE.

import (
	"testing"

	"iris-sync/internal/db"
)

func newReconciler(deleteOrphans bool) *Reconciler {
	return NewReconciler(quietLogger(), deleteOrphans, 0)
}

// TestComputeSyncPlan_CreateNewMonitor: a master monitor with no mapping entry and no
// name collision on the probe must produce exactly one CREATE.
func TestComputeSyncPlan_CreateNewMonitor(t *testing.T) {
	master := monitorMap(httpMonitor(1, "Digg portal", "https://www.digg.se"))
	probe := monitorMap() // probe is empty
	mapping := NewIDMapping()

	plans := newReconciler(false).ComputeSyncPlan(master, probe, mapping)

	byAction := planByAction(plans)
	if len(byAction[ActionCreate]) != 1 {
		t.Fatalf("expected 1 create, got %d (total plans %d)", len(byAction[ActionCreate]), len(plans))
	}
	if len(byAction[ActionUpdate]) != 0 || len(byAction[ActionDelete]) != 0 {
		t.Fatalf("expected only a create, got %+v", plans)
	}
	create := byAction[ActionCreate][0]
	if create.MasterID != 1 {
		t.Errorf("create master id = %d, want 1", create.MasterID)
	}
	if create.Monitor == nil || create.Monitor.Name != "Digg portal" {
		t.Errorf("create carries wrong monitor: %+v", create.Monitor)
	}
	// The reconciler must stamp the content hash onto the master monitor for later caching.
	if create.Monitor.ContentHash == "" {
		t.Error("expected ContentHash to be computed and set on the create monitor")
	}
}

// TestComputeSyncPlan_NoChangeIsSkipped: a mapped monitor whose stored hash matches its
// current hash must produce NO plan (the common steady-state case).
func TestComputeSyncPlan_NoChangeIsSkipped(t *testing.T) {
	mon := httpMonitor(1, "Skatteverket", "https://www.skatteverket.se")
	master := monitorMap(mon)
	// Probe has the monitor under a different local id (42), as in real deployments.
	probe := monitorMap(httpMonitor(42, "Skatteverket", "https://www.skatteverket.se"))

	mapping := NewIDMapping()
	mapping.SetMapping(1, 42)
	mapping.SetHash(1, mon.ComputeHash()) // stored hash == current hash => no drift

	plans := newReconciler(true).ComputeSyncPlan(master, probe, mapping)

	if len(plans) != 0 {
		t.Fatalf("expected no plans for unchanged monitor, got %d: %+v", len(plans), plans)
	}
}

// TestComputeSyncPlan_ConfigChangeProducesUpdate: when the master config changes the
// hash diverges from the stored hash => UPDATE carrying the probe-local ID.
func TestComputeSyncPlan_ConfigChangeProducesUpdate(t *testing.T) {
	mon := httpMonitor(1, "Bolagsverket", "https://bolagsverket.se")
	master := monitorMap(mon)
	probe := monitorMap(httpMonitor(99, "Bolagsverket", "https://bolagsverket.se"))

	mapping := NewIDMapping()
	mapping.SetMapping(1, 99)
	// Stored hash from a previous, different config (interval was 300, now 60).
	stale := httpMonitor(1, "Bolagsverket", "https://bolagsverket.se")
	stale.Interval = 300
	mapping.SetHash(1, stale.ComputeHash())

	plans := newReconciler(true).ComputeSyncPlan(master, probe, mapping)

	byAction := planByAction(plans)
	if len(byAction[ActionUpdate]) != 1 {
		t.Fatalf("expected 1 update, got %d: %+v", len(byAction[ActionUpdate]), plans)
	}
	update := byAction[ActionUpdate][0]
	if update.ProbeID != 99 {
		t.Errorf("update ProbeID = %d, want 99", update.ProbeID)
	}
	// The monitor handed to the executor must carry the PROBE id, not the master id,
	// otherwise editMonitor on the probe would target the wrong row.
	if update.Monitor.ID != 99 {
		t.Errorf("update monitor.ID = %d, want probe-local 99", update.Monitor.ID)
	}
	if update.MasterID != 1 {
		t.Errorf("update MasterID = %d, want 1", update.MasterID)
	}
}

// TestComputeSyncPlan_MissingHashForcesUpdate: a mapping entry exists but has no cached
// hash (e.g. freshly adopted) — the reconciler must treat it as drift and UPDATE.
func TestComputeSyncPlan_MissingHashForcesUpdate(t *testing.T) {
	mon := httpMonitor(1, "1177", "https://www.1177.se")
	master := monitorMap(mon)
	probe := monitorMap(httpMonitor(7, "1177", "https://www.1177.se"))

	mapping := NewIDMapping()
	mapping.SetMapping(1, 7) // mapping but no SetHash => GetHash returns false

	plans := newReconciler(false).ComputeSyncPlan(master, probe, mapping)

	byAction := planByAction(plans)
	if len(byAction[ActionUpdate]) != 1 {
		t.Fatalf("expected 1 update when hash is missing, got %+v", plans)
	}
}

// TestComputeSyncPlan_MonitorMissingFromProbeIsRecreated: the mapping points at a probe
// id that no longer exists on the probe (manual deletion) => recreate + drop the mapping.
func TestComputeSyncPlan_MonitorMissingFromProbeIsRecreated(t *testing.T) {
	mon := httpMonitor(1, "Forsakringskassan", "https://www.forsakringskassan.se")
	master := monitorMap(mon)
	probe := monitorMap() // probe lost the monitor

	mapping := NewIDMapping()
	mapping.SetMapping(1, 55)
	mapping.SetHash(1, mon.ComputeHash())

	plans := newReconciler(false).ComputeSyncPlan(master, probe, mapping)

	byAction := planByAction(plans)
	if len(byAction[ActionCreate]) != 1 {
		t.Fatalf("expected 1 recreate, got %+v", plans)
	}
	if byAction[ActionCreate][0].Reason != "monitor missing from probe, recreating" {
		t.Errorf("unexpected reason: %q", byAction[ActionCreate][0].Reason)
	}
	// Stale mapping must have been removed so the create can re-register a fresh probe id.
	if _, ok := mapping.GetProbeID(1); ok {
		t.Error("expected stale mapping entry to be removed before recreate")
	}
}

// TestComputeSyncPlan_AdoptsOrphanByName: no mapping entry exists, but the probe already
// has a monitor with the same name (mapping file lost). The reconciler must ADOPT it
// (UPDATE, not CREATE) to avoid creating a duplicate, and record the new mapping.
func TestComputeSyncPlan_AdoptsOrphanByName(t *testing.T) {
	mon := httpMonitor(1, "Riksbank", "https://www.riksbank.se")
	master := monitorMap(mon)
	probe := monitorMap(httpMonitor(88, "Riksbank", "https://www.riksbank.se"))

	mapping := NewIDMapping() // no entry for master id 1

	plans := newReconciler(false).ComputeSyncPlan(master, probe, mapping)

	byAction := planByAction(plans)
	if len(byAction[ActionCreate]) != 0 {
		t.Fatalf("orphan adoption must not CREATE a duplicate, got %+v", byAction[ActionCreate])
	}
	if len(byAction[ActionUpdate]) != 1 {
		t.Fatalf("expected 1 adopt-update, got %+v", plans)
	}
	adopt := byAction[ActionUpdate][0]
	if adopt.ProbeID != 88 || adopt.Monitor.ID != 88 {
		t.Errorf("adopt should target existing probe id 88, got probeID=%d monitor.ID=%d", adopt.ProbeID, adopt.Monitor.ID)
	}
	if got, ok := mapping.GetProbeID(1); !ok || got != 88 {
		t.Errorf("adoption must register mapping 1->88, got %d (ok=%v)", got, ok)
	}
}

// TestComputeSyncPlan_DeleteOrphanWhenEnabled: a mapping entry exists for a master id
// that is gone from the master. With deleteOrphans=true the reconciler emits a DELETE.
func TestComputeSyncPlan_DeleteOrphanWhenEnabled(t *testing.T) {
	master := monitorMap(httpMonitor(1, "Kept", "https://kept.example"))
	probe := monitorMap(
		httpMonitor(10, "Kept", "https://kept.example"),
		httpMonitor(20, "Removed", "https://removed.example"),
	)

	mapping := NewIDMapping()
	mapping.SetMapping(1, 10)
	mapping.SetHash(1, master[1].ComputeHash())
	mapping.SetMapping(2, 20) // master id 2 no longer in master => orphan
	mapping.SetHash(2, "whatever")

	plans := newReconciler(true).ComputeSyncPlan(master, probe, mapping)

	byAction := planByAction(plans)
	if len(byAction[ActionDelete]) != 1 {
		t.Fatalf("expected 1 delete, got %+v", plans)
	}
	del := byAction[ActionDelete][0]
	if del.MasterID != 2 || del.ProbeID != 20 {
		t.Errorf("delete should target master 2 / probe 20, got master=%d probe=%d", del.MasterID, del.ProbeID)
	}
}

// TestComputeSyncPlan_DeleteOrphanSuppressedWhenDisabled: the same orphan, with
// deleteOrphans=false, must NOT be deleted (safety default).
func TestComputeSyncPlan_DeleteOrphanSuppressedWhenDisabled(t *testing.T) {
	master := monitorMap(httpMonitor(1, "Kept", "https://kept.example"))
	probe := monitorMap(
		httpMonitor(10, "Kept", "https://kept.example"),
		httpMonitor(20, "Removed", "https://removed.example"),
	)

	mapping := NewIDMapping()
	mapping.SetMapping(1, 10)
	mapping.SetHash(1, master[1].ComputeHash())
	mapping.SetMapping(2, 20)
	mapping.SetHash(2, "whatever")

	plans := newReconciler(false).ComputeSyncPlan(master, probe, mapping)

	if got := planByAction(plans)[ActionDelete]; len(got) != 0 {
		t.Fatalf("deleteOrphans=false must suppress deletes, got %+v", got)
	}
}

// TestComputeSyncPlan_MixedFleet: a realistic single cycle with one create, one update,
// one unchanged (skip), and one orphan delete — proving the phases compose correctly.
func TestComputeSyncPlan_MixedFleet(t *testing.T) {
	unchanged := httpMonitor(1, "Unchanged", "https://a.example")
	changed := httpMonitor(2, "Changed", "https://b.example")
	created := httpMonitor(3, "Brand New", "https://c.example")

	master := monitorMap(unchanged, changed, created)
	probe := monitorMap(
		httpMonitor(101, "Unchanged", "https://a.example"),
		httpMonitor(102, "Changed", "https://b.example"),
		httpMonitor(103, "Stale Orphan", "https://orphan.example"),
	)

	mapping := NewIDMapping()
	mapping.SetMapping(1, 101)
	mapping.SetHash(1, unchanged.ComputeHash())
	mapping.SetMapping(2, 102)
	mapping.SetHash(2, "old-hash-before-change")
	mapping.SetMapping(4, 103) // master id 4 gone => orphan delete

	plans := newReconciler(true).ComputeSyncPlan(master, probe, mapping)
	byAction := planByAction(plans)

	if len(byAction[ActionCreate]) != 1 {
		t.Errorf("expected 1 create, got %d", len(byAction[ActionCreate]))
	}
	if len(byAction[ActionUpdate]) != 1 {
		t.Errorf("expected 1 update, got %d", len(byAction[ActionUpdate]))
	}
	if len(byAction[ActionDelete]) != 1 {
		t.Errorf("expected 1 delete, got %d", len(byAction[ActionDelete]))
	}
	if len(plans) != 3 {
		t.Errorf("expected exactly 3 plans (create+update+delete, unchanged skipped), got %d", len(plans))
	}
}

// --- ComputeHash diff behaviour (the basis of the UPDATE decision) ---

// TestComputeHash_StableAndIdentityIndependent: hashing is deterministic and ignores the
// probe-local ID, so the same config on master and probe yields the same hash.
func TestComputeHash_StableAndIdentityIndependent(t *testing.T) {
	a := httpMonitor(1, "Same", "https://same.example")
	b := httpMonitor(9999, "Same", "https://same.example") // different ID only

	if a.ComputeHash() != a.ComputeHash() {
		t.Error("ComputeHash is not deterministic")
	}
	if a.ComputeHash() != b.ComputeHash() {
		t.Error("ComputeHash must ignore the ID field (probe and master ids differ)")
	}
}

// TestComputeHash_DescriptionDoesNotAffectHash: Description is documentation-only and is
// excluded from the hash, so editing it alone must NOT trigger a sync UPDATE.
func TestComputeHash_DescriptionDoesNotAffectHash(t *testing.T) {
	a := httpMonitor(1, "Doc", "https://doc.example")
	b := httpMonitor(1, "Doc", "https://doc.example")
	b.Description = ns("a freshly written human description")

	if a.ComputeHash() != b.ComputeHash() {
		t.Error("Description must be excluded from the content hash")
	}
}

// TestComputeHash_ConfigFieldsAffectHash: each meaningful config change must alter the
// hash, so the reconciler detects the drift and schedules an UPDATE.
func TestComputeHash_ConfigFieldsAffectHash(t *testing.T) {
	base := httpMonitor(1, "Base", "https://base.example")
	baseHash := base.ComputeHash()

	mutations := map[string]func(*db.Monitor){
		"url":      func(m *db.Monitor) { m.URL = ns("https://changed.example") },
		"interval": func(m *db.Monitor) { m.Interval = 120 },
		"method":   func(m *db.Monitor) { m.Method = ns("POST") },
		"active":   func(m *db.Monitor) { m.Active = 0 },
		"parent":   func(m *db.Monitor) { m.Parent = ni(5) },
		"name":     func(m *db.Monitor) { m.Name = "Renamed" },
		"weight":   func(m *db.Monitor) { m.Weight = 7 },
	}

	for field, mutate := range mutations {
		mon := httpMonitor(1, "Base", "https://base.example")
		mutate(mon)
		if mon.ComputeHash() == baseHash {
			t.Errorf("changing %q did not change the content hash", field)
		}
	}
}

// --- topologicalSortCreates (parents must be created before their children) ---

// TestTopologicalSortCreates_ParentsBeforeChildren: a 3-level hierarchy supplied in
// reverse order must come out parent-first at every depth.
func TestTopologicalSortCreates_ParentsBeforeChildren(t *testing.T) {
	root := groupMonitor(1, "Root group")
	mid := withParent(groupMonitor(2, "Mid group"), 1)
	leaf := withParent(httpMonitor(3, "Leaf check", "https://leaf.example"), 2)

	// Deliberately reversed: leaf, mid, root.
	creates := []SyncPlan{
		{Action: ActionCreate, MasterID: 3, Monitor: leaf},
		{Action: ActionCreate, MasterID: 2, Monitor: mid},
		{Action: ActionCreate, MasterID: 1, Monitor: root},
	}

	sorted := newReconciler(false).topologicalSortCreates(creates)
	if len(sorted) != 3 {
		t.Fatalf("expected 3 sorted plans, got %d", len(sorted))
	}

	pos := map[int64]int{}
	for i, p := range sorted {
		pos[p.MasterID] = i
	}
	if !(pos[1] < pos[2] && pos[2] < pos[3]) {
		t.Errorf("expected order root(1) < mid(2) < leaf(3), got positions %+v", pos)
	}
}

// TestTopologicalSortCreates_ParentNotInBatch: a child whose parent already exists on the
// probe (not part of this create batch) is treated as a root and ordered without stalling.
func TestTopologicalSortCreates_ParentNotInBatch(t *testing.T) {
	child := withParent(httpMonitor(3, "Child", "https://child.example"), 99) // parent 99 not in batch
	creates := []SyncPlan{{Action: ActionCreate, MasterID: 3, Monitor: child}}

	sorted := newReconciler(false).topologicalSortCreates(creates)
	if len(sorted) != 1 || sorted[0].MasterID != 3 {
		t.Fatalf("child with external parent should still be emitted, got %+v", sorted)
	}
}

// TestTopologicalSortCreates_CycleDoesNotHang: a pathological parent cycle must not loop
// forever — the function logs and flushes the remainder.
func TestTopologicalSortCreates_CycleDoesNotHang(t *testing.T) {
	a := withParent(groupMonitor(1, "A"), 2)
	b := withParent(groupMonitor(2, "B"), 1)
	creates := []SyncPlan{
		{Action: ActionCreate, MasterID: 1, Monitor: a},
		{Action: ActionCreate, MasterID: 2, Monitor: b},
	}

	sorted := newReconciler(false).topologicalSortCreates(creates)
	if len(sorted) != 2 {
		t.Fatalf("cycle must still flush all plans, got %d", len(sorted))
	}
}

// --- FilterMonitorsByTypes (tag-style selection while preserving group hierarchy) ---

// TestFilterMonitorsByTypes_IncludesAncestorGroups: filtering for "http" must also pull
// in the ancestor "group" monitors so the hierarchy is preserved on the probe.
func TestFilterMonitorsByTypes_IncludesAncestorGroups(t *testing.T) {
	root := groupMonitor(1, "Root")
	mid := withParent(groupMonitor(2, "Mid"), 1)
	leaf := withParent(httpMonitor(3, "Leaf", "https://leaf.example"), 2)
	unrelated := groupMonitor(4, "Empty group") // no http descendant

	all := monitorMap(root, mid, leaf, unrelated)

	filtered := FilterMonitorsByTypes(all, []string{"http"})

	if _, ok := filtered[3]; !ok {
		t.Error("expected the http leaf to be included")
	}
	if _, ok := filtered[2]; !ok {
		t.Error("expected ancestor group 2 to be included to preserve hierarchy")
	}
	if _, ok := filtered[1]; !ok {
		t.Error("expected ancestor group 1 to be included to preserve hierarchy")
	}
	if _, ok := filtered[4]; ok {
		t.Error("group 4 has no matching descendant and must NOT be included")
	}
}

// TestFilterMonitorsByTypes_EmptyTypesReturnsAll: an empty type list is a pass-through.
func TestFilterMonitorsByTypes_EmptyTypesReturnsAll(t *testing.T) {
	all := monitorMap(httpMonitor(1, "A", "https://a.example"), groupMonitor(2, "G"))
	filtered := FilterMonitorsByTypes(all, nil)
	if len(filtered) != 2 {
		t.Fatalf("empty type filter should return all monitors, got %d", len(filtered))
	}
}
