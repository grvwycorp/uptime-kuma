# Iris Metrics Reference

This document catalogs all metrics emitted by Iris probes via OTLP, covering both the original **Outcome Metrics** (target health) and the newer **Usage & Performance Metrics** (probe operational health).

## Label Cardinality Strategy

All high-frequency metrics use only low-cardinality labels:

| Label | Source | Cardinality |
|-------|--------|-------------|
| `probe_id` | Persistent UUID from `server/lib/identity.js` | N_probes |
| `monitor_id` | SQLite auto-increment (outcome metrics only) | N_monitors/probe |
| `monitor_type` | Enum: http, tcp, dns, ping, etc. (23 values) | ~23 |
| `status` | Enum: up, down, pending, maintenance | 4 |
| `error_category` | Enum: 10 values (see below) | 10 |
| `provider_type` | Notification provider name (slack, smtp, etc.) | ~5 per deployment |
| `result` | Enum: success, failure | 2 |

High-cardinality attributes (URL, name, hostname, tags) are stored in the `monitor_info` gauge and joined at query time.

---

## Outcome Metrics (Target Health)

These describe the condition of the monitored target. Defined in `server/lib/metrics.js`.

| Metric | Type | Unit | Labels | Description |
|--------|------|------|--------|-------------|
| `monitor_up` | Gauge | 1 | probe_id, monitor_id, monitor_type | Binary availability (1=UP, 0=DOWN) |
| `monitor_status` | Gauge | 1 | probe_id, monitor_id, monitor_type | Detailed status (1=UP, 0=DOWN, 2=PENDING, 3=MAINTENANCE) |
| `monitor_response_time` | Gauge | ms | probe_id, monitor_id, monitor_type | Last check response time |
| `monitor_timing_dns` | Gauge | ms | probe_id, monitor_id, monitor_type | DNS lookup time |
| `monitor_timing_tcp` | Gauge | ms | probe_id, monitor_id, monitor_type | TCP handshake time |
| `monitor_timing_tls` | Gauge | ms | probe_id, monitor_id, monitor_type | TLS handshake time |
| `monitor_cert_days_remaining` | Gauge | d | probe_id, monitor_id, monitor_type | Days until certificate expires |
| `monitor_cert_is_valid` | Gauge | 1 | probe_id, monitor_id, monitor_type | Certificate validity (1/0) |
| `monitor_info` | Gauge | 1 | probe_id, monitor_id, monitor_type, monitor_name, monitor_url, monitor_hostname, monitor_port, tags, service | Metadata for label joins (always value=1) |

---

## Usage & Performance Metrics (Probe Health)

These describe the probe's operational behavior. Defined in `server/lib/metrics.js`, instrumented in `server/model/monitor.js` and `server/server.js`.

### iris_check_total (Counter)

Total check executions. The fundamental throughput signal.

- **Labels**: `probe_id`, `monitor_type`, `status`
- **Instrumentation**: `server/model/monitor.js` — inside `beat()`, after `bean.retries = retries` and before `isImportant` check. At this point `bean.status` is finalized for both success and error paths.

### iris_check_duration_seconds (Histogram)

Full beat cycle wall-clock cost, including DB writes, socket emit, and Prometheus update. Distinct from target response time (`monitor_response_time`).

- **Labels**: `probe_id`, `monitor_type`
- **Buckets**: 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30
- **Instrumentation**: `server/model/monitor.js` — `process.hrtime.bigint()` captured at `beat()` start, recorded after `prometheus.update()`. Also recorded in `safeBeat()` catch block for crashed beats.

### iris_check_error_total (Counter)

Check failures categorized into low-cardinality buckets.

- **Labels**: `probe_id`, `monitor_type`, `error_category`
- **Instrumentation**: `server/model/monitor.js` — inside the `catch(error)` block of `beat()`, after `bean.msg` is set. Uses `classifyError()` from `server/lib/metrics.js`.

### iris_scheduler_drift_seconds (Histogram)

How late each check fires relative to its expected schedule. Positive drift indicates event loop saturation.

- **Labels**: `probe_id`, `monitor_type`
- **Buckets**: 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30, 60
- **Instrumentation**: `server/model/monitor.js` — after `intervalRemainingMs` is computed but before `setTimeout(safeBeat, ...)`. Drift = `max(0, actualElapsed - intendedInterval)`.

### iris_notification_send_total (Counter)

Notification dispatch attempts with success/failure outcome.

- **Labels**: `probe_id`, `provider_type`, `result`
- **Instrumentation**: `server/model/monitor.js` — inside `Monitor.sendNotification()` loop, after `Notification.send()` succeeds or fails.

### iris_monitor_active_count (Observable Gauge)

Number of active monitors per probe and type. Updated every 15 seconds via periodic scan of `server.monitorList`.

- **Labels**: `probe_id`, `monitor_type`
- **Instrumentation**: `server/server.js` — `setInterval` after `startMonitors()` calls `irisMetrics.updateActiveMonitors()`.

---

## Error Categorization Scheme

The `classifyError()` function in `server/lib/metrics.js` maps errors to these categories using priority-ordered pattern matching:

| error_category | Trigger Patterns |
|----------------|------------------|
| `timeout` | `CanceledError` name, message contains "timeout" |
| `connection_refused` | `ECONNREFUSED` error code |
| `dns_resolution` | `ENOTFOUND`, `EAI_AGAIN` codes; message contains NXDOMAIN, SERVFAIL, NODATA |
| `tls_certificate` | `ERR_TLS_*` codes, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; message contains "certificate" or "ssl error" |
| `http_client_error` | `error.response.status` 400-499 |
| `http_server_error` | `error.response.status` 500+ |
| `authentication` | Message matches oauth, unauthorized, forbidden, authentication, password, credential |
| `content_mismatch` | Message matches keyword, JSON query, Message Mismatch, expected value, does not pass |
| `database_error` | Monitor type is postgres/mysql/mongodb/redis/mssql and no higher-priority match |
| `unknown` | Fallback for all unclassified errors |

---

## PromQL Query Cookbook

### Check throughput per probe
```promql
sum by (probe_id, monitor_type) (rate(iris_check_total[5m]))
```
Is every probe pulling its weight? Has a probe silently stopped checking?

### P99 beat cycle duration by type
```promql
histogram_quantile(0.99,
  sum by (monitor_type, le) (rate(iris_check_duration_seconds_bucket[5m]))
)
```
Are real-browser checks monopolizing the event loop? Is DB write latency spiking?

### Top error categories (fleet-wide, last hour)
```promql
topk(5, sum by (error_category) (increase(iris_check_error_total[1h])))
```
Wave of DNS failures? Certificate expiry causing cluster-wide TLS errors?

### Timeout vs DNS failure ratio
```promql
sum(rate(iris_check_error_total{error_category="timeout"}[1h]))
/
sum(rate(iris_check_error_total{error_category="dns_resolution"}[1h]))
```
What percentage of failures are timeouts vs DNS issues?

### Overloaded probes (>5% of checks drifting >2s late)
```promql
(
  sum by (probe_id) (rate(iris_scheduler_drift_seconds_bucket{le="2"}[10m]))
  /
  sum by (probe_id) (rate(iris_scheduler_drift_seconds_count[10m]))
) < 0.95
```
Which probes need more capacity or fewer monitors?

### Notification failure rate by provider
```promql
sum by (provider_type) (rate(iris_notification_send_total{result="failure"}[1h]))
/
sum by (provider_type) (rate(iris_notification_send_total[1h]))
```
Is our Slack webhook broken? Are PagerDuty alerts actually being delivered?

### Fleet monitor distribution balance
```promql
sum by (probe_id) (iris_monitor_active_count)
/ scalar(
  sum(iris_monitor_active_count)
  / count(count by (probe_id) (iris_monitor_active_count))
)
```
Is one probe overloaded while others idle? (ratio >1 = above average, <1 = below average)

### Error rate by monitor type
```promql
sum by (monitor_type) (rate(iris_check_error_total[5m]))
/
sum by (monitor_type) (rate(iris_check_total[5m]))
```
Which monitor types have the highest failure rates?

---

## Cardinality Analysis

Worst-case series counts per metric:

| Metric | Formula | Example (5 probes, 23 types) |
|--------|---------|------------------------------|
| `iris_check_total` | probes x types x 4 statuses | 460 |
| `iris_check_duration_seconds` | probes x types x 12 (buckets+count+sum) | 1,380 |
| `iris_check_error_total` | probes x types x 10 categories | 1,150 |
| `iris_scheduler_drift_seconds` | probes x types x 12 | 1,380 |
| `iris_notification_send_total` | probes x ~5 providers x 2 results | 50 |
| `iris_monitor_active_count` | probes x types | 115 |

**Total worst-case**: ~4,535 series. In practice much lower since most probes use 3-5 monitor types and 2-3 notification providers.

---

## Implementation Files

| File | Role |
|------|------|
| `server/lib/metrics.js` | All metric instrument definitions, `classifyError()`, fleet label builder |
| `server/model/monitor.js` | Instrumentation points in `beat()`, `safeBeat()`, `sendNotification()` |
| `server/server.js` | Active monitor count periodic updater |
| `server/otel.js` | OTEL SDK initialization (MeterProvider, exporter, resource attributes) |
| `server/prometheus.js` | Legacy Prometheus integration (outcome metrics via prom-client) |
