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
	logger        *slog.Logger
	deleteOrphans bool
}

// NewReconciler creates a new reconciler instance.
func NewReconciler(logger *slog.Logger, deleteOrphans bool) *Reconciler {
	return &Reconciler{
		logger:        logger,
		deleteOrphans: deleteOrphans,
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

// ExecuteSyncPlan executes the sync operations against a probe with topological ordering.
// Creates are sorted topologically so parents are created before children at any nesting
// depth, with parent IDs remapped from master to probe-local IDs.
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

	// Topological sort of creates: parents before children at any depth.
	// Build index of master IDs being created in this batch.
	sortedCreates := r.topologicalSortCreates(creates)

	// Create monitors in dependency order with parent ID remapping
	for _, plan := range sortedCreates {
		select {
		case <-ctx.Done():
			return stats, ctx.Err()
		default:
		}

		// Remap parent ID from master to probe-local ID
		if plan.Monitor.Parent.Valid {
			masterParentID := plan.Monitor.Parent.Int64
			if probeParentID, exists := mapping.GetProbeID(masterParentID); exists {
				plan.Monitor.Parent = sql.NullInt64{Int64: probeParentID, Valid: true}
				r.logger.Debug("remapped parent ID",
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
			}
		}

		opCtx, opCancel := context.WithTimeout(ctx, 60*time.Second)
		err := r.executeCreate(opCtx, kumaClient, plan, mapping, dryRun)
		opCancel()
		if err != nil {
			stats.Errors++
			r.logger.Error("failed to create monitor",
				"master_id", plan.MasterID,
				"name", plan.Monitor.Name,
				"error", err,
			)
		} else {
			stats.Creates++
			// Throttle creates: give the probe time to start the monitor and fire
			// the first beat before sending the next create. Without this, bulk
			// creates cause a thundering herd that saturates the probe's event loop.
			if !dryRun {
				time.Sleep(1 * time.Second)
			}
		}
	}

	// Updates (also need parent ID remapping)
	for _, plan := range updates {
		select {
		case <-ctx.Done():
			return stats, ctx.Err()
		default:
		}

		// Remap parent ID for updates as well
		if plan.Monitor.Parent.Valid {
			masterParentID := plan.Monitor.Parent.Int64
			if probeParentID, exists := mapping.GetProbeID(masterParentID); exists {
				plan.Monitor.Parent = sql.NullInt64{Int64: probeParentID, Valid: true}
			} else {
				plan.Monitor.Parent = sql.NullInt64{Valid: false}
			}
		}

		opCtx, opCancel := context.WithTimeout(ctx, 60*time.Second)
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
		} else {
			stats.Updates++
		}
	}

	// Deletes (process in reverse to delete children before parents)
	for i := len(deletes) - 1; i >= 0; i-- {
		plan := deletes[i]
		select {
		case <-ctx.Done():
			return stats, ctx.Err()
		default:
		}

		opCtx, opCancel := context.WithTimeout(ctx, 60*time.Second)
		err := r.executeDelete(opCtx, kumaClient, plan, mapping, dryRun)
		opCancel()
		if err != nil {
			stats.Errors++
			r.logger.Error("failed to delete monitor",
				"master_id", plan.MasterID,
				"probe_id", plan.ProbeID,
				"error", err,
			)
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
func FilterMonitorsByTypes(monitors map[int64]*db.Monitor, types []string) map[int64]*db.Monitor {
	if len(types) == 0 {
		return monitors
	}

	typeSet := make(map[string]bool, len(types))
	for _, t := range types {
		typeSet[t] = true
	}

	filtered := make(map[int64]*db.Monitor)
	for id, m := range monitors {
		if typeSet[m.Type] {
			filtered[id] = m
		}
	}

	return filtered
}
