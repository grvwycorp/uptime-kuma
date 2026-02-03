package sync

import (
	"context"
	"fmt"
	"log/slog"

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

	// Phase 1: Check each master monitor for create/update needs
	for masterID, masterMon := range masterMonitors {
		// Compute content hash for change detection
		currentHash := masterMon.ComputeHash()
		masterMon.ContentHash = currentHash

		probeID, existsOnProbe := mapping.GetProbeID(masterID)

		if !existsOnProbe {
			// Monitor doesn't exist on probe - CREATE
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
// Returns statistics about the sync operation.
func (r *Reconciler) ExecuteSyncPlan(
	ctx context.Context,
	kumaClient *client.KumaClient,
	plans []SyncPlan,
	mapping *IDMapping,
	dryRun bool,
) (*SyncStats, error) {
	stats := &SyncStats{}

	for _, plan := range plans {
		select {
		case <-ctx.Done():
			return stats, ctx.Err()
		default:
		}

		var err error

		switch plan.Action {
		case ActionCreate:
			err = r.executeCreate(ctx, kumaClient, plan, mapping, dryRun)
			if err == nil {
				stats.Creates++
			}

		case ActionUpdate:
			err = r.executeUpdate(ctx, kumaClient, plan, mapping, dryRun)
			if err == nil {
				stats.Updates++
			}

		case ActionDelete:
			err = r.executeDelete(ctx, kumaClient, plan, mapping, dryRun)
			if err == nil {
				stats.Deletes++
			}
		}

		if err != nil {
			stats.Errors++
			r.logger.Error("sync operation failed",
				"action", plan.Action.String(),
				"master_id", plan.MasterID,
				"probe_id", plan.ProbeID,
				"error", err,
			)
		}
	}

	return stats, nil
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
