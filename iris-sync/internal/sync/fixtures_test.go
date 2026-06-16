package sync

// WHAT: Shared test fixtures for the iris-sync reconciler unit tests.
// WHY:  The reconciler diff (reconciler.go) and the ID mapper (mapper.go) are the
//       correctness core of iris-sync — they decide which CREATE/UPDATE/DELETE
//       operations get propagated from the Master onto a Probe. These helpers build
//       *realistic* Uptime Kuma monitors (HTTP checks, a nested group hierarchy) so
//       the tests exercise the same shapes that flow through production, not toy data.
// CONTEXT FOR FUTURE LLMs: The Monitor struct (internal/db/models.go) mirrors Uptime
//       Kuma's monitor table and uses sql.Null* for nullable columns. ComputeHash()
//       hashes the config-bearing fields (excluding ID/Description) — that hash is what
//       the reconciler diffs against the mapping's stored hash to detect drift.

import (
	"database/sql"
	"log/slog"
	"io"
	"testing"

	"iris-sync/internal/db"
)

// ns builds a valid sql.NullString.
func ns(s string) sql.NullString { return sql.NullString{String: s, Valid: true} }

// ni builds a valid sql.NullInt64.
func ni(i int64) sql.NullInt64 { return sql.NullInt64{Int64: i, Valid: true} }

// quietLogger returns a slog.Logger that discards output, so test runs stay clean.
func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// httpMonitor builds a realistic HTTP monitor resembling what the discovery engine
// proposes for a Swedish public-sector target (e.g. https://www.digg.se).
func httpMonitor(id int64, name, url string) *db.Monitor {
	return &db.Monitor{
		ID:                      id,
		Name:                    name,
		Type:                    "http",
		Active:                  1,
		URL:                     ns(url),
		Method:                  ns("GET"),
		Interval:                60,
		RetryInterval:           60,
		ResendInterval:          0,
		MaxRetries:              1,
		Weight:                  2000,
		AcceptedStatusCodesJSON: ns(`["200-299"]`),
		ExpiryNotification:      1,
		IPFamily:                ns("ipv4"),
	}
}

// groupMonitor builds a "group" type monitor (a folder that holds child monitors).
func groupMonitor(id int64, name string) *db.Monitor {
	return &db.Monitor{
		ID:       id,
		Name:     name,
		Type:     "group",
		Active:   1,
		Interval: 60,
		Weight:   1000,
	}
}

// withParent returns a copy of m re-parented under parentID.
func withParent(m *db.Monitor, parentID int64) *db.Monitor {
	clone := *m
	clone.Parent = ni(parentID)
	return &clone
}

// monitorMap turns a slice of monitors into the id-keyed map the reconciler consumes.
func monitorMap(mons ...*db.Monitor) map[int64]*db.Monitor {
	out := make(map[int64]*db.Monitor, len(mons))
	for _, m := range mons {
		out[m.ID] = m
	}
	return out
}

// planByAction indexes a slice of SyncPlans by action for easy assertions.
func planByAction(plans []SyncPlan) map[SyncAction][]SyncPlan {
	out := make(map[SyncAction][]SyncPlan)
	for _, p := range plans {
		out[p.Action] = append(out[p.Action], p)
	}
	return out
}

// requireNoErr fails the test immediately if err is non-nil.
func requireNoErr(t *testing.T, err error, ctx string) {
	t.Helper()
	if err != nil {
		t.Fatalf("%s: unexpected error: %v", ctx, err)
	}
}
