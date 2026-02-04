/**
 * OpenTelemetry SDK Module for Iris Probes
 *
 * Initializes the OTEL Metrics SDK with proper resource attributes for
 * probe identification and geo-tagging. Uses gRPC transport for efficiency.
 *
 * IMPORTANT: This module must be initialized AFTER the database is ready,
 * as it needs to fetch the persistent probe UUID from SQLite.
 *
 * Usage:
 *   const otel = require("./otel");
 *   await otel.init();  // Call after database is ready
 *
 * Required package (if using gRPC):
 *   npm install @opentelemetry/exporter-metrics-otlp-grpc
 *
 * Environment Variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT - Collector endpoint (e.g., http://master01:4317)
 *   OTEL_METRIC_EXPORT_INTERVAL - Export interval in ms (default: 15000)
 *   IRIS_REGION   - Probe region (e.g., "eu-west")
 *   IRIS_COUNTRY  - ISO country code (e.g., "DE")
 *   IRIS_CITY     - City name (e.g., "Frankfurt")
 *   IRIS_ASN      - Autonomous System Number (e.g., "AS24940")
 *   IRIS_LAT      - Latitude for Geomap (e.g., "50.1109")
 *   IRIS_LON      - Longitude for Geomap (e.g., "8.6821")
 */
const { log } = require("../src/util");

// State
let meterProvider = null;
let meter = null;
let initialized = false;
let enabled = false;

// Get OTEL endpoint from environment
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const irisMode = process.env.IRIS_MODE || "probe";

/**
 * Check if OTEL should be enabled based on environment
 * @returns {boolean} True if OTEL should be enabled
 */
function shouldEnable() {
    // Master mode: metrics are scraped locally by the collector
    if (irisMode === "master" || irisMode === "central") {
        log.info("otel", "Master mode - metrics scraped locally, SDK disabled");
        return false;
    }

    // No endpoint configured
    if (!otlpEndpoint) {
        log.info("otel", "No OTEL_EXPORTER_OTLP_ENDPOINT configured, SDK disabled");
        return false;
    }

    // Validate endpoint URL
    try {
        const url = new URL(otlpEndpoint);
        if (!url.hostname) {
            log.error("otel", `OTEL endpoint has empty hostname: "${otlpEndpoint}" - check IRIS_MASTER_IP env var`);
            return false;
        }
    } catch (e) {
        log.error("otel", `OTEL endpoint is not a valid URL: "${otlpEndpoint}" - ${e.message}`);
        return false;
    }

    return true;
}

/**
 * Initialize the OTEL Metrics SDK with resource attributes.
 * Must be called after database is ready.
 * @returns {Promise<void>}
 */
async function init() {
    if (initialized) {
        log.debug("otel", "OTEL SDK already initialized");
        return;
    }

    if (!shouldEnable()) {
        initialized = true;
        return;
    }

    // Dynamic imports to avoid loading OTEL packages if not needed
    const { MeterProvider, PeriodicExportingMetricReader } = require("@opentelemetry/sdk-metrics");
    const { Resource } = require("@opentelemetry/resources");
    const {
        SEMRESATTRS_SERVICE_NAME,
        SEMRESATTRS_SERVICE_INSTANCE_ID,
        SEMRESATTRS_SERVICE_VERSION,
    } = require("@opentelemetry/semantic-conventions");
    const { metrics } = require("@opentelemetry/api");

    // Get probe ID (async - needs database)
    const { getProbeId } = require("./lib/identity");
    const probeId = await getProbeId();

    // Get package version
    let version = "unknown";
    try {
        version = require("../package.json").version;
    } catch (e) {
        log.warn("otel", "Could not read package.json version");
    }

    // Build resource with all attributes
    // These will appear in Grafana Cloud's auto-generated target_info metric
    const resource = new Resource({
        // Standard OTEL semantic conventions
        [SEMRESATTRS_SERVICE_NAME]: "iris-probe",
        [SEMRESATTRS_SERVICE_INSTANCE_ID]: probeId,
        [SEMRESATTRS_SERVICE_VERSION]: version,

        // Iris-specific geo-data (from environment variables)
        "iris.probe.region": process.env.IRIS_REGION || "unknown",
        "iris.probe.country": process.env.IRIS_COUNTRY || "unknown",
        "iris.probe.city": process.env.IRIS_CITY || "unknown",
        "iris.probe.asn": process.env.IRIS_ASN || "unknown",

        // Coordinates for Grafana Geomap panel
        "iris.probe.lat": parseFloat(process.env.IRIS_LAT) || 0,
        "iris.probe.lon": parseFloat(process.env.IRIS_LON) || 0,
    });

    log.info("otel", `Initializing OTEL Metrics SDK for probe: ${probeId}`);
    log.info("otel", `Resource attributes: region=${process.env.IRIS_REGION || "unknown"}, city=${process.env.IRIS_CITY || "unknown"}`);

    // Create exporter - try gRPC first, fall back to HTTP
    let exporter;
    let transportType;

    try {
        // Prefer gRPC for efficiency (requires @opentelemetry/exporter-metrics-otlp-grpc)
        const { OTLPMetricExporter } = require("@opentelemetry/exporter-metrics-otlp-grpc");
        exporter = new OTLPMetricExporter({
            url: otlpEndpoint,
        });
        transportType = "gRPC";
    } catch (e) {
        // Fall back to HTTP exporter
        log.info("otel", "gRPC exporter not available, falling back to HTTP");
        const { OTLPMetricExporter } = require("@opentelemetry/exporter-metrics-otlp-http");

        // HTTP uses port 4318, gRPC uses 4317
        let httpEndpoint = otlpEndpoint;
        if (httpEndpoint.includes(":4317")) {
            httpEndpoint = httpEndpoint.replace(":4317", ":4318");
        }
        if (!httpEndpoint.includes("/v1/metrics")) {
            httpEndpoint = httpEndpoint.replace(/\/?$/, "/v1/metrics");
        }

        exporter = new OTLPMetricExporter({
            url: httpEndpoint,
        });
        transportType = "HTTP";
    }

    log.info("otel", `Using ${transportType} transport to endpoint: ${otlpEndpoint}`);

    // Wrap exporter to log export results (the SDK is fire-and-forget by default)
    let exportCount = 0;
    let lastSuccess = null;
    let lastError = null;
    const originalExport = exporter.export.bind(exporter);
    exporter.export = (metrics, resultCallback) => {
        originalExport(metrics, (result) => {
            exportCount++;
            if (result.code === 0) {
                lastSuccess = Date.now();
                // Log first successful export, then every 20th (~5 min at 15s interval)
                if (exportCount === 1 || exportCount % 20 === 0) {
                    const seriesCount = metrics.scopeMetrics?.reduce(
                        (sum, s) => sum + s.metrics.length, 0
                    ) || 0;
                    log.info("otel", `Export #${exportCount} OK (${seriesCount} metrics)`);
                }
            } else {
                const errMsg = result.error?.message || "unknown error";
                // Always log failures (but deduplicate consecutive identical errors)
                if (errMsg !== lastError) {
                    log.warn("otel", `Export #${exportCount} FAILED: ${errMsg}`);
                    lastError = errMsg;
                }
            }
            resultCallback(result);
        });
    };

    // Create MeterProvider with resource
    const exportIntervalMillis = parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL) || 15000;
    meterProvider = new MeterProvider({
        resource: resource,
        readers: [
            new PeriodicExportingMetricReader({
                exporter,
                exportIntervalMillis,
            }),
        ],
    });

    log.info("otel", `Export interval: ${exportIntervalMillis}ms`);

    // Set as global meter provider
    metrics.setGlobalMeterProvider(meterProvider);

    // Get meter for creating instruments
    meter = meterProvider.getMeter("iris-probe", version);

    enabled = true;
    initialized = true;
    log.info("otel", "OTEL Metrics SDK initialized successfully");

    // Graceful shutdown
    process.on("SIGTERM", async () => {
        log.info("otel", "Shutting down OTEL Metrics SDK...");
        try {
            await meterProvider.shutdown();
            log.info("otel", "OTEL Metrics SDK shutdown complete");
        } catch (err) {
            log.error("otel", "Error shutting down OTEL Metrics SDK:", err);
        }
    });
}

/**
 * Get the meter for creating instruments
 * @returns {object|null} The meter or null if not initialized
 */
function getMeter() {
    return meter;
}

/**
 * Check if OTEL is enabled
 * @returns {boolean} True if OTEL is enabled and initialized
 */
function isEnabled() {
    return enabled && initialized;
}

/**
 * Check if OTEL is initialized
 * @returns {boolean} True if init() has been called
 */
function isInitialized() {
    return initialized;
}

module.exports = {
    init,
    getMeter,
    isEnabled,
    isInitialized,
    // Expose for testing
    shouldEnable,
};
