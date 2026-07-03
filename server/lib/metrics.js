/**
 * Metrics Enforcer Module for Iris
 *
 * This module enforces label hygiene to prevent cardinality explosion.
 * High-cardinality labels (url, name, tags, hostname) are stripped from
 * high-frequency metrics and stored in a separate monitor_info metric
 * that can be joined at query time.
 *
 * Label Strategy:
 * - ALLOWED on high-freq metrics: probe_id, monitor_id, monitor_type
 * - STRIPPED to monitor_info: monitor_name, monitor_url, monitor_hostname, monitor_port, tags
 *
 * Usage:
 *   const metrics = require("./lib/metrics");
 *   await metrics.init();
 *
 *   // Record a check result
 *   metrics.recordCheck({
 *     monitorId: 123,
 *     monitorType: "http",
 *     status: 1,
 *     responseTime: 142,
 *     timings: { dns: 12, tcp: 23, tls: 45 }
 *   });
 *
 *   // Update monitor info (call when monitor is created/updated)
 *   metrics.recordMonitorInfo(123, {
 *     name: "API Health",
 *     url: "https://api.example.com/health",
 *     hostname: "api.example.com",
 *     port: 443,
 *     type: "http",
 *     tags: ["production", "critical"]
 *   });
 */
const { log } = require("../../src/util");
const otel = require("../otel");

// Label allowlist for high-frequency metrics
const ALLOWED_LABELS = new Set([
    "probe_id",
    "monitor_id",
    "monitor_type",
]);

// Monitor types that don't perform actual network checks.
// These produce synthetic response times (check() overhead) not real latencies,
// so they are excluded from all metrics to avoid noise.
const NON_NETWORK_TYPES = new Set([
    "group",    // Aggregates child monitor status, no outbound request
    "push",     // Waits for external heartbeat push, no outbound request
    "manual",   // Manually set status, no outbound request
]);

// Error category enum for classifyError()
const ERROR_CATEGORIES = [
    "timeout", "connection_refused", "dns_resolution",
    "tls_certificate", "http_client_error", "http_server_error",
    "authentication", "content_mismatch", "database_error", "unknown",
];

// Monitor types whose errors map to "database_error" by default
const DB_MONITOR_TYPES = new Set([
    "postgres", "mysql", "mongodb", "redis", "mssql",
]);

// Metric storage for observable gauges
const metricValues = new Map();

// Storage for active monitor counts (observable gauge)
const activeMonitorCounts = new Map();

// Gauge instruments (observable / pull-based)
let gauges = {};

// Counter and Histogram instruments (push-based)
let counters = {};
let histograms = {};

let initialized = false;
let probeId = null;

/**
 * Initialize the metrics module.
 * Must be called after otel.init() and identity initialization.
 * @returns {Promise<void>}
 */
async function init() {
    if (initialized) {
        log.debug("metrics", "Metrics already initialized");
        return;
    }

    if (!otel.isEnabled()) {
        log.info("metrics", "OTEL not enabled, metrics module in pass-through mode");
        initialized = true;
        return;
    }

    const meter = otel.getMeter();
    if (!meter) {
        log.warn("metrics", "No meter available, metrics module disabled");
        initialized = true;
        return;
    }

    // Get probe ID for labeling
    const { getProbeIdSync } = require("./identity");
    probeId = getProbeIdSync();

    if (!probeId) {
        log.warn("metrics", "Probe ID not available, metrics will not include probe_id label");
    }

    // Create Observable Gauges
    // These are "pull-based" - OTEL calls our callback when exporting

    // Core availability metrics
    gauges.monitorUp = meter.createObservableGauge("monitor_up", {
        description: "Monitor availability (1=UP, 0=DOWN)",
        unit: "1",
    });

    gauges.monitorStatus = meter.createObservableGauge("monitor_status", {
        description: "Monitor status (1=UP, 0=DOWN, 2=PENDING, 3=MAINTENANCE)",
        unit: "1",
    });

    // Response time (total)
    gauges.monitorResponseTime = meter.createObservableGauge("monitor_response_time", {
        description: "Total response time",
        unit: "ms",
    });

    // Timing decomposition
    gauges.monitorTimingDns = meter.createObservableGauge("monitor_timing_dns", {
        description: "DNS lookup time",
        unit: "ms",
    });

    gauges.monitorTimingTcp = meter.createObservableGauge("monitor_timing_tcp", {
        description: "TCP handshake time",
        unit: "ms",
    });

    gauges.monitorTimingTls = meter.createObservableGauge("monitor_timing_tls", {
        description: "TLS handshake time",
        unit: "ms",
    });

    // Certificate metrics
    gauges.monitorCertDaysRemaining = meter.createObservableGauge("monitor_cert_days_remaining", {
        description: "Days until certificate expires",
        unit: "d",
    });

    gauges.monitorCertIsValid = meter.createObservableGauge("monitor_cert_is_valid", {
        description: "Certificate validity (1=Valid, 0=Invalid)",
        unit: "1",
    });

    // Info metric for stripped labels (low frequency)
    gauges.monitorInfo = meter.createObservableGauge("monitor_info", {
        description: "Monitor metadata for label joins",
        unit: "1",
    });

    // Target geo info metric for label joins (low frequency)
    gauges.targetGeoInfo = meter.createObservableGauge("target_geo_info", {
        description: "Target IP geolocation metadata for label joins",
        unit: "1",
    });

    // Mesh health
    gauges.meshMasterLatency = meter.createObservableGauge("mesh_master_latency_ms", {
        description: "Latency to master node via Tailscale",
        unit: "ms",
    });

    gauges.meshMasterConnected = meter.createObservableGauge("mesh_master_connected", {
        description: "Connection status to master (1=connected, 0=disconnected)",
        unit: "1",
    });

    // --- Usage & Performance Metrics (push-based) ---

    // Counters
    counters.checkTotal = meter.createCounter("iris_check_total", {
        description: "Total number of check executions",
        unit: "{check}",
    });

    counters.checkErrorTotal = meter.createCounter("iris_check_error_total", {
        description: "Total number of check errors by category",
        unit: "{error}",
    });

    counters.notificationSendTotal = meter.createCounter("iris_notification_send_total", {
        description: "Total notification send attempts by provider and result",
        unit: "{notification}",
    });

    // Histograms
    histograms.checkDuration = meter.createHistogram("iris_check_duration_seconds", {
        description: "Full beat cycle duration including DB writes and socket emit",
        unit: "s",
        advice: {
            explicitBucketBoundaries: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
        },
    });

    histograms.schedulerDrift = meter.createHistogram("iris_scheduler_drift_seconds", {
        description: "How late each check fires relative to its expected schedule",
        unit: "s",
        advice: {
            explicitBucketBoundaries: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30, 60],
        },
    });

    // Observable gauge for active monitor count
    gauges.monitorActiveCount = meter.createObservableGauge("iris_monitor_active_count", {
        description: "Number of active monitors per probe and type",
        unit: "{monitor}",
    });

    // Register batch observable callback
    meter.addBatchObservableCallback((observableResult) => {
        // Existing outcome metric gauges
        for (const [, data] of metricValues) {
            const gauge = gauges[data.gaugeKey];
            if (gauge) {
                observableResult.observe(gauge, data.value, data.labels);
            }
        }

        // Active monitor counts
        for (const [, data] of activeMonitorCounts) {
            observableResult.observe(gauges.monitorActiveCount, data.value, data.labels);
        }
    }, Object.values(gauges));

    initialized = true;
    log.info("metrics", "Metrics enforcer initialized");
}

/**
 * Sanitize labels to only include allowed keys.
 * @param {object} rawLabels Raw label object
 * @returns {object} Sanitized labels with only allowed keys
 */
function sanitizeLabels(rawLabels) {
    const sanitized = {};

    for (const [key, value] of Object.entries(rawLabels)) {
        if (ALLOWED_LABELS.has(key)) {
            sanitized[key] = String(value);
        }
    }

    return sanitized;
}

/**
 * Build the base labels for a monitor.
 * @param {number|string} monitorId Monitor ID
 * @param {string} monitorType Monitor type (http, tcp, ping, etc.)
 * @returns {object} Base labels for metrics
 */
function buildBaseLabels(monitorId, monitorType) {
    const labels = {
        monitor_id: String(monitorId),
        monitor_type: String(monitorType || "unknown"),
    };

    if (probeId) {
        labels.probe_id = probeId;
    }

    return labels;
}

/**
 * Record a metric value internally.
 * @param {string} gaugeKey The gauge key in the gauges object
 * @param {string} metricKey Unique key for this metric+labels combo
 * @param {number} value The value
 * @param {object} labels The labels
 */
function recordValue(gaugeKey, metricKey, value, labels) {
    if (!initialized || !otel.isEnabled()) {
        return;
    }

    if (typeof value !== "number" || isNaN(value)) {
        return;
    }

    metricValues.set(metricKey, {
        gaugeKey,
        value,
        labels,
    });
}

/**
 * Record a check result with all available metrics.
 * @param {object} params Check parameters
 * @param {number|string} params.monitorId Monitor ID
 * @param {string} params.monitorType Monitor type
 * @param {number} params.status Status (0=DOWN, 1=UP, 2=PENDING, 3=MAINTENANCE)
 * @param {number} [params.responseTime] Total response time in ms
 * @param {object} [params.timings] Timing breakdown { dns, tcp, tls }
 * @param {object} [params.cert] Certificate info { daysRemaining, isValid }
 */
function recordCheck(params) {
    const { monitorId, monitorType, status, responseTime, timings, cert } = params;

    // Skip non-network monitor types entirely — their "response times"
    // are just check() computation overhead, not real network latencies
    if (NON_NETWORK_TYPES.has(monitorType)) {
        return;
    }

    const labels = buildBaseLabels(monitorId, monitorType);
    const labelKey = `${monitorId}:${monitorType}`;

    // monitor_up (binary)
    const isUp = status === 1 ? 1 : 0;
    recordValue("monitorUp", `up:${labelKey}`, isUp, labels);

    // monitor_status (detailed)
    recordValue("monitorStatus", `status:${labelKey}`, status, labels);

    // monitor_response_time
    if (typeof responseTime === "number" && responseTime >= 0) {
        recordValue("monitorResponseTime", `rt:${labelKey}`, responseTime, labels);
    }

    // Timing decomposition
    if (timings) {
        if (typeof timings.dns === "number" && timings.dns >= 0) {
            recordValue("monitorTimingDns", `dns:${labelKey}`, timings.dns, labels);
        }
        if (typeof timings.tcp === "number" && timings.tcp >= 0) {
            recordValue("monitorTimingTcp", `tcp:${labelKey}`, timings.tcp, labels);
        }
        if (typeof timings.tls === "number" && timings.tls >= 0) {
            recordValue("monitorTimingTls", `tls:${labelKey}`, timings.tls, labels);
        }
    }

    // Certificate metrics
    if (cert) {
        if (typeof cert.daysRemaining === "number") {
            recordValue("monitorCertDaysRemaining", `certDays:${labelKey}`, cert.daysRemaining, labels);
        }
        if (typeof cert.isValid === "boolean") {
            recordValue("monitorCertIsValid", `certValid:${labelKey}`, cert.isValid ? 1 : 0, labels);
        }
    }
}

/**
 * Record monitor info (metadata for joins).
 * Call this when a monitor is created or updated.
 * @param {number|string} monitorId Monitor ID
 * @param {object} metadata Monitor metadata
 * @param {string} metadata.name Monitor name
 * @param {string} [metadata.url] Monitor URL
 * @param {string} [metadata.hostname] Target hostname
 * @param {number|string} [metadata.port] Target port
 * @param {string} metadata.type Monitor type
 * @param {string[]} [metadata.tags] Tags array
 * @param {string} metadata.service Top-level ancestor group name (service)
 * @param {string} metadata.subService Immediate parent group name (sub_service)
 */
function recordMonitorInfo(monitorId, metadata) {
    if (!initialized || !otel.isEnabled()) {
        return;
    }

    // Skip non-network monitor types — they are organizational containers,
    // not real monitoring targets
    if (NON_NETWORK_TYPES.has(String(metadata.type))) {
        return;
    }

    const labels = {
        monitor_id: String(monitorId),
        monitor_name: String(metadata.name || ""),
        monitor_url: String(metadata.url || ""),
        monitor_hostname: String(metadata.hostname || ""),
        monitor_port: String(metadata.port || ""),
        monitor_type: String(metadata.type || "unknown"),
        tags: Array.isArray(metadata.tags) ? metadata.tags.join(",") : "",
        service: String(metadata.service || ""),
        sub_service: String(metadata.subService || ""),
    };

    // Include probe_id so the info metric can be joined per-probe
    // (monitor_id is local to each probe's database, not globally unique)
    if (probeId) {
        labels.probe_id = probeId;
    }

    recordValue("monitorInfo", `info:${monitorId}`, 1, labels);
}

/**
 * Record target geo info metric for Grafana label joins.
 * Low-frequency info metric carrying high-cardinality geo labels.
 * Always emits value 1, joined at query time via group_left.
 * @param {number|string} monitorId Monitor ID
 * @param {object} geoData Target geo data
 * @param {string} geoData.resolvedIp The resolved IP address
 * @param {number|null} geoData.lat Latitude
 * @param {number|null} geoData.lon Longitude
 * @param {string} geoData.country Country code (ISO 3166-1 alpha-2)
 * @param {string} geoData.city City name
 * @param {string} geoData.asn ASN string (e.g. "AS15169")
 */
function recordTargetGeo(monitorId, geoData) {
    if (!initialized || !otel.isEnabled()) {
        return;
    }

    const labels = {
        monitor_id: String(monitorId),
        target_ip: String(geoData.resolvedIp || ""),
        target_country: String(geoData.country || ""),
        target_city: String(geoData.city || ""),
        target_asn: String(geoData.asn || ""),
        target_lat: String(geoData.lat ?? ""),
        target_lon: String(geoData.lon ?? ""),
    };

    if (probeId) {
        labels.probe_id = probeId;
    }

    // Key includes probe_id to support per-probe anycast resolution
    recordValue("targetGeoInfo", `targetGeo:${probeId}:${monitorId}`, 1, labels);
}

/**
 * Record mesh health to master.
 * @param {number} latencyMs Latency to master in milliseconds
 * @param {boolean} connected Whether connection is established
 * @param {string} [connectionType] Connection type ("direct" or "derp")
 */
function recordMeshHealth(latencyMs, connected, connectionType = "unknown") {
    if (!initialized || !otel.isEnabled()) {
        return;
    }

    const labels = {};
    if (probeId) {
        labels.probe_id = probeId;
    }
    if (connectionType !== "unknown") {
        labels.connection_type = connectionType;
    }

    if (typeof latencyMs === "number" && latencyMs >= 0) {
        recordValue("meshMasterLatency", "mesh:latency", latencyMs, labels);
    }

    recordValue("meshMasterConnected", "mesh:connected", connected ? 1 : 0, labels);
}

/**
 * Remove all metrics for a monitor (when deleted).
 * @param {number|string} monitorId Monitor ID
 * @param {string} [monitorType] Monitor type
 */
function removeMonitor(monitorId, monitorType) {
    const labelKey = `${monitorId}:${monitorType || ""}`;

    // Remove all metrics with this monitor
    for (const key of metricValues.keys()) {
        if (key.includes(`:${monitorId}:`) || key.endsWith(`:${monitorId}`)) {
            metricValues.delete(key);
        }
    }
}

// --- Usage & Performance Metric Functions (push-based) ---

/**
 * Build labels for fleet-level metrics (no monitor_id).
 * @param {object} extraLabels Additional labels to include
 * @returns {object} Labels with probe_id + extras
 */
function buildFleetLabels(extraLabels) {
    const labels = {};
    if (probeId) {
        labels.probe_id = probeId;
    }
    Object.assign(labels, extraLabels);
    return labels;
}

/**
 * Increment the iris_check_total counter.
 * @param {string} monitorType Monitor type (http, tcp, ping, etc.)
 * @param {string} status Status enum: "up", "down", "pending", "maintenance"
 * @returns {void}
 */
function incrementCheckTotal(monitorType, status) {
    if (!initialized || !otel.isEnabled() || !counters.checkTotal) {
        return;
    }
    // Skip non-network types (group/push/manual): they don't perform a real
    // outbound check, so counting them as "checks" inflates totals and the
    // up/down ratio. Mirrors the guard in recordCheck() — keep them in lockstep.
    if (NON_NETWORK_TYPES.has(monitorType)) {
        return;
    }
    counters.checkTotal.add(1, buildFleetLabels({
        monitor_type: String(monitorType || "unknown"),
        status: String(status),
    }));
}

/**
 * Record the full beat cycle duration.
 * @param {string} monitorType Monitor type
 * @param {number} durationSeconds Duration in seconds
 * @returns {void}
 */
function recordCheckDuration(monitorType, durationSeconds) {
    if (!initialized || !otel.isEnabled() || !histograms.checkDuration) {
        return;
    }
    if (typeof durationSeconds !== "number" || isNaN(durationSeconds)) {
        return;
    }
    histograms.checkDuration.record(durationSeconds, buildFleetLabels({
        monitor_type: String(monitorType || "unknown"),
    }));
}

/**
 * Increment the iris_check_error_total counter.
 * @param {string} monitorType Monitor type
 * @param {string} errorCategory One of the ERROR_CATEGORIES enum values
 * @returns {void}
 */
function incrementCheckError(monitorType, errorCategory) {
    if (!initialized || !otel.isEnabled() || !counters.checkErrorTotal) {
        return;
    }
    // Skip non-network types: a "group" cannot have a real check error
    // (content_mismatch etc.) — it only aggregates child status. Counting them
    // produced phantom group/json-query errors. Mirrors recordCheck()'s guard.
    if (NON_NETWORK_TYPES.has(monitorType)) {
        return;
    }
    counters.checkErrorTotal.add(1, buildFleetLabels({
        monitor_type: String(monitorType || "unknown"),
        error_category: String(errorCategory),
    }));
}

/**
 * Record scheduler drift (how late a check fired vs expected).
 * @param {string} monitorType Monitor type
 * @param {number} driftSeconds Drift in seconds (positive = late)
 * @returns {void}
 */
function recordSchedulerDrift(monitorType, driftSeconds) {
    if (!initialized || !otel.isEnabled() || !histograms.schedulerDrift) {
        return;
    }
    if (typeof driftSeconds !== "number" || isNaN(driftSeconds)) {
        return;
    }
    histograms.schedulerDrift.record(driftSeconds, buildFleetLabels({
        monitor_type: String(monitorType || "unknown"),
    }));
}

/**
 * Increment the iris_notification_send_total counter.
 * @param {string} providerType Notification provider name (e.g., "slack", "smtp")
 * @param {string} result "success" or "failure"
 * @returns {void}
 */
function incrementNotificationSend(providerType, result) {
    if (!initialized || !otel.isEnabled() || !counters.notificationSendTotal) {
        return;
    }
    counters.notificationSendTotal.add(1, buildFleetLabels({
        provider_type: String(providerType || "unknown"),
        result: String(result),
    }));
}

/**
 * Update the active monitor counts for the observable gauge.
 * @param {Map<string, number>} typeCounts Map of monitor_type -> count
 * @returns {void}
 */
function updateActiveMonitors(typeCounts) {
    if (!initialized || !otel.isEnabled()) {
        return;
    }
    activeMonitorCounts.clear();
    for (const [monitorType, count] of typeCounts) {
        const labels = buildFleetLabels({
            monitor_type: String(monitorType),
        });
        activeMonitorCounts.set(`active:${monitorType}`, {
            value: count,
            labels,
        });
    }
}

/**
 * Classify an error into a low-cardinality category.
 * Uses priority-ordered pattern matching; "unknown" is the fallback.
 * @param {Error} error The caught error object
 * @param {string} monitorType The monitor type (for database detection)
 * @param {string} message The bean.msg (may differ from error.message)
 * @returns {string} One of the ERROR_CATEGORIES enum values
 */
function classifyError(error, monitorType, message) {
    const msg = message || error?.message || "";

    // Timeout: AbortSignal cancellation or message containing "timeout"
    if (error?.name === "CanceledError" || /timeout/i.test(msg)) {
        return "timeout";
    }

    // Connection refused
    if (error?.code === "ECONNREFUSED" || error?.cause?.code === "ECONNREFUSED") {
        return "connection_refused";
    }

    // DNS resolution failure
    if (error?.code === "ENOTFOUND" || error?.code === "EAI_AGAIN" ||
        error?.cause?.code === "ENOTFOUND" || error?.cause?.code === "EAI_AGAIN" ||
        /NXDOMAIN|SERVFAIL|NODATA/i.test(msg)) {
        return "dns_resolution";
    }

    // TLS / certificate errors
    if ((error?.code && /^ERR_TLS/i.test(error.code)) ||
        error?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
        /certificate|ssl error/i.test(msg)) {
        return "tls_certificate";
    }

    // HTTP client errors (4xx)
    if (error?.response?.status >= 400 && error?.response?.status < 500) {
        return "http_client_error";
    }

    // HTTP server errors (5xx)
    if (error?.response?.status >= 500) {
        return "http_server_error";
    }

    // Authentication errors
    if (/oauth|unauthorized|forbidden|authentication failed|password|credential/i.test(msg)) {
        return "authentication";
    }

    // Content mismatch (keyword, JSON query, MQTT message)
    if (/keyword|JSON query|Message Mismatch|expected value|does not pass/i.test(msg)) {
        return "content_mismatch";
    }

    // Database errors (monitor type hint)
    if (DB_MONITOR_TYPES.has(monitorType)) {
        return "database_error";
    }

    return "unknown";
}

/**
 * Check if metrics module is initialized
 * @returns {boolean} True if initialized
 */
function isInitialized() {
    return initialized;
}

/**
 * Get all current metric values (for debugging)
 * @returns {Map} Current metric values
 */
function getMetricValues() {
    return metricValues;
}

module.exports = {
    init,
    recordCheck,
    recordMonitorInfo,
    recordTargetGeo,
    recordMeshHealth,
    removeMonitor,
    isInitialized,
    getMetricValues,
    // Usage & Performance metrics
    incrementCheckTotal,
    recordCheckDuration,
    incrementCheckError,
    recordSchedulerDrift,
    incrementNotificationSend,
    updateActiveMonitors,
    classifyError,
    // For advanced usage
    sanitizeLabels,
    buildBaseLabels,
    ALLOWED_LABELS,
    // Constants (for testing)
    ERROR_CATEGORIES,
};
