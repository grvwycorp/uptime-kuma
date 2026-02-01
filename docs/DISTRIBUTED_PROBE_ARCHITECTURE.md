# Distributed Uptime-Kuma Probe Fleet Architecture

## Overview

This document outlines the architecture and implementation plan for building a distributed fleet of uptime-kuma probes. The system consists of a central management instance that handles UI/CRUD operations, with multiple geographically distributed probes executing the actual monitoring checks.

## Goals

- Central uptime-kuma instance for configuration management (UI-only, no monitoring)
- Multiple probe instances running actual checks from different locations
- Centralized data storage in MariaDB
- OpenTelemetry integration for observability
- Secure networking via Tailscale mesh

## Available Infrastructure

| Node | Location | Role | Specs |
|------|----------|------|-------|
| VPS #1 | Cloud | Central (web + db + otel) | TBD |
| VPS #2 | Cloud | Probe | TBD |
| Debianbook | Local | Probe | Debian laptop |
| WSL2/Docker | Local | Development + Probe | Windows PC |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CENTRAL NODE (VPS #1)                         │
│                                                                         │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│  │  uptime-kuma    │    │    MariaDB      │    │ otel-collector  │     │
│  │  (UI-only mode) │───▶│   (central)     │◀───│                 │     │
│  │  Port 3001      │    │   Port 3306     │    │  Port 4317      │     │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘     │
│           │                     ▲                                       │
│           │                     │                                       │
│           ▼                     │                                       │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │                     Sync Service (Go)                        │       │
│  │  - Reads config from MariaDB                                 │       │
│  │  - Pushes to probe SQLite databases                          │       │
│  │  - Collects heartbeats from probes                           │       │
│  │  - Writes aggregated results back to MariaDB                 │       │
│  └─────────────────────────────────────────────────────────────┘       │
│                                │                                        │
└────────────────────────────────│────────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │     Tailscale Mesh      │
                    │   (Private Network)     │
                    └────────────┬────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│    PROBE 1      │    │    PROBE 2      │    │    PROBE 3      │
│    (VPS #2)     │    │  (Debianbook)   │    │    (WSL2)       │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │ uptime-kuma │ │    │ │ uptime-kuma │ │    │ │ uptime-kuma │ │
│ │   + SQLite  │ │    │ │   + SQLite  │ │    │ │   + SQLite  │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
│                 │    │                 │    │                 │
│ probe_id: vps2  │    │ probe_id: deb1  │    │ probe_id: wsl1  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Data Flow

### Configuration Flow (Central → Probes)

```
1. Admin creates/updates monitor in central UI
2. Central uptime-kuma writes to MariaDB
3. Sync service detects change (polling or webhook)
4. Sync service pushes config to each probe's SQLite
5. Probe's uptime-kuma picks up new/updated monitors
```

### Heartbeat Flow (Probes → Central)

```
1. Probe executes monitoring check
2. Probe writes heartbeat to local SQLite
3. Sync service collects heartbeats from probe (batch, every 30-60s)
4. Sync service writes heartbeats to central MariaDB with probe_id
5. Central UI displays aggregated results from all probes
```

## Database Schema Modifications

### Tables to Sync (Central → Probes)

These tables contain configuration and must be replicated to probes:

| Table | Description | Sync Strategy |
|-------|-------------|---------------|
| `monitor` | Monitor definitions | Full sync on change |
| `notification` | Alert destinations | Full sync on change |
| `monitor_notification` | Monitor↔notification links | Full sync on change |
| `tag` | Monitor tags | Full sync on change |
| `monitor_tag` | Monitor↔tag links | Full sync on change |
| `group` | Monitor groups | Full sync on change |
| `monitor_group` | Monitor↔group links | Full sync on change |
| `maintenance` | Maintenance windows | Full sync on change |
| `monitor_maintenance` | Monitor↔maintenance links | Full sync on change |
| `proxy` | HTTP proxy configs | Full sync on change |
| `docker_host` | Docker monitoring configs | Full sync on change |
| `user` | User accounts | Full sync on change |
| `setting` | Global settings | Full sync on change |

### Tables Generated on Probes

These tables are created by probes and synced back to central:

| Table | Description | Sync Strategy |
|-------|-------------|---------------|
| `heartbeat` | Individual check results | Batch upload every 30-60s |
| `stat_minutely` | Minute aggregates | Batch upload every 5 min |
| `stat_hourly` | Hour aggregates | Batch upload hourly |
| `stat_daily` | Day aggregates | Batch upload daily |

### Schema Additions

#### Central MariaDB

```sql
-- Add probe tracking to heartbeat table
ALTER TABLE heartbeat ADD COLUMN probe_id VARCHAR(50) DEFAULT NULL;
CREATE INDEX idx_heartbeat_probe ON heartbeat(probe_id, monitor_id, time);

-- Add probe assignment to monitors (optional - for selective probe routing)
ALTER TABLE monitor ADD COLUMN assigned_probes JSON DEFAULT NULL;
-- Example: ["vps2", "deb1"] or NULL for all probes

-- Add sync tracking
CREATE TABLE sync_state (
    id INT PRIMARY KEY AUTO_INCREMENT,
    probe_id VARCHAR(50) NOT NULL,
    table_name VARCHAR(100) NOT NULL,
    last_sync_at DATETIME NOT NULL,
    last_sync_version BIGINT DEFAULT 0,
    UNIQUE KEY uk_probe_table (probe_id, table_name)
);

-- Add change tracking for config tables
ALTER TABLE monitor ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE notification ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
-- (repeat for other config tables)
```

#### Probe SQLite

```sql
-- Track sync state locally
CREATE TABLE IF NOT EXISTS probe_sync_state (
    table_name TEXT PRIMARY KEY,
    last_sync_at TEXT,
    last_sync_version INTEGER DEFAULT 0
);

-- Store probe identity
CREATE TABLE IF NOT EXISTS probe_config (
    key TEXT PRIMARY KEY,
    value TEXT
);
INSERT INTO probe_config (key, value) VALUES ('probe_id', 'vps2');
```

## Code Modifications

### 1. UI-Only Mode for Central

**File**: `server/server.js` (around line 1739)

```javascript
// Add environment variable check before starting monitors
async function startMonitors() {
    // New: Skip monitoring if running in UI-only mode
    if (process.env.UPTIME_KUMA_DISABLE_MONITORING === "1") {
        log.info("server", "Monitoring disabled (UI-only mode)");
        return;
    }

    // Existing code...
    let list = await R.find("monitor", " active = 1 ");
    // ...
}
```

### 2. Probe Identification

**File**: `server/model/monitor.js` (in the beat function)

```javascript
// Add probe_id to heartbeat records
bean.probe_id = process.env.UPTIME_KUMA_PROBE_ID || null;
```

### 3. Heartbeat API Endpoint (for sync service)

**File**: `server/routers/api-router.js` (new endpoint)

```javascript
// GET /api/probe/heartbeats?since=<timestamp>&limit=1000
router.get("/probe/heartbeats", async (req, res) => {
    // Return heartbeats since timestamp for sync service to collect
});

// POST /api/probe/sync-config
router.post("/probe/sync-config", async (req, res) => {
    // Receive config push from sync service
});
```

## Sync Service Design

### Technology Choice: Go

**Rationale**:
- Single binary deployment
- Excellent concurrency for managing multiple probes
- Strong typing for database operations
- Low resource footprint

### Core Components

```
sync-service/
├── cmd/
│   └── sync-service/
│       └── main.go           # Entry point
├── internal/
│   ├── config/
│   │   └── config.go         # Configuration loading
│   ├── central/
│   │   └── mariadb.go        # Central MariaDB client
│   ├── probe/
│   │   ├── client.go         # Probe API client
│   │   └── sqlite.go         # Direct SQLite access (if needed)
│   ├── sync/
│   │   ├── config_sync.go    # Config push logic
│   │   ├── heartbeat_sync.go # Heartbeat collection logic
│   │   └── scheduler.go      # Sync scheduling
│   └── models/
│       └── models.go         # Shared data structures
├── go.mod
└── go.sum
```

### Sync Service Configuration

```yaml
# sync-service.yaml
central:
  mariadb:
    host: localhost
    port: 3306
    database: uptime_kuma
    username: sync_user
    password: ${SYNC_DB_PASSWORD}

probes:
  - id: vps2
    tailscale_ip: 100.x.x.x
    api_url: http://100.x.x.x:3001
    api_key: ${PROBE_VPS2_API_KEY}
  - id: deb1
    tailscale_ip: 100.x.x.y
    api_url: http://100.x.x.y:3001
    api_key: ${PROBE_DEB1_API_KEY}
  - id: wsl1
    tailscale_ip: 100.x.x.z
    api_url: http://100.x.x.z:3001
    api_key: ${PROBE_WSL1_API_KEY}

sync:
  config_interval: 60s      # Check for config changes every 60s
  heartbeat_interval: 30s   # Collect heartbeats every 30s
  batch_size: 1000          # Max heartbeats per batch

otel:
  endpoint: localhost:4317
  service_name: uptime-kuma-sync
```

### Sync Service Pseudocode

```go
func main() {
    // Initialize connections
    centralDB := connectMariaDB(config.Central)
    probeClients := initProbeClients(config.Probes)

    // Start sync loops
    go configSyncLoop(centralDB, probeClients)
    go heartbeatCollectLoop(centralDB, probeClients)

    // Wait for shutdown
    waitForShutdown()
}

func configSyncLoop(central *sql.DB, probes []ProbeClient) {
    ticker := time.NewTicker(config.Sync.ConfigInterval)
    for range ticker.C {
        // Get latest config version
        version := getLatestConfigVersion(central)

        for _, probe := range probes {
            if probe.NeedsSync(version) {
                config := fetchConfig(central)
                probe.PushConfig(config)
                probe.UpdateSyncState(version)
            }
        }
    }
}

func heartbeatCollectLoop(central *sql.DB, probes []ProbeClient) {
    ticker := time.NewTicker(config.Sync.HeartbeatInterval)
    for range ticker.C {
        for _, probe := range probes {
            heartbeats := probe.FetchHeartbeats(since: probe.LastCollect)
            if len(heartbeats) > 0 {
                insertHeartbeats(central, heartbeats, probe.ID)
                probe.AckHeartbeats(heartbeats)
            }
        }
    }
}
```

## Docker Compose - Central Node

```yaml
# docker-compose.central.yml
version: "3.8"

services:
  mariadb:
    image: mariadb:10.11
    container_name: uptime-kuma-db
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      MYSQL_DATABASE: uptime_kuma
      MYSQL_USER: kuma
      MYSQL_PASSWORD: ${DB_PASSWORD}
    volumes:
      - mariadb_data:/var/lib/mysql
    networks:
      - kuma-network
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 10s
      timeout: 5s
      retries: 3

  uptime-kuma:
    image: louislam/uptime-kuma:2
    container_name: uptime-kuma-central
    restart: unless-stopped
    environment:
      UPTIME_KUMA_DB_TYPE: mariadb
      UPTIME_KUMA_DB_HOSTNAME: mariadb
      UPTIME_KUMA_DB_PORT: 3306
      UPTIME_KUMA_DB_NAME: uptime_kuma
      UPTIME_KUMA_DB_USERNAME: kuma
      UPTIME_KUMA_DB_PASSWORD: ${DB_PASSWORD}
      UPTIME_KUMA_DISABLE_MONITORING: "1"
    ports:
      - "3001:3001"
    depends_on:
      mariadb:
        condition: service_healthy
    networks:
      - kuma-network

  sync-service:
    build: ./sync-service
    container_name: uptime-kuma-sync
    restart: unless-stopped
    environment:
      SYNC_DB_PASSWORD: ${DB_PASSWORD}
      PROBE_VPS2_API_KEY: ${PROBE_VPS2_API_KEY}
      PROBE_DEB1_API_KEY: ${PROBE_DEB1_API_KEY}
      PROBE_WSL1_API_KEY: ${PROBE_WSL1_API_KEY}
    volumes:
      - ./sync-service.yaml:/app/config.yaml:ro
    depends_on:
      - mariadb
      - uptime-kuma
    networks:
      - kuma-network
      - tailscale  # Assumes tailscale network exists

  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    container_name: otel-collector
    restart: unless-stopped
    command: ["--config=/etc/otel-collector-config.yaml"]
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml:ro
    ports:
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP
      - "8888:8888"   # Prometheus metrics
    networks:
      - kuma-network

volumes:
  mariadb_data:

networks:
  kuma-network:
    driver: bridge
  tailscale:
    external: true
```

## Docker Compose - Probe Node

```yaml
# docker-compose.probe.yml
version: "3.8"

services:
  uptime-kuma:
    image: louislam/uptime-kuma:2
    container_name: uptime-kuma-probe
    restart: unless-stopped
    environment:
      UPTIME_KUMA_PROBE_ID: ${PROBE_ID}  # e.g., "vps2", "deb1", "wsl1"
    ports:
      - "3001:3001"
    volumes:
      - uptime-kuma-data:/app/data

volumes:
  uptime-kuma-data:
```

## Implementation Phases

### Phase 1: Infrastructure Setup

**Duration**: 1-2 days

- [ ] Install Tailscale on all 4 machines
- [ ] Verify Tailscale mesh connectivity between all nodes
- [ ] Set up GitHub organization and runners
- [ ] Create base Docker images repository

### Phase 2: Central Node Deployment

**Duration**: 1-2 days

- [ ] Deploy MariaDB on VPS #1
- [ ] Deploy uptime-kuma on VPS #1 (standard mode first)
- [ ] Test MariaDB connectivity and create test monitors
- [ ] Deploy otel-collector
- [ ] Configure otel-collector to receive metrics

### Phase 3: UI-Only Mode Implementation

**Duration**: 1 day

- [ ] Fork/branch uptime-kuma repository
- [ ] Add `UPTIME_KUMA_DISABLE_MONITORING` environment variable support
- [ ] Add `probe_id` column to heartbeat table
- [ ] Add `updated_at` columns for change tracking
- [ ] Test UI-only mode

### Phase 4: Probe Deployment

**Duration**: 1-2 days

- [ ] Deploy uptime-kuma probe on VPS #2
- [ ] Deploy uptime-kuma probe on Debianbook
- [ ] Deploy uptime-kuma probe on WSL2
- [ ] Verify each probe can execute monitors independently
- [ ] Add `UPTIME_KUMA_PROBE_ID` support to heartbeat records

### Phase 5: Sync Service Development

**Duration**: 3-5 days

- [ ] Set up Go project structure
- [ ] Implement central MariaDB client
- [ ] Implement probe API client
- [ ] Implement config sync logic
- [ ] Implement heartbeat collection logic
- [ ] Add error handling and retries
- [ ] Add OpenTelemetry instrumentation
- [ ] Write tests

### Phase 6: Integration Testing

**Duration**: 2-3 days

- [ ] Test config sync from central to all probes
- [ ] Test heartbeat collection from all probes
- [ ] Test failure scenarios (probe offline, network partition)
- [ ] Test maintenance window propagation
- [ ] Test notification delivery from probes
- [ ] Load testing with realistic monitor count

### Phase 7: Production Hardening

**Duration**: 2-3 days

- [ ] Set up monitoring for the monitoring system (meta!)
- [ ] Configure alerting for sync service failures
- [ ] Document runbooks for common issues
- [ ] Set up automated backups for central MariaDB
- [ ] Configure log aggregation

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Sync service single point of failure | High | Run multiple instances, use leader election |
| Probe loses connectivity | Medium | Probes work independently; queue heartbeats locally |
| Central DB corruption | High | Regular backups, MariaDB replication |
| Clock skew between nodes | Medium | NTP on all nodes, use relative timestamps |
| Tailscale connectivity issues | Medium | Fallback to public IPs if needed |
| Config sync race conditions | Low | Use versioning, idempotent operations |

## Future Enhancements

1. **Selective probe routing**: Assign specific monitors to specific probes
2. **Probe health dashboard**: Monitor probe status from central UI
3. **Automatic probe discovery**: New probes register themselves
4. **Heartbeat deduplication**: Handle duplicate checks gracefully
5. **Geographic aggregation**: Show results grouped by probe location
6. **Probe-specific notifications**: Alert based on probe-specific results

## References

- Uptime-kuma repository: https://github.com/louislam/uptime-kuma
- Tailscale documentation: https://tailscale.com/kb/
- OpenTelemetry Collector: https://opentelemetry.io/docs/collector/
- MariaDB documentation: https://mariadb.com/kb/en/documentation/
