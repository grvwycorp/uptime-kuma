/**
 * OpenTelemetry Metrics SDK initialization for Iris probes (metrics-only, no tracing)
 * MUST be imported early in server.js, after dotenv.config()
 *
 * This module enables probes to push metrics to the central OTEL collector
 * via OTLP HTTP protocol. Master instances (IRIS_MODE=master) skip initialization
 * since they are scraped locally by the collector.
 *
 * Uses MeterProvider directly instead of NodeSDK to avoid pulling in
 * tracing dependencies we don't need.
 */
const { log } = require("../src/util");

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const irisMode = process.env.IRIS_MODE || "probe";

// Skip OTEL SDK on master - metrics are scraped locally
if (irisMode === "master") {
    log.info("otel", "Master mode - metrics scraped locally, SDK disabled");
    module.exports = { meterProvider: null, isEnabled: false };
    return;
}

// Skip if no OTEL endpoint configured
if (!otlpEndpoint) {
    log.info("otel", "No OTEL_EXPORTER_OTLP_ENDPOINT configured, SDK disabled");
    module.exports = { meterProvider: null, isEnabled: false };
    return;
}

const { MeterProvider, PeriodicExportingMetricReader } = require("@opentelemetry/sdk-metrics");
const { OTLPMetricExporter } = require("@opentelemetry/exporter-metrics-otlp-http");
const { metrics } = require("@opentelemetry/api");

const probeId = process.env.IRIS_PROBE_ID || process.env.HOSTNAME || "unknown";

// Build metrics endpoint URL
// OTLP HTTP uses port 4318, gRPC uses 4317
// If endpoint uses port 4317 (gRPC), switch to 4318 (HTTP)
let metricsEndpoint = otlpEndpoint;
if (metricsEndpoint.includes(":4317")) {
    metricsEndpoint = metricsEndpoint.replace(":4317", ":4318");
}
// Append /v1/metrics if not already present
if (!metricsEndpoint.includes("/v1/metrics")) {
    metricsEndpoint = metricsEndpoint.replace(/\/?$/, "/v1/metrics");
}

log.info("otel", `Initializing OTEL Metrics SDK for probe: ${probeId}`);
log.info("otel", `Metrics endpoint: ${metricsEndpoint}`);

const exporter = new OTLPMetricExporter({
    url: metricsEndpoint,
});

const meterProvider = new MeterProvider({
    readers: [
        new PeriodicExportingMetricReader({
            exporter,
            exportIntervalMillis: parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL) || 15000,
        })
    ]
});

// Set as global meter provider so other modules can access it via @opentelemetry/api
metrics.setGlobalMeterProvider(meterProvider);

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

module.exports = { meterProvider, isEnabled: true };
