package sync

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"

	"iris-sync/internal/client"
	"iris-sync/internal/db"
)

// SyncAction represents the type of sync operation to perform.
type SyncAction int

const (
	ActionCreate SyncAction = iota
	ActionUpdate
	ActionDelete
)

// String returns a human-readable name for the action.
func (a SyncAction) String() string {
	switch a {
	case ActionCreate:
		return "create"
	case ActionUpdate:
		return "update"
	case ActionDelete:
		return "delete"
	default:
		return "unknown"
	}
}

// SyncPlan represents a planned synchronization operation.
type SyncPlan struct {
	Action   SyncAction
	MasterID int64
	ProbeID  int64 // Only set for Update/Delete
	Monitor  *db.Monitor
	Reason   string
}

// SyncStats holds statistics about a sync operation.
type SyncStats struct {
	Creates   int
	Updates   int
	Deletes   int
	Skipped   int
	Errors    int
	TotalTime int64 // milliseconds
}

// Reconciler handles delta synchronization between master and probes.
type Reconciler struct {
	logger           *slog.Logger
	deleteOrphans    bool
	operationTimeout time.Duration
}

// NewReconciler creates a new reconciler instance.
func NewReconciler(logger *slog.Logger, deleteOrphans bool, operationTimeout time.Duration) *Reconciler {
	if operationTimeout <= 0 {
		operationTimeout = 60 * time.Second
	}
	return &Reconciler{
		logger:           logger,
		deleteOrphans:    deleteOrphans,
		operationTimeout: operationTimeout,
	}
}

// ComputeSyncPlan calculates the sync operations needed to reconcile master with probe state.
// It compares desired state (master) with current state (probe) and generates a diff.
func (r *Reconciler) ComputeSyncPlan(
	masterMonitors map[int64]*db.Monitor,
	probeMonitors map[int64]*db.Monitor,
	mapping *IDMapping,
) []SyncPlan {
	var plans []SyncPlan

	// Track which master IDs exist on the probe (for orphan detection)
	knownMasterIDs := make(map[int64]bool)

	// Build name-based index of probe monitors for duplicate detection.
	// If mapping files are lost or corrupted, this prevents creating duplicate
	// monitors on the probe by matching existing monitors by name.
	probeByName := make(map[string]*db.Monitor, len(probeMonitors))
	for _, pm := range probeMonitors {
		probeByName[pm.Name] = pm
	}

	// Phase 1: Check each master monitor for create/update needs
	for masterID, masterMon := range masterMonitors {
		// Compute content hash for change detection
		currentHash := masterMon.ComputeHash()
		masterMon.ContentHash = currentHash

		probeID, existsOnProbe := mapping.GetProbeID(masterID)

		if !existsOnProbe {
			// No mapping entry for this master monitor. Before creating, check if
			// the probe already has a monitor with the same name (orphan from a
			// previous sync where mappings were lost).
			if existingProbe, found := probeByName[masterMon.Name]; found {
				r.logger.Info("adopted orphaned probe monitor by name match",
					"master_id", masterID,
					"probe_id", existingProbe.ID,
					"name", masterMon.Name,
				)
				// Adopt: add to mapping and schedule an update instead of create
				mapping.SetMapping(masterID, existingProbe.ID)
				mapping.SetHash(masterID, "") // Force update on first sync

				updateMon := *masterMon
				updateMon.ID = existingProbe.ID
				plans = append(plans, SyncPlan{
					Action:   ActionUpdate,
					MasterID: masterID,
					ProbeID:  existingProbe.ID,
					Monitor:  &updateMon,
					Reason:   "adopted orphan, syncing config",
				})
				knownMasterIDs[masterID] = true
				continue
			}

			// Monitor truly doesn't exist on probe - CREATE
			plans = append(plans, SyncPlan{
				Action:   ActionCreate,
				MasterID: masterID,
				Monitor:  masterMon,
				Reason:   "new monitor from master",
			})
			continue
		}

		knownMasterIDs[masterID] = true

		// Check if probe still has this monitor
		_, probeHasMonitor := probeMonitors[probeID]
		if !probeHasMonitor {
			// Probe lost the monitor (manual deletion?) - recreate
			mapping.RemoveByMasterID(masterID)
			plans = append(plans, SyncPlan{
				Action:   ActionCreate,
				MasterID: masterID,
				Monitor:  masterMon,
				Reason:   "monitor missing from probe, recreating",
			})
			continue
		}

		// Check if monitor configuration changed using hash comparison
		storedHash, hasHash := mapping.GetHash(masterID)
		if !hasHash || storedHash != currentHash {
			// Configuration changed - UPDATE
			// Clone monitor and set probe ID for the update operation
			updateMon := *masterMon
			updateMon.ID = probeID

			plans = append(plans, SyncPlan{
				Action:   ActionUpdate,
				MasterID: masterID,
				ProbeID:  probeID,
				Monitor:  &updateMon,
				Reason:   "configuration changed",
			})
		}
		// Else: no change, skip
	}

	// Phase 2: Check for orphaned monitors on probe (exist on probe but not in master)
	if r.deleteOrphans {
		for _, masterID := range mapping.GetAllMasterIDs() {
			if _, existsInMaster := masterMonitors[masterID]; !existsInMaster {
				probeID, hasProbeID := mapping.GetProbeID(masterID)
				if hasProbeID {
					plans = append(plans, SyncPlan{
						Action:   ActionDelete,
						MasterID: masterID,
						ProbeID:  probeID,
						Reason:   "deleted from master",
					})
				}
			}
		}
	}

	return plans
}

// ExecuteSyncPlan executes the sync operations against a probe.
// Order: updates first (fix existing monitors), then creates (topologically sorted so
// parents come before children), then deletes. Updates run first because they fix drift
// on existing monitors and must not be blocked by slow or failing creates.
// Returns statistics about the sync operation.
func (r *Reconciler) ExecuteSyncPlan(
	ctx context.Context,
	kumaClient *client.KumaClient,
	plans []SyncPlan,
	mapping *IDMapping,
	dryRun bool,
) (*SyncStats, error) {
	stats := &SyncStats{}

	// Separate plans by action type
	var creates, updates, deletes []SyncPlan

	for _, plan := range plans {
		switch plan.Action {
		case ActionCreate:
			creates = append(creates, plan)
		case ActionUpdate:
			updates = append(updates, plan)
		case ActionDelete:
			deletes = append(deletes, plan)
		}
	}

	// --- Phase 1: Updates (highest priority - fixes drift on existing monitors) ---
	// Cap update timeout at 30s: if the probe doesn't respond within 30s the
	// editMonitor handler is likely stuck; the WebSocket will die at ~45s anyway
	// (ping_interval 25s + ping_timeout 20s).
	updateTimeout := r.operationTimeout
	if updateTimeout > 30*time.Second {
		updateTimeout = 30 * time.Second
	}

	for i, plan := range updates {
		select {
		case <-ctx.Done():
			return stats, ctx.Err()
		default:
		}

		// Remap parent ID for updates
		if plan.Monitor.Parent.Valid {
			masterParentID := plan.Monitor.Parent.Int64
			if probeParentID, exists := mapping.GetProbeID(masterParentID); exists {
				plan.Monitor.Parent = sql.NullInt64{Int64: probeParentID, Valid: true}
				r.logger.Debug("remapped parent ID for update",
					"monitor", plan.Monitor.Name,
					"master_parent_id", masterParentID,
					"probe_parent_id", probeParentID,
				)
			} else {
				r.logger.Warn("parent not found on probe during update, clearing parent reference",
					"monitor", plan.Monitor.Name,
					"master_parent_id", masterParentID,
				)
				plan.Monitor.Parent = sql.NullInt64{Valid: false}
				// Force re-sync next cycle to fix parent when it becomes available
				plan.Monitor.ContentHash = ""
			}
		}

		opCtx, opCancel := context.WithTimeout(ctx, updateTimeout)
		err := r.executeUpdate(opCtx, kumaClient, plan, mapping, dryRun)
		opCancel()
		if err != nil {
			stats.Errors++
			r.logger.Error("failed to update monitor",
				"master_id", plan.MasterID,
				"probe_id", plan.ProbeID,
				"name", plan.Monitor.Name,
				"error", err,
			)
			// Abort if WebSocket connection died — no point trying remaining operations
			if !kumaClient.IsConnected() {
				r.logger.Error("connection lost, aborting remaining updates",
					"completed", stats.Updates,
					"remaining", len(updates)-i-1,
				)
				break
			}
		} else {
			stats.Updates++
		}
	}

	// --- Phase 2: Creates (topologically sorted, parents before children) ---
	// Cap create timeout at 30s: creates should be fast. If the probe doesn't
	// respond within 30s the add handler is likely stuck; retrying next cycle
	// is better than starving updates.
	createTimeout := r.operationTimeout
	if createTimeout > 30*time.Second {
		createTimeout = 30 * time.Second
	}

	sortedCreates := r.topologicalSortCreates(creates)

	// Build index of master IDs being created in this batch for dependency tracking.
	createBatch := make(map[int64]bool, len(sortedCreates))
	for _, plan := range sortedCreates {
		createBatch[plan.MasterID] = true
	}

	// Track failed creates so we can skip dependent children.
	failedCreates := make(map[int64]bool)

	for i, plan := range sortedCreates {
		select {
		case <-ctx.Done():
			return stats, ctx.Err()
		default:
		}

		// Skip children whose parent creation failed in this cycle.
		if plan.Monitor.Parent.Valid {
			masterParentID := plan.Monitor.Parent.Int64
			if createBatch[masterParentID] && failedCreates[masterParentID] {
				r.logger.Warn("skipping monitor creation - parent failed in this cycle",
					"monitor", plan.Monitor.Name,
					"master_id", plan.MasterID,
					"failed_parent_id", masterParentID,
				)
				stats.Skipped++
				failedCreates[plan.MasterID] = true
				continue
			}
		}

		// Remap parent ID from master to probe-local ID
		parentCleared := false
		if plan.Monitor.Parent.Valid {
			masterParentID := plan.Monitor.Parent.Int64
			if probeParentID, exists := mapping.GetProbeID(masterParentID); exists {
				plan.Monitor.Parent = sql.NullInt64{Int64: probeParentID, Valid: true}
				r.logger.Info("remapped parent ID",
					"monitor", plan.Monitor.Name,
					"master_parent_id", masterParentID,
					"probe_parent_id", probeParentID,
				)
			} else {
				r.logger.Warn("parent not found on probe, clearing parent reference",
					"monitor", plan.Monitor.Name,
					"master_parent_id", masterParentID,
				)
				plan.Monitor.Parent = sql.NullInt64{Valid: false}
				parentCleared = true
			}
		}

		if parentCleared {
			plan.Monitor.ContentHash = ""
		}

		opCtx, opCancel := context.WithTimeout(ctx, createTimeout)
		err := r.executeCreate(opCtx, kumaClient, plan, mapping, dryRun)
		opCancel()
		if err != nil {
			stats.Errors++
			failedCreates[plan.MasterID] = true
			r.logger.Error("failed to create monitor",
				"master_id", plan.MasterID,
				"name", plan.Monitor.Name,
				"error", err,
			)
			// Abort if WebSocket connection died — no point trying remaining operations
			if !kumaClient.IsConnected() {
				r.logger.Error("connection lost, aborting remaining creates",
					"completed", stats.Creates,
					"remaining", len(sortedCreates)-i-1,
				)
				break
			}
			continue
		}
		stats.Creates++
		if !dryRun {
			time.Sleep(1 * time.Second)
		}
	}

	// --- Phase 3: Deletes (children before parents) ---
	deleteTimeout := r.operationTimeout
	if deleteTimeout > 30*time.Second {
		deleteTimeout = 30 * time.Second
	}

	for i := len(deletes) - 1; i >= 0; i-- {
		plan := deletes[i]
		select {
		case <-ctx.Done():
			return stats, ctx.Err()
		default:
		}

		opCtx, opCancel := context.WithTimeout(ctx, deleteTimeout)
		err := r.executeDelete(opCtx, kumaClient, plan, mapping, dryRun)
		opCancel()
		if err != nil {
			stats.Errors++
			r.logger.Error("failed to delete monitor",
				"master_id", plan.MasterID,
				"probe_id", plan.ProbeID,
				"error", err,
			)
			// Abort if WebSocket connection died
			if !kumaClient.IsConnected() {
				r.logger.Error("connection lost, aborting remaining deletes",
					"completed", stats.Deletes,
				)
				break
			}
		} else {
			stats.Deletes++
		}
	}

	return stats, nil
}

// topologicalSortCreates orders create plans so that parents come before children.
// Monitors with no parent (or whose parent already exists) come first, then their
// children, then grandchildren, etc. This handles nested groups at any depth.
func (r *Reconciler) topologicalSortCreates(creates []SyncPlan) []SyncPlan {
	if len(creates) == 0 {
		return creates
	}

	// Index plans by their master ID for lookup
	planByMasterID := make(map[int64]*SyncPlan, len(creates))
	for i := range creates {
		planByMasterID[creates[i].MasterID] = &creates[i]
	}

	// Kahn's algorithm: process nodes whose dependencies are satisfied
	var sorted []SyncPlan
	added := make(map[int64]bool, len(creates))

	for len(sorted) < len(creates) {
		progress := false

		for _, plan := range creates {
			if added[plan.MasterID] {
				continue
			}

			// Ready if: no parent, or parent is not in this batch (already exists), or parent already added
			if !plan.Monitor.Parent.Valid {
				// No parent - root monitor
				sorted = append(sorted, plan)
				added[plan.MasterID] = true
				progress = true
			} else {
				parentMasterID := plan.Monitor.Parent.Int64
				_, parentInBatch := planByMasterID[parentMasterID]
				if !parentInBatch || added[parentMasterID] {
					// Parent already exists or was already sorted
					sorted = append(sorted, plan)
					added[plan.MasterID] = true
					progress = true
				}
			}
		}

		if !progress {
			// Circular dependency or unresolvable - add remaining to avoid infinite loop
			r.logger.Warn("could not resolve all parent dependencies, adding remaining monitors")
			for _, plan := range creates {
				if !added[plan.MasterID] {
					sorted = append(sorted, plan)
				}
			}
			break
		}
	}

	return sorted
}

// executeCreate adds a new monitor to the probe.
func (r *Reconciler) executeCreate(
	ctx context.Context,
	kumaClient *client.KumaClient,
	plan SyncPlan,
	mapping *IDMapping,
	dryRun bool,
) error {
	r.logger.Info("creating monitor",
		"master_id", plan.MasterID,
		"name", plan.Monitor.Name,
		"type", plan.Monitor.Type,
		"reason", plan.Reason,
		"dry_run", dryRun,
	)

	if dryRun {
		return nil
	}

	probeID, err := kumaClient.AddMonitor(ctx, plan.Monitor)
	if err != nil {
		return fmt.Errorf("failed to create monitor: %w", err)
	}

	// Update mapping with new probe ID
	mapping.SetMapping(plan.MasterID, probeID)
	mapping.SetHash(plan.MasterID, plan.Monitor.ContentHash)

	r.logger.Info("created monitor",
		"master_id", plan.MasterID,
		"probe_id", probeID,
		"name", plan.Monitor.Name,
	)

	return nil
}

// executeUpdate modifies an existing monitor on the probe.
func (r *Reconciler) executeUpdate(
	ctx context.Context,
	kumaClient *client.KumaClient,
	plan SyncPlan,
	mapping *IDMapping,
	dryRun bool,
) error {
	r.logger.Info("updating monitor",
		"master_id", plan.MasterID,
		"probe_id", plan.ProbeID,
		"name", plan.Monitor.Name,
		"reason", plan.Reason,
		"dry_run", dryRun,
	)

	if dryRun {
		return nil
	}

	if err := kumaClient.EditMonitor(ctx, plan.Monitor); err != nil {
		return fmt.Errorf("failed to update monitor: %w", err)
	}

	// Update hash cache
	mapping.SetHash(plan.MasterID, plan.Monitor.ContentHash)

	r.logger.Info("updated monitor",
		"master_id", plan.MasterID,
		"probe_id", plan.ProbeID,
		"name", plan.Monitor.Name,
	)

	return nil
}

// executeDelete removes a monitor from the probe.
func (r *Reconciler) executeDelete(
	ctx context.Context,
	kumaClient *client.KumaClient,
	plan SyncPlan,
	mapping *IDMapping,
	dryRun bool,
) error {
	r.logger.Info("deleting monitor",
		"master_id", plan.MasterID,
		"probe_id", plan.ProbeID,
		"reason", plan.Reason,
		"dry_run", dryRun,
	)

	if dryRun {
		return nil
	}

	// Delete without removing children (they become orphans, will be cleaned up)
	if err := kumaClient.DeleteMonitor(ctx, plan.ProbeID, false); err != nil {
		return fmt.Errorf("failed to delete monitor: %w", err)
	}

	// Remove from mapping
	mapping.RemoveByMasterID(plan.MasterID)

	r.logger.Info("deleted monitor",
		"master_id", plan.MasterID,
		"probe_id", plan.ProbeID,
	)

	return nil
}

// LogSyncPlan outputs a summary of the sync plan for review.
func (r *Reconciler) LogSyncPlan(plans []SyncPlan) {
	creates := 0
	updates := 0
	deletes := 0

	for _, p := range plans {
		switch p.Action {
		case ActionCreate:
			creates++
		case ActionUpdate:
			updates++
		case ActionDelete:
			deletes++
		}
	}

	r.logger.Info("sync plan computed",
		"creates", creates,
		"updates", updates,
		"deletes", deletes,
		"total", len(plans),
	)

	// Log individual plans at debug level
	for _, p := range plans {
		r.logger.Debug("planned action",
			"action", p.Action.String(),
			"master_id", p.MasterID,
			"probe_id", p.ProbeID,
			"monitor_name", getMonitorName(p.Monitor),
			"reason", p.Reason,
		)
	}
}

// getMonitorName safely extracts monitor name or returns a placeholder.
func getMonitorName(m *db.Monitor) string {
	if m == nil {
		return "<unknown>"
	}
	return m.Name
}

// FilterMonitorsByTypes returns monitors that match any of the specified types.
// Always includes "group" type monitors that are ancestors of any matched monitor,
// so that nested hierarchies are preserved on the probe.
func FilterMonitorsByTypes(monitors map[int64]*db.Monitor, types []string) map[int64]*db.Monitor {
	if len(types) == 0 {
		return monitors
	}

	typeSet := make(map[string]bool, len(types))
	for _, t := range types {
		typeSet[t] = true
	}

	// First pass: collect directly matched monitors
	filtered := make(map[int64]*db.Monitor)
	for id, m := range monitors {
		if typeSet[m.Type] {
			filtered[id] = m
		}
	}

	// Second pass: include ancestor groups so hierarchies are preserved.
	// Walk up the parent chain for each matched monitor and include any
	// "group" type ancestors that aren't already in the filtered set.
	for _, m := range filtered {
		parentID := m.Parent
		visited := make(map[int64]bool)
		for parentID.Valid {
			pid := parentID.Int64
			if visited[pid] {
				break // cycle guard
			}
			visited[pid] = true
			if _, already := filtered[pid]; already {
				break // already included, ancestors above it are too
			}
			if parent, exists := monitors[pid]; exists {
				if parent.Type == "group" {
					filtered[pid] = parent
				}
				parentID = parent.Parent
			} else {
				break
			}
		}
	}

	return filtered
}

// DriftResult holds the result of a single drift check for one monitor.
type DriftResult struct {
	MonitorName    string
	MasterID       int64
	ProbeID        int64
	ExpectedParent int64 // 0 means root (no parent)
	ActualParent   int64 // 0 means root
}

// VerifyParentDrift re-fetches the probe's monitor list after sync and compares
// parent assignments against master expectations. Returns any mismatches found.
func (r *Reconciler) VerifyParentDrift(
	ctx context.Context,
	kumaClient *client.KumaClient,
	masterMonitors map[int64]*db.Monitor,
	mapping *IDMapping,
) ([]DriftResult, error) {
	probeMonitors, err := kumaClient.GetMonitorList(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to re-fetch probe monitors for drift check: %w", err)
	}

	var drifts []DriftResult

	for masterID, masterMon := range masterMonitors {
		probeID, exists := mapping.GetProbeID(masterID)
		if !exists {
			continue
		}

		probeMon, probeExists := probeMonitors[probeID]
		if !probeExists {
			continue
		}

		// Determine expected parent on probe (remap master parent ID)
		var expectedProbeParent int64
		if masterMon.Parent.Valid {
			if probeParentID, ok := mapping.GetProbeID(masterMon.Parent.Int64); ok {
				expectedProbeParent = probeParentID
			}
			// If parent not mapped, expected is 0 (root) since reconciler clears it
		}

		// Determine actual parent on probe
		var actualProbeParent int64
		if probeMon.Parent.Valid {
			actualProbeParent = probeMon.Parent.Int64
		}

		if expectedProbeParent != actualProbeParent {
			drifts = append(drifts, DriftResult{
				MonitorName:    masterMon.Name,
				MasterID:       masterID,
				ProbeID:        probeID,
				ExpectedParent: expectedProbeParent,
				ActualParent:   actualProbeParent,
			})
		}
	}

	for _, d := range drifts {
		r.logger.Warn("DRIFT DETECTED: parent mismatch after sync",
			"monitor", d.MonitorName,
			"master_id", d.MasterID,
			"probe_id", d.ProbeID,
			"expected_parent", d.ExpectedParent,
			"actual_parent", d.ActualParent,
		)
	}

	return drifts, nil
}
