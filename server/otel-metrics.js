/**
 * OpenTelemetry Metrics Bridge for Iris
 *
 * Creates OTEL metrics that mirror the existing Prometheus metrics,
 * allowing probes to push metrics to the central collector.
 */
const { metrics } = require("@opentelemetry/api");
const { log } = require("../src/util");
const { isEnabled } = require("./otel-init");

let meter = null;
let gauges = {};
let initialized = false;

/**
 * Initialize OTEL metrics
 * Creates gauges matching the Prometheus metrics in prometheus.js
 * @returns {void}
 */
function initOtelMetrics() {
    if (!isEnabled) {
        log.debug("otel-metrics", "OTEL not enabled, skipping metrics initialization");
        return;
    }

    if (initialized) {
        log.debug("otel-metrics", "OTEL metrics already initialized");
        return;
    }

    meter = metrics.getMeter("iris-probe", "1.0.0");

    // Create gauges matching Prometheus metrics
    gauges.monitorStatus = meter.createObservableGauge("monitor_status", {
        description: "Monitor Status (1=UP, 0=DOWN, 2=PENDING, 3=MAINTENANCE)",
        unit: "1",
    });

    gauges.monitorResponseTime = meter.createObservableGauge("monitor_response_time", {
        description: "Monitor Response Time (ms)",
        unit: "ms",
    });

    gauges.monitorCertDaysRemaining = meter.createObservableGauge("monitor_cert_days_remaining", {
        description: "The number of days remaining until the certificate expires",
        unit: "d",
    });

    gauges.monitorCertIsValid = meter.createObservableGauge("monitor_cert_is_valid", {
        description: "Is the certificate still valid? (1=Yes, 0=No)",
        unit: "1",
    });

    gauges.monitorUptimeRatio = meter.createObservableGauge("monitor_uptime_ratio", {
        description: "Uptime ratio (0.0 - 1.0)",
        unit: "1",
    });

    gauges.monitorResponseTimeSeconds = meter.createObservableGauge("monitor_response_time_seconds", {
        description: "Average response time in seconds",
        unit: "s",
    });

    initialized = true;
    log.info("otel-metrics", "OTEL metrics initialized");
}

// Storage for current metric values (observable gauges read from callbacks)
const metricValues = new Map();

/**
 * Record a metric value. Values are stored and read by observable gauge callbacks.
 * @param {string} name Metric name (e.g., "monitor_status")
 * @param {number} value The value to record
 * @param {object} labels Labels for the metric
 * @returns {void}
 */
function recordMetric(name, value, labels) {
    if (!isEnabled || !initialized) {
        return;
    }

    if (typeof value !== "number" || isNaN(value)) {
        return;
    }

    // Create a unique key for this metric + labels combination
    const labelKey = JSON.stringify(labels);
    const key = `${name}:${labelKey}`;

    metricValues.set(key, { name, value, labels });
}

/**
 * Remove metrics for a monitor (when monitor is deleted or stopped)
 * @param {object} labels Labels identifying the monitor
 * @returns {void}
 */
function removeMetrics(labels) {
    if (!isEnabled) {
        return;
    }

    const labelKey = JSON.stringify(labels);

    // Remove all metrics with these labels
    for (const key of metricValues.keys()) {
        if (key.endsWith(`:${labelKey}`)) {
            metricValues.delete(key);
        }
    }
}

/**
 * Get all stored metric values (for debugging)
 * @returns {Map} The stored metric values
 */
function getMetricValues() {
    return metricValues;
}

/**
 * Set up observable gauge callbacks after initialization.
 * These callbacks are called by the OTEL SDK when exporting metrics.
 * @returns {void}
 */
function setupObservableCallbacks() {
    if (!isEnabled || !initialized || !meter) {
        return;
    }

    // Register batch observable callback for all gauges
    meter.addBatchObservableCallback((observableResult) => {
        for (const [, data] of metricValues) {
            const gauge = getGaugeByName(data.name);
            if (gauge) {
                observableResult.observe(gauge, data.value, data.labels);
            }
        }
    }, Object.values(gauges));
}

/**
 * Get gauge by metric name
 * @param {string} name Metric name
 * @returns {object|null} The gauge or null
 */
function getGaugeByName(name) {
    switch (name) {
        case "monitor_status":
            return gauges.monitorStatus;
        case "monitor_response_time":
            return gauges.monitorResponseTime;
        case "monitor_cert_days_remaining":
            return gauges.monitorCertDaysRemaining;
        case "monitor_cert_is_valid":
            return gauges.monitorCertIsValid;
        case "monitor_uptime_ratio":
            return gauges.monitorUptimeRatio;
        case "monitor_response_time_seconds":
            return gauges.monitorResponseTimeSeconds;
        default:
            return null;
    }
}

// Auto-initialize when module is loaded (after otel-init)
if (isEnabled) {
    // Delay initialization to ensure OTEL SDK is fully started
    setImmediate(() => {
        initOtelMetrics();
        setupObservableCallbacks();
    });
}

module.exports = {
    initOtelMetrics,
    recordMetric,
    removeMetrics,
    getMetricValues,
    isEnabled,
};
