# iris-sync

A Go service that synchronizes monitors from a Master MariaDB database to distributed Uptime Kuma probe nodes via Socket.IO.

## Architecture

```
[Master: MariaDB] --(SQL Query)--> [iris-sync] --(Socket.IO)--> [Probe: Uptime Kuma]
                                        |
                                        +-- Reconciliation Engine (Create/Update/Delete)
```

## Features

- **Delta Sync**: Only creates, updates, or deletes monitors that have changed
- **Hash-based Change Detection**: Uses SHA256 hashing of monitor configs for efficient diffing
- **ID Mapping**: Maintains mapping between master and probe monitor IDs to preserve heartbeat history
- **Concurrent Sync**: Syncs to multiple probes in parallel
- **Dry Run Mode**: Preview changes without executing them
- **Persistent Mappings**: Stores ID mappings to disk for recovery across restarts

## Installation

```bash
# Build from source
cd iris-sync
go build -o iris-sync ./cmd/iris-sync

# Or install directly
go install ./cmd/iris-sync
```

## Configuration

Create a `config.yaml` file:

```yaml
master:
  host: "master-mariadb.tailnet"
  port: 3306
  database: "uptime_kuma"
  username: "iris_sync"
  password: "changeme"
  # Or use password file for secrets
  # password_file: "/run/secrets/master_password"

probes:
  - name: "probe-01"
    endpoint: "http://100.64.0.10:3001"
    username: "admin"
    password: "changeme"
    enabled: true

  - name: "probe-02"
    endpoint: "http://100.64.0.11:3001"
    username: "admin"
    password: "changeme"
    enabled: true

sync:
  interval: 5m
  concurrency: 3
  operation_timeout: 30s
  delete_orphans: true
  dry_run: false

logging:
  level: info
  format: json
```

## Usage

```bash
# Run continuous sync (default)
./iris-sync --config config.yaml

# Run once and exit
./iris-sync --config config.yaml --once

# Dry run - preview changes without executing
./iris-sync --config config.yaml --dry-run

# Enable verbose logging
./iris-sync --config config.yaml --verbose
```

## How It Works

### Reconciliation Algorithm

1. **Fetch Desired State**: Query all active monitors from Master MariaDB
2. **Fetch Current State**: Get monitor list from Probe via Socket.IO `getMonitorList`
3. **Compute Diff**:
   - If monitor exists in Master but not Probe → **CREATE**
   - If monitor exists in both but config hash differs → **UPDATE**
   - If monitor exists in Probe but not Master → **DELETE** (if `delete_orphans: true`)
4. **Execute Plan**: Apply changes via Socket.IO `add`, `editMonitor`, `deleteMonitor`

### ID Mapping

Since Master and Probe have independent auto-increment IDs, iris-sync maintains a bidirectional mapping:

- `master_id → probe_id`
- `probe_id → master_id`

This ensures:
- Updates target the correct monitor on the probe
- Heartbeat history is preserved (probe IDs don't change)
- Mappings persist across restarts (stored in `./data/mappings/`)

### Change Detection

Rather than comparing all 100+ monitor fields, iris-sync:
1. Computes SHA256 hash of the entire monitor configuration
2. Stores hash alongside the ID mapping
3. Only triggers update if hash has changed

## Project Structure

```
iris-sync/
├── cmd/iris-sync/main.go           # Entry point
├── internal/
│   ├── config/config.go            # YAML configuration
│   ├── db/
│   │   ├── mariadb.go              # MariaDB queries
│   │   └── models.go               # Monitor struct
│   ├── client/kuma.go              # Socket.IO client
│   └── sync/
│       ├── reconciler.go           # Diff algorithm
│       └── mapper.go               # ID mapping
├── config.yaml                     # Example config
├── go.mod
└── README.md
```

## Socket.IO API Reference

iris-sync uses these Uptime Kuma Socket.IO events:

| Event | Purpose |
|-------|---------|
| `login` | Authenticate with username/password |
| `getMonitorList` | Fetch all monitors |
| `add` | Create new monitor |
| `editMonitor` | Update existing monitor |
| `deleteMonitor` | Remove monitor |

## License

MIT
