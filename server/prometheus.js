const PrometheusClient = require("prom-client");
const { log } = require("../src/util");
const { R } = require("redbean-node");

// Legacy OTEL metrics bridge (disabled - replaced by server/otel.js + server/lib/metrics.js)
// otel-init.js now exports isEnabled: false, so these are no-ops
const { recordMetric, removeMetrics, isEnabled: otelEnabled } = require("./otel-metrics");

// New metrics enforcer (uses label allowlist and resource attributes)
// Lazy load to handle case where module isn't deployed yet
let newMetrics = null;
try {
    newMetrics = require("./lib/metrics");
} catch (e) {
    // Module not available - continue with legacy OTEL only
}

let monitorCertDaysRemaining = null;
let monitorCertIsValid = null;
let monitorUptimeRatio = null;
let monitorAverageResponseTimeSeconds = null;
let monitorResponseTime = null;
let monitorStatus = null;

class Prometheus {
    monitorLabelValues = {};

    /**
     * @param {object} monitor Monitor object to monitor
     * @param {Array<{name:string,value:?string}>} tags Tags to add to the monitor
     * @param {string} serviceName Top-level ancestor group name for service label
     * @param {string} subServiceName Immediate parent group name for sub_service label
     */
    constructor(monitor, tags, serviceName = "", subServiceName = "") {
        this.monitorLabelValues = {
            ...this.mapTagsToLabels(tags),
            monitor_id: monitor.id,
            monitor_name: monitor.name,
            monitor_type: monitor.type,
            monitor_url: monitor.url,
            monitor_hostname: monitor.hostname,
            monitor_port: monitor.port,
        };

        // Record monitor info to the new metrics enforcer (for label joins)
        // This stores the high-cardinality labels separately from time-series data
        try {
            if (newMetrics?.isInitialized()) {
                newMetrics.recordMonitorInfo(monitor.id, {
                    name: monitor.name,
                    url: monitor.url,
                    hostname: monitor.hostname,
                    port: monitor.port,
                    type: monitor.type,
                    tags: tags ? tags.map(t => t.name) : [],
                    service: serviceName,
                    subService: subServiceName,
                });
            }
        } catch (e) {
            log.debug("prometheus", "Error recording monitor info:", e.message);
        }
    }

    /**
     * Initialize Prometheus metrics, and add all available tags as possible labels.
     * This should be called once at the start of the application.
     * New tags will NOT be added dynamically, a restart is sadly required to add new tags to the metrics.
     * Existing tags added to monitors will be updated automatically.
     * @returns {Promise<void>}
     */
    static async init() {
        // Add all available tags as possible labels,
        // and use Set to remove possible duplicates (for when multiple tags contain non-ascii characters, and thus are sanitized to the same label)
        const tags = new Set(
            (await R.findAll("tag"))
                .map((tag) => {
                    return Prometheus.sanitizeForPrometheus(tag.name);
                })
                .filter((tagName) => {
                    return tagName !== "";
                })
                .sort(this.sortTags)
        );

        const commonLabels = [
            ...tags,
            "monitor_id",
            "monitor_name",
            "monitor_type",
            "monitor_url",
            "monitor_hostname",
            "monitor_port",
        ];

        monitorCertDaysRemaining = new PrometheusClient.Gauge({
            name: "monitor_cert_days_remaining",
            help: "The number of days remaining until the certificate expires",
            labelNames: commonLabels,
        });

        monitorCertIsValid = new PrometheusClient.Gauge({
            name: "monitor_cert_is_valid",
            help: "Is the certificate still valid? (1 = Yes, 0= No)",
            labelNames: commonLabels,
        });

        monitorUptimeRatio = new PrometheusClient.Gauge({
            name: "monitor_uptime_ratio",
            help: "Uptime ratio calculated over sliding window specified by the 'window' label. (0.0 - 1.0)",
            labelNames: [...commonLabels, "window"],
        });

        monitorAverageResponseTimeSeconds = new PrometheusClient.Gauge({
            name: "monitor_response_time_seconds",
            help: "Average response time in seconds calculated over sliding window specified by the 'window' label",
            labelNames: [...commonLabels, "window"],
        });

        monitorResponseTime = new PrometheusClient.Gauge({
            name: "monitor_response_time",
            help: "Monitor Response Time (ms)",
            labelNames: commonLabels,
        });

        monitorStatus = new PrometheusClient.Gauge({
            name: "monitor_status",
            help: "Monitor Status (1 = UP, 0= DOWN, 2= PENDING, 3= MAINTENANCE)",
            labelNames: commonLabels,
        });
    }

    /**
     * Sanitize a string to ensure it can be used as a Prometheus label or value.
     * See https://github.com/louislam/uptime-kuma/pull/4704#issuecomment-2366524692
     * @param {string} text The text to sanitize
     * @returns {string} The sanitized text
     */
    static sanitizeForPrometheus(text) {
        text = text.replace(/[^a-zA-Z0-9_]/g, "");
        text = text.replace(/^[^a-zA-Z_]+/, "");
        return text;
    }

    /**
     * Map the tags value to valid labels used in Prometheus. Sanitize them in the process.
     * @param {Array<{name: string, value:?string}>} tags The tags to map
     * @returns {object} The mapped tags, usable as labels
     */
    mapTagsToLabels(tags) {
        let mappedTags = {};
        tags.forEach((tag) => {
            let sanitizedTag = Prometheus.sanitizeForPrometheus(tag.name);
            if (sanitizedTag === "") {
                return; // Skip empty tag names
            }

            if (mappedTags[sanitizedTag] === undefined) {
                mappedTags[sanitizedTag] = [];
            }

            let tagValue = Prometheus.sanitizeForPrometheus(tag.value || "");
            if (tagValue !== "") {
                mappedTags[sanitizedTag].push(tagValue);
            }

            mappedTags[sanitizedTag] = mappedTags[sanitizedTag].sort();
        });

        // Order the tags alphabetically
        return Object.keys(mappedTags)
            .sort(this.sortTags)
            .reduce((obj, key) => {
                obj[key] = mappedTags[key];
                return obj;
            }, {});
    }

    /**
     * Update the metrics page
     * @typedef {import("./uptime-calculator").UptimeDataResult} UptimeDataResult
     * @param {object} heartbeat Heartbeat details
     * @param {object} tlsInfo TLS details
     * @param {{data24h: UptimeDataResult, data30d: UptimeDataResult, data1y:UptimeDataResult} | null} uptime the uptime and average response rate over a variety of fixed windows
     * @returns {void}
     */
    update(heartbeat, tlsInfo, uptime) {
        if (typeof tlsInfo !== "undefined") {
            try {
                let isValid;
                if (tlsInfo.valid === true) {
                    isValid = 1;
                } else {
                    isValid = 0;
                }
                monitorCertIsValid.set(this.monitorLabelValues, isValid);
                // Also push to OTEL if enabled
                if (otelEnabled) {
                    recordMetric("monitor_cert_is_valid", isValid, this.monitorLabelValues);
                }
            } catch (e) {
                log.error("prometheus", "Caught error", e);
            }

            try {
                if (tlsInfo.certInfo != null) {
                    monitorCertDaysRemaining.set(this.monitorLabelValues, tlsInfo.certInfo.daysRemaining);
                    // Also push to OTEL if enabled
                    if (otelEnabled) {
                        recordMetric("monitor_cert_days_remaining", tlsInfo.certInfo.daysRemaining, this.monitorLabelValues);
                    }
                }
            } catch (e) {
                log.error("prometheus", "Caught error", e);
            }
        }

        if (uptime) {
            try {
                monitorAverageResponseTimeSeconds.set(
                    { ...this.monitorLabelValues, window: "1d" },
                    uptime.data24h.avgPing / 1000
                );
                if (otelEnabled) {
                    recordMetric("monitor_response_time_seconds", uptime.data24h.avgPing / 1000, { ...this.monitorLabelValues, window: "1d" });
                }
            } catch (e) {
                log.error("prometheus", "Caught error", e);
            }
            try {
                monitorAverageResponseTimeSeconds.set(
                    { ...this.monitorLabelValues, window: "30d" },
                    uptime.data30d.avgPing / 1000
                );
                if (otelEnabled) {
                    recordMetric("monitor_response_time_seconds", uptime.data30d.avgPing / 1000, { ...this.monitorLabelValues, window: "30d" });
                }
            } catch (e) {
                log.error("prometheus", "Caught error", e);
            }
            try {
                monitorAverageResponseTimeSeconds.set(
                    { ...this.monitorLabelValues, window: "365d" },
                    uptime.data1y.avgPing / 1000
                );
                if (otelEnabled) {
                    recordMetric("monitor_response_time_seconds", uptime.data1y.avgPing / 1000, { ...this.monitorLabelValues, window: "365d" });
                }
            } catch (e) {
                log.error("prometheus", "Caught error", e);
            }
            try {
                monitorUptimeRatio.set({ ...this.monitorLabelValues, window: "1d" }, uptime.data24h.uptime);
                if (otelEnabled) {
                    recordMetric("monitor_uptime_ratio", uptime.data24h.uptime, { ...this.monitorLabelValues, window: "1d" });
                }
            } catch (e) {
                log.error("prometheus", "Caught error", e);
            }
            try {
                monitorUptimeRatio.set({ ...this.monitorLabelValues, window: "30d" }, uptime.data30d.uptime);
                if (otelEnabled) {
                    recordMetric("monitor_uptime_ratio", uptime.data30d.uptime, { ...this.monitorLabelValues, window: "30d" });
                }
            } catch (e) {
                log.error("prometheus", "Caught error", e);
            }
            try {
                monitorUptimeRatio.set({ ...this.monitorLabelValues, window: "365d" }, uptime.data1y.uptime);
                if (otelEnabled) {
                    recordMetric("monitor_uptime_ratio", uptime.data1y.uptime, { ...this.monitorLabelValues, window: "365d" });
                }
            } catch (e) {
                log.error("prometheus", "Caught error", e);
            }
        }

        if (heartbeat) {
            try {
                monitorStatus.set(this.monitorLabelValues, heartbeat.status);
                // Also push to OTEL if enabled
                if (otelEnabled) {
                    recordMetric("monitor_status", heartbeat.status, this.monitorLabelValues);
                }
            } catch (e) {
                log.error("prometheus", "Caught error");
                log.error("prometheus", e);
            }

            try {
                if (typeof heartbeat.ping === "number") {
                    monitorResponseTime.set(this.monitorLabelValues, heartbeat.ping);
                    // Also push to OTEL if enabled
                    if (otelEnabled) {
                        recordMetric("monitor_response_time", heartbeat.ping, this.monitorLabelValues);
                    }
                } else {
                    // Is it good?
                    monitorResponseTime.set(this.monitorLabelValues, -1);
                    if (otelEnabled) {
                        recordMetric("monitor_response_time", -1, this.monitorLabelValues);
                    }
                }
            } catch (e) {
                log.error("prometheus", "Caught error");
                log.error("prometheus", e);
            }

            // New metrics enforcer (with label allowlist)
            // This uses the lean label set: probe_id, monitor_id, monitor_type only
            try {
                if (newMetrics?.isInitialized()) {
                    newMetrics.recordCheck({
                        monitorId: this.monitorLabelValues.monitor_id,
                        monitorType: this.monitorLabelValues.monitor_type,
                        status: heartbeat.status,
                        responseTime: typeof heartbeat.ping === "number" ? heartbeat.ping : -1,
                        timings: (heartbeat.timing_dns !== undefined) ? {
                            dns: heartbeat.timing_dns,
                            tcp: heartbeat.timing_tcp,
                            tls: heartbeat.timing_tls,
                        } : undefined,
                        cert: tlsInfo ? {
                            daysRemaining: tlsInfo.certInfo?.daysRemaining,
                            isValid: tlsInfo.valid === true,
                        } : undefined,
                    });
                }
            } catch (e) {
                log.debug("prometheus", "Error recording to new metrics enforcer:", e.message);
            }
        }
    }

    /**
     * Remove monitor from prometheus
     * @returns {void}
     */
    remove() {
        try {
            monitorCertDaysRemaining.remove(this.monitorLabelValues);
            monitorCertIsValid.remove(this.monitorLabelValues);
            monitorUptimeRatio.remove(this.monitorLabelValues);
            monitorAverageResponseTimeSeconds.remove(this.monitorLabelValues);
            monitorResponseTime.remove(this.monitorLabelValues);
            monitorStatus.remove(this.monitorLabelValues);
            // Also remove from OTEL if enabled
            if (otelEnabled) {
                removeMetrics(this.monitorLabelValues);
            }
            // Also remove from new metrics enforcer
            if (newMetrics?.isInitialized()) {
                newMetrics.removeMonitor(
                    this.monitorLabelValues.monitor_id,
                    this.monitorLabelValues.monitor_type
                );
            }
        } catch (e) {
            console.error(e);
        }
    }

    /**
     * Sort the tags alphabetically, case-insensitive.
     * @param {string} a The first tag to compare
     * @param {string} b The second tag to compare
     * @returns {number} The alphabetical order number
     */
    sortTags(a, b) {
        const aLowerCase = a.toLowerCase();
        const bLowerCase = b.toLowerCase();

        if (aLowerCase < bLowerCase) {
            return -1;
        }

        if (aLowerCase > bLowerCase) {
            return 1;
        }

        return 0;
    }
}

module.exports = {
    Prometheus,
};
