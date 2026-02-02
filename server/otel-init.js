/**
 * OpenTelemetry SDK initialization for Iris probes
 * MUST be imported BEFORE all other modules in server.js
 *
 * This module enables probes to push metrics to the central OTEL collector
 * via OTLP protocol. Master instances (IRIS_MODE=master) skip initialization
 * since they are scraped locally by the collector.
 */
const { log } = require("../src/util");

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const irisMode = process.env.IRIS_MODE || "probe";

// Skip OTEL SDK on master - metrics are scraped locally
if (irisMode === "master") {
    log.info("otel", "Master mode - metrics scraped locally, SDK disabled");
    module.exports = { sdk: null, isEnabled: false };
    return;
}

// Skip if no OTEL endpoint configured
if (!otlpEndpoint) {
    log.info("otel", "No OTEL_EXPORTER_OTLP_ENDPOINT configured, SDK disabled");
    module.exports = { sdk: null, isEnabled: false };
    return;
}

const { NodeSDK } = require("@opentelemetry/sdk-node");
const { OTLPMetricExporter } = require("@opentelemetry/exporter-metrics-otlp-http");
const { PeriodicExportingMetricReader } = require("@opentelemetry/sdk-metrics");
const { Resource } = require("@opentelemetry/resources");
const { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_INSTANCE_ID, SEMRESATTRS_SERVICE_VERSION } = require("@opentelemetry/semantic-conventions");

const probeId = process.env.IRIS_PROBE_ID || process.env.HOSTNAME || "unknown";
const serviceName = process.env.OTEL_SERVICE_NAME || "iris-probe";

// Build metrics endpoint URL
// If endpoint is just host:port, append /v1/metrics
let metricsEndpoint = otlpEndpoint;
if (!metricsEndpoint.includes("/v1/metrics")) {
    metricsEndpoint = metricsEndpoint.replace(/\/?$/, "/v1/metrics");
}

log.info("otel", `Initializing OTEL SDK for probe: ${probeId}`);
log.info("otel", `Metrics endpoint: ${metricsEndpoint}`);

const sdk = new NodeSDK({
    resource: new Resource({
        [SEMRESATTRS_SERVICE_NAME]: serviceName,
        [SEMRESATTRS_SERVICE_INSTANCE_ID]: probeId,
        [SEMRESATTRS_SERVICE_VERSION]: process.env.npm_package_version || "unknown",
        "iris.probe.id": probeId,
        "iris.mode": irisMode,
    }),
    metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
            url: metricsEndpoint,
        }),
        exportIntervalMillis: parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL) || 15000,
    }),
});

sdk.start();
log.info("otel", "OTEL SDK initialized successfully");

// Graceful shutdown
process.on("SIGTERM", () => {
    log.info("otel", "Shutting down OTEL SDK...");
    sdk.shutdown()
        .then(() => {
            log.info("otel", "OTEL SDK shutdown complete");
            process.exit(0);
        })
        .catch((err) => {
            log.error("otel", "Error shutting down OTEL SDK:", err);
            process.exit(1);
        });
});

module.exports = { sdk, isEnabled: true };
