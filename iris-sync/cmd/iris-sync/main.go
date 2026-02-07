package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"iris-sync/internal/client"
	"iris-sync/internal/config"
	"iris-sync/internal/db"
	isync "iris-sync/internal/sync"
)

func main() {
	// Parse command line flags
	configPath := flag.String("config", "config.yaml", "Path to configuration file")
	dryRun := flag.Bool("dry-run", false, "Log planned actions without executing them")
	once := flag.Bool("once", false, "Run sync once and exit")
	verbose := flag.Bool("verbose", false, "Enable verbose logging")
	flag.Parse()

	// Load configuration - prefer environment variables for Docker deployment
	var cfg *config.Config
	var err error
	var configSource string

	if config.HasEnvConfig() {
		cfg, err = config.LoadFromEnv()
		configSource = "environment"
	} else {
		cfg, err = config.Load(*configPath)
		configSource = *configPath
	}

	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading config from %s: %v\n", configSource, err)
		os.Exit(1)
	}

	// Override dry run from command line
	if *dryRun {
		cfg.Sync.DryRun = true
	}

	// Setup logging
	logLevel := slog.LevelInfo
	if *verbose || cfg.Logging.Level == "debug" {
		logLevel = slog.LevelDebug
	} else if cfg.Logging.Level == "warn" {
		logLevel = slog.LevelWarn
	} else if cfg.Logging.Level == "error" {
		logLevel = slog.LevelError
	}

	var handler slog.Handler
	opts := &slog.HandlerOptions{Level: logLevel}
	if cfg.Logging.Format == "json" {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		handler = slog.NewTextHandler(os.Stdout, opts)
	}
	logger := slog.New(handler)
	slog.SetDefault(logger)

	logger.Info("iris-sync starting",
		"config_source", configSource,
		"dry_run", cfg.Sync.DryRun,
		"interval", cfg.Sync.Interval,
		"probes", len(cfg.GetEnabledProbes()),
	)

	// Connect to master database
	masterDB, err := db.NewRepository(
		cfg.Master.Host,
		cfg.Master.Port,
		cfg.Master.Database,
		cfg.Master.Username,
		cfg.Master.Password,
	)
	if err != nil {
		logger.Error("failed to connect to master database", "error", err)
		os.Exit(1)
	}
	defer masterDB.Close()

	logger.Info("connected to master database",
		"host", cfg.Master.Host,
		"database", cfg.Master.Database,
	)

	// Initialize mapping store for persistence
	mappingStore := isync.NewMappingStore("./data/mappings")

	// Create reconciler
	reconciler := isync.NewReconciler(logger, cfg.Sync.DeleteOrphans)

	// Setup graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	// Run initial sync
	runSyncCycle(ctx, cfg, masterDB, reconciler, mappingStore, logger)

	if *once {
		logger.Info("single sync completed, exiting")
		// Save mappings before exit
		if err := mappingStore.SaveAll(); err != nil {
			logger.Error("failed to save mappings", "error", err)
		}
		return
	}

	// Start periodic sync
	ticker := time.NewTicker(cfg.Sync.Interval)
	defer ticker.Stop()

	logger.Info("entering sync loop", "interval", cfg.Sync.Interval)

	for {
		select {
		case <-ticker.C:
			runSyncCycle(ctx, cfg, masterDB, reconciler, mappingStore, logger)

		case sig := <-sigCh:
			logger.Info("received shutdown signal", "signal", sig)
			cancel()

			// Save mappings before exit
			if err := mappingStore.SaveAll(); err != nil {
				logger.Error("failed to save mappings", "error", err)
			}

			logger.Info("shutdown complete")
			return

		case <-ctx.Done():
			return
		}
	}
}

// runSyncCycle performs a complete sync cycle across all enabled probes.
func runSyncCycle(
	ctx context.Context,
	cfg *config.Config,
	masterDB *db.Repository,
	reconciler *isync.Reconciler,
	mappingStore *isync.MappingStore,
	logger *slog.Logger,
) {
	startTime := time.Now()
	logger.Info("starting sync cycle")

	// Fetch all monitors from master
	masterMonitors, err := masterDB.GetAllMonitors(ctx)
	if err != nil {
		logger.Error("failed to fetch monitors from master", "error", err)
		return
	}

	logger.Info("fetched monitors from master", "count", len(masterMonitors))

	// Get enabled probes
	probes := cfg.GetEnabledProbes()
	if len(probes) == 0 {
		logger.Warn("no enabled probes configured")
		return
	}

	// Sync to each probe concurrently
	var wg sync.WaitGroup
	var successMu sync.Mutex
	var successProbes []string
	semaphore := make(chan struct{}, cfg.Sync.Concurrency)

	for _, probeCfg := range probes {
		wg.Add(1)
		semaphore <- struct{}{} // Acquire semaphore

		go func(probeCfg config.ProbeConfig) {
			defer wg.Done()
			defer func() { <-semaphore }() // Release semaphore

			probeLogger := logger.With("probe", probeCfg.Name)

			// Filter monitors for this probe (if tags/types specified)
			filteredMonitors := filterMonitorsForProbe(masterMonitors, probeCfg)

			// Get or create mapping for this probe
			mapping := mappingStore.GetMapping(probeCfg.Name)

			// Sync to probe
			stats, err := syncToProbe(ctx, probeCfg, filteredMonitors, reconciler, mapping, probeLogger, cfg.Sync)
			if err != nil {
				probeLogger.Error("sync failed", "error", err)
				return
			}

			probeLogger.Info("probe sync complete",
				"creates", stats.Creates,
				"updates", stats.Updates,
				"deletes", stats.Deletes,
				"errors", stats.Errors,
			)

			// Track successful sync for selective mapping persistence
			successMu.Lock()
			successProbes = append(successProbes, probeCfg.Name)
			successMu.Unlock()
		}(probeCfg)
	}

	wg.Wait()

	// Only save mappings for probes that synced successfully
	for _, probeName := range successProbes {
		if err := mappingStore.SaveMapping(probeName); err != nil {
			logger.Error("failed to save mapping", "probe", probeName, "error", err)
		}
	}

	elapsed := time.Since(startTime)
	logger.Info("sync cycle complete", "duration", elapsed.Round(time.Millisecond))
}

// syncToProbe performs synchronization to a single probe.
func syncToProbe(
	ctx context.Context,
	probeCfg config.ProbeConfig,
	masterMonitors map[int64]*db.Monitor,
	reconciler *isync.Reconciler,
	mapping *isync.IDMapping,
	logger *slog.Logger,
	syncCfg config.SyncConfig,
) (*isync.SyncStats, error) {
	// Create Kuma client
	kumaClient := client.NewKumaClient(probeCfg.Endpoint, probeCfg.Username, probeCfg.Password)

	// Connect with timeout
	connectCtx, cancel := context.WithTimeout(ctx, syncCfg.OperationTimeout)
	defer cancel()

	if err := kumaClient.Connect(connectCtx); err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer kumaClient.Disconnect()

	logger.Debug("connected to probe")

	// Login
	if err := kumaClient.Login(connectCtx); err != nil {
		return nil, fmt.Errorf("failed to login: %w", err)
	}

	logger.Debug("authenticated with probe")

	// Create sync-level timeout: ensures the entire sync finishes before next cycle.
	// Cap at 4 minutes or interval-30s, whichever is smaller.
	syncTimeout := syncCfg.Interval - 30*time.Second
	if syncTimeout > 4*time.Minute {
		syncTimeout = 4 * time.Minute
	}
	if syncTimeout < 1*time.Minute {
		syncTimeout = 1 * time.Minute
	}
	syncCtx, syncCancel := context.WithTimeout(ctx, syncTimeout)
	defer syncCancel()

	// Get current monitors from probe
	probeMonitors, err := kumaClient.GetMonitorList(syncCtx)
	if err != nil {
		return nil, fmt.Errorf("failed to get monitor list: %w", err)
	}

	logger.Debug("fetched monitors from probe", "count", len(probeMonitors))

	// Compute sync plan
	plans := reconciler.ComputeSyncPlan(masterMonitors, probeMonitors, mapping)
	reconciler.LogSyncPlan(plans)

	if len(plans) == 0 {
		logger.Info("probe is in sync, no changes needed")
		return &isync.SyncStats{}, nil
	}

	// Execute sync plan
	return reconciler.ExecuteSyncPlan(syncCtx, kumaClient, plans, mapping, syncCfg.DryRun)
}

// filterMonitorsForProbe filters monitors based on probe-specific tags/types configuration.
func filterMonitorsForProbe(monitors map[int64]*db.Monitor, probeCfg config.ProbeConfig) map[int64]*db.Monitor {
	result := monitors

	// Filter by types if specified
	if len(probeCfg.Types) > 0 {
		result = isync.FilterMonitorsByTypes(result, probeCfg.Types)
	}

	// Note: Tag filtering would require fetching monitor_tag associations from the master DB
	// For now, we sync all monitors to all probes (as per requirements)

	return result
}
