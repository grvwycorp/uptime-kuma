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

// Metric storage for observable gauges
const metricValues = new Map();

// Gauge instruments
let gauges = {};
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

    // Mesh health
    gauges.meshMasterLatency = meter.createObservableGauge("mesh_master_latency_ms", {
        description: "Latency to master node via Tailscale",
        unit: "ms",
    });

    gauges.meshMasterConnected = meter.createObservableGauge("mesh_master_connected", {
        description: "Connection status to master (1=connected, 0=disconnected)",
        unit: "1",
    });

    // Register batch observable callback
    meter.addBatchObservableCallback((observableResult) => {
        for (const [, data] of metricValues) {
            const gauge = gauges[data.gaugeKey];
            if (gauge) {
                observableResult.observe(gauge, data.value, data.labels);
            }
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
 */
function recordMonitorInfo(monitorId, metadata) {
    if (!initialized || !otel.isEnabled()) {
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
    };

    recordValue("monitorInfo", `info:${monitorId}`, 1, labels);
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
    recordMeshHealth,
    removeMonitor,
    isInitialized,
    getMetricValues,
    // For advanced usage
    sanitizeLabels,
    buildBaseLabels,
    ALLOWED_LABELS,
};
