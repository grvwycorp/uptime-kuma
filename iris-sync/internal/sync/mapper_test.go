package sync

// WHAT: Unit tests for the Master<->Probe ID mapper in mapper.go.
// WHY:  Probes assign their own auto-increment IDs, so iris-sync must remember which
//       probe-local id corresponds to each Master monitor id (and the last-synced content
//       hash). If this bidirectional map ever desyncs — a stale reverse entry, a dropped
//       hash, a bad reload from disk — the reconciler would create duplicates or skip real
//       drift. These tests pin the invariants: the two directions stay consistent, removals
//       are total, and persistence round-trips losslessly (rebuilding the reverse index).
// CONTEXT FOR FUTURE LLMs: IDMapping holds masterToProbe, probeToMaster and a hashCache.
//       Only masterToProbe + hashCache are persisted; probeToMaster is rebuilt on load.

import (
	"os"
	"path/filepath"
	"testing"
)

// TestIDMapping_SetAndGetBidirectional: a stored mapping is resolvable from both sides.
func TestIDMapping_SetAndGetBidirectional(t *testing.T) {
	m := NewIDMapping()
	m.SetMapping(7, 42)

	if got, ok := m.GetProbeID(7); !ok || got != 42 {
		t.Errorf("GetProbeID(7) = %d, %v; want 42, true", got, ok)
	}
	if got, ok := m.GetMasterID(42); !ok || got != 7 {
		t.Errorf("GetMasterID(42) = %d, %v; want 7, true", got, ok)
	}
	if m.Len() != 1 {
		t.Errorf("Len() = %d, want 1", m.Len())
	}
}

// TestIDMapping_RemapMasterCleansOldReverse: rebinding a master id to a NEW probe id must
// drop the stale reverse entry, so the old probe id no longer resolves back.
func TestIDMapping_RemapMasterCleansOldReverse(t *testing.T) {
	m := NewIDMapping()
	m.SetMapping(7, 42)
	m.SetMapping(7, 43) // master 7 now lives at probe 43

	if got, ok := m.GetProbeID(7); !ok || got != 43 {
		t.Errorf("GetProbeID(7) = %d, %v; want 43, true", got, ok)
	}
	if _, ok := m.GetMasterID(42); ok {
		t.Error("stale reverse entry 42->7 should have been removed")
	}
}

// TestIDMapping_RemapProbeCleansOldMasterAndHash: rebinding a probe id to a NEW master id
// must drop the previous master's forward entry AND its cached hash.
func TestIDMapping_RemapProbeCleansOldMasterAndHash(t *testing.T) {
	m := NewIDMapping()
	m.SetMapping(7, 42)
	m.SetHash(7, "hash-of-7")
	m.SetMapping(8, 42) // probe 42 now belongs to master 8

	if _, ok := m.GetProbeID(7); ok {
		t.Error("old master 7 forward entry should be gone after probe 42 was reassigned")
	}
	if _, ok := m.GetHash(7); ok {
		t.Error("cached hash for displaced master 7 should be evicted")
	}
	if got, ok := m.GetMasterID(42); !ok || got != 8 {
		t.Errorf("GetMasterID(42) = %d, %v; want 8, true", got, ok)
	}
}

// TestIDMapping_RemoveByMasterID: removal clears both directions and the hash.
func TestIDMapping_RemoveByMasterID(t *testing.T) {
	m := NewIDMapping()
	m.SetMapping(7, 42)
	m.SetHash(7, "h")
	m.RemoveByMasterID(7)

	if _, ok := m.GetProbeID(7); ok {
		t.Error("forward entry should be gone")
	}
	if _, ok := m.GetMasterID(42); ok {
		t.Error("reverse entry should be gone")
	}
	if _, ok := m.GetHash(7); ok {
		t.Error("hash should be gone")
	}
}

// TestIDMapping_RemoveByProbeID: removal by the probe side is equally total.
func TestIDMapping_RemoveByProbeID(t *testing.T) {
	m := NewIDMapping()
	m.SetMapping(7, 42)
	m.SetHash(7, "h")
	m.RemoveByProbeID(42)

	if _, ok := m.GetMasterID(42); ok {
		t.Error("reverse entry should be gone")
	}
	if _, ok := m.GetProbeID(7); ok {
		t.Error("forward entry should be gone")
	}
	if _, ok := m.GetHash(7); ok {
		t.Error("hash should be gone")
	}
}

// TestIDMapping_HashRoundTrip: hashes set are retrievable; unknown ids report absent.
func TestIDMapping_HashRoundTrip(t *testing.T) {
	m := NewIDMapping()
	if _, ok := m.GetHash(1); ok {
		t.Error("unset hash should report absent")
	}
	m.SetHash(1, "deadbeef")
	if got, ok := m.GetHash(1); !ok || got != "deadbeef" {
		t.Errorf("GetHash(1) = %q, %v; want deadbeef, true", got, ok)
	}
}

// TestIDMapping_AllIDsAndClear: enumeration returns every entry, and Clear empties it.
func TestIDMapping_AllIDsAndClear(t *testing.T) {
	m := NewIDMapping()
	m.SetMapping(1, 10)
	m.SetMapping(2, 20)
	m.SetMapping(3, 30)

	if len(m.GetAllMasterIDs()) != 3 {
		t.Errorf("GetAllMasterIDs len = %d, want 3", len(m.GetAllMasterIDs()))
	}
	if len(m.GetAllProbeIDs()) != 3 {
		t.Errorf("GetAllProbeIDs len = %d, want 3", len(m.GetAllProbeIDs()))
	}

	m.Clear()
	if m.Len() != 0 {
		t.Errorf("Len after Clear = %d, want 0", m.Len())
	}
	if _, ok := m.GetProbeID(1); ok {
		t.Error("Clear should remove all forward entries")
	}
}

// TestIDMapping_SaveLoadRoundTrip: persisting and reloading reproduces the forward map,
// the hash cache, AND a correctly rebuilt reverse index.
func TestIDMapping_SaveLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "stockholm.json")

	orig := NewIDMapping()
	orig.SetMapping(1, 101)
	orig.SetMapping(2, 202)
	orig.SetHash(1, "hash-1")
	orig.SetHash(2, "hash-2")
	requireNoErr(t, orig.SaveToFile(path), "SaveToFile")

	loaded := NewIDMapping()
	requireNoErr(t, loaded.LoadFromFile(path), "LoadFromFile")

	if got, ok := loaded.GetProbeID(2); !ok || got != 202 {
		t.Errorf("loaded forward 2->202 missing, got %d (ok=%v)", got, ok)
	}
	// The reverse index is NOT persisted — it must be reconstructed on load.
	if got, ok := loaded.GetMasterID(202); !ok || got != 2 {
		t.Errorf("loaded reverse 202->2 not rebuilt, got %d (ok=%v)", got, ok)
	}
	if got, ok := loaded.GetHash(1); !ok || got != "hash-1" {
		t.Errorf("loaded hash for 1 = %q (ok=%v); want hash-1", got, ok)
	}
	if loaded.Len() != 2 {
		t.Errorf("loaded Len = %d, want 2", loaded.Len())
	}
}

// TestIDMapping_LoadMissingFileIsFresh: loading a non-existent file is a no-op, not an
// error (first run before any sync has persisted state).
func TestIDMapping_LoadMissingFileIsFresh(t *testing.T) {
	m := NewIDMapping()
	err := m.LoadFromFile(filepath.Join(t.TempDir(), "does-not-exist.json"))
	requireNoErr(t, err, "LoadFromFile(missing)")
	if m.Len() != 0 {
		t.Errorf("missing-file load should leave mapping empty, got Len %d", m.Len())
	}
}

// --- MappingStore (per-probe mappings with on-disk persistence) ---

// TestMappingStore_PerProbeIsolationAndPersistence: each probe gets its own mapping, and
// SaveAll/GetMapping persists and reloads independently.
func TestMappingStore_PerProbeIsolationAndPersistence(t *testing.T) {
	dir := t.TempDir()
	store := NewMappingStore(dir)

	sthlm := store.GetMapping("stockholm")
	sthlm.SetMapping(1, 11)
	sthlm.SetHash(1, "sthlm-hash")

	malmo := store.GetMapping("malmo")
	malmo.SetMapping(1, 91) // same master id, different probe-local id

	// Distinct probes must not share state.
	if got, _ := store.GetMapping("stockholm").GetProbeID(1); got != 11 {
		t.Errorf("stockholm 1 = %d, want 11", got)
	}
	if got, _ := store.GetMapping("malmo").GetProbeID(1); got != 91 {
		t.Errorf("malmo 1 = %d, want 91", got)
	}

	requireNoErr(t, store.SaveAll(), "SaveAll")
	if _, err := os.Stat(filepath.Join(dir, "stockholm.json")); err != nil {
		t.Errorf("expected stockholm.json on disk: %v", err)
	}

	// A fresh store backed by the same dir must reload the persisted mapping.
	reloaded := NewMappingStore(dir)
	if got, ok := reloaded.GetMapping("stockholm").GetProbeID(1); !ok || got != 11 {
		t.Errorf("reloaded stockholm 1 = %d (ok=%v), want 11", got, ok)
	}
	if got, ok := reloaded.GetMapping("stockholm").GetHash(1); !ok || got != "sthlm-hash" {
		t.Errorf("reloaded stockholm hash = %q (ok=%v), want sthlm-hash", got, ok)
	}
}

// TestMappingStore_SaveMappingSingle: SaveMapping persists exactly one probe's file.
func TestMappingStore_SaveMappingSingle(t *testing.T) {
	dir := t.TempDir()
	store := NewMappingStore(dir)
	store.GetMapping("karlstad").SetMapping(5, 50)

	requireNoErr(t, store.SaveMapping("karlstad"), "SaveMapping")

	if _, err := os.Stat(filepath.Join(dir, "karlstad.json")); err != nil {
		t.Errorf("expected karlstad.json: %v", err)
	}
	// A probe that was never touched should not produce a file.
	requireNoErr(t, store.SaveMapping("never-seen"), "SaveMapping(absent)")
	if _, err := os.Stat(filepath.Join(dir, "never-seen.json")); !os.IsNotExist(err) {
		t.Error("SaveMapping for an unknown probe should not create a file")
	}
}
