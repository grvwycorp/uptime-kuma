/**
 * iris-bgp-bridge: BGPalerter Webhook → OTEL Metrics Bridge
 *
 * Receives JSON alert webhooks from BGPalerter's reportHTTP,
 * converts them into OTEL gauge/counter metrics, and pushes
 * to the existing iris-otel collector via OTLP gRPC.
 *
 * Metrics emitted (all carry `asn` label for Grafana joins):
 *   bgp_alert_active  — 1 when alert is active, 0 when resolved
 *   bgp_prefix_healthy — 1 when prefix is healthy, 0 when anomaly
 *   bgp_alert_total    — counter of total alerts fired
 *   bgp_rpki_valid     — 1 when RPKI is valid, 0 when invalid
 *   bgp_alerter_healthy — 1 when BGPalerter /status is OK
 *
 * Environment:
 *   OTEL_EXPORTER_OTLP_ENDPOINT — Collector endpoint (default: http://iris-otel:4317)
 *   BGP_ALERTER_STATUS_URL      — BGPalerter health endpoint (default: http://iris-bgp:8011/status)
 *   BRIDGE_PORT                  — HTTP port for webhook receiver (default: 8080)
 */

const express = require("express");
const { MeterProvider, PeriodicExportingMetricReader } = require("@opentelemetry/sdk-metrics");
const { OTLPMetricExporter } = require("@opentelemetry/exporter-metrics-otlp-grpc");
const { Resource } = require("@opentelemetry/resources");

// --- Configuration ---
const OTEL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://iris-otel:4317";
const STATUS_URL = process.env.BGP_ALERTER_STATUS_URL || "http://iris-bgp:8011/status";
const PORT = parseInt(process.env.BRIDGE_PORT) || 8080;
const HEALTH_CHECK_INTERVAL = 60000; // Check BGPalerter health every 60s

// --- OTEL Setup ---
const resource = new Resource({
    "service.name": "iris-bgp-bridge",
    "service.version": "1.0.0",
});

const exporter = new OTLPMetricExporter({ url: OTEL_ENDPOINT });
const meterProvider = new MeterProvider({
    resource,
    readers: [
        new PeriodicExportingMetricReader({
            exporter,
            exportIntervalMillis: 15000,
        }),
    ],
});

const meter = meterProvider.getMeter("iris-bgp-bridge", "1.0.0");

// --- Metric State ---
// Map of "type:asn:prefix" → { value, labels }
const alertState = new Map();
const prefixHealth = new Map();

// --- OTEL Instruments ---
const alertActiveGauge = meter.createObservableGauge("bgp_alert_active", {
    description: "BGP alert active (1=active, 0=resolved)",
    unit: "1",
});

const prefixHealthyGauge = meter.createObservableGauge("bgp_prefix_healthy", {
    description: "BGP prefix health (1=healthy, 0=anomaly)",
    unit: "1",
});

const rpkiValidGauge = meter.createObservableGauge("bgp_rpki_valid", {
    description: "RPKI validity (1=valid, 0=invalid)",
    unit: "1",
});

const alerterHealthyGauge = meter.createObservableGauge("bgp_alerter_healthy", {
    description: "BGPalerter health status (1=healthy, 0=unhealthy)",
    unit: "1",
});

const alertTotalCounter = meter.createCounter("bgp_alert_total", {
    description: "Total BGP alerts fired",
    unit: "{alert}",
});

// Observable gauge state for alerter health
let alerterHealthy = 0;

// Register batch callback
meter.addBatchObservableCallback((observableResult) => {
    for (const [, data] of alertState) {
        observableResult.observe(alertActiveGauge, data.value, data.labels);
    }
    for (const [, data] of prefixHealth) {
        observableResult.observe(prefixHealthyGauge, data.value, data.labels);
    }
    observableResult.observe(alerterHealthyGauge, alerterHealthy, {});
}, [alertActiveGauge, prefixHealthyGauge, rpkiValidGauge, alerterHealthyGauge]);

// --- Alert Processing ---

/**
 * Map BGPalerter channel names to alert types.
 * @param {string} channel BGPalerter alert channel
 * @returns {string} Normalized alert type
 */
function channelToType(channel) {
    const map = {
        "hijack": "hijack",
        "newprefix": "newprefix",
        "visibility": "visibility",
        "path": "path",
        "rpki": "rpki",
        "rpiROAS": "rpki",
        "misconfiguration": "misconfiguration",
    };
    return map[channel] || channel || "unknown";
}

/**
 * Extract ASN from BGPalerter alert data.
 * BGPalerter includes affected ASN in various fields depending on alert type.
 * @param {object} alert The alert object
 * @returns {string} ASN string (e.g. "AS3301")
 */
function extractAsn(alert) {
    // Try common fields where ASN appears
    if (alert.earliest && alert.earliest.originAs) {
        return normalizeAsn(alert.earliest.originAs);
    }
    if (alert.originAs) {
        return normalizeAsn(alert.originAs);
    }
    if (alert.asn) {
        return normalizeAsn(alert.asn);
    }
    // For path alerts, the affected AS may be in the path
    if (alert.matchedRule && alert.matchedRule.asn) {
        return normalizeAsn(alert.matchedRule.asn);
    }
    return "unknown";
}

/**
 * Normalize ASN to "AS12345" format.
 * @param {string|number} asn Raw ASN value
 * @returns {string} Normalized ASN string
 */
function normalizeAsn(asn) {
    const s = String(asn).replace(/^AS/i, "");
    return `AS${s}`;
}

/**
 * Extract prefix from BGPalerter alert.
 * @param {object} alert The alert object
 * @returns {string} Prefix string (e.g. "192.168.0.0/24")
 */
function extractPrefix(alert) {
    return alert.prefix || alert.matchedPrefix || "unknown";
}

/**
 * Process an incoming BGPalerter webhook alert.
 * @param {object} body The webhook POST body
 */
function processAlert(body) {
    const channel = body.channel || "unknown";
    const type = channelToType(channel);
    const alert = body.data || body;
    const asn = extractAsn(alert);
    const prefix = extractPrefix(alert);
    const description = body.summary || body.message || "";

    const labels = { type, asn, prefix, description: description.substring(0, 100) };
    const key = `${type}:${asn}:${prefix}`;

    // Set alert as active
    alertState.set(key, { value: 1, labels });

    // Mark prefix as unhealthy
    const prefixKey = `${asn}:${prefix}`;
    prefixHealth.set(prefixKey, {
        value: 0,
        labels: { asn, prefix, description: description.substring(0, 100) },
    });

    // Increment counter
    alertTotalCounter.add(1, { type, asn });

    console.log(`[alert] ${type} on ${asn} ${prefix}: ${description.substring(0, 80)}`);

    // Auto-resolve after 30 minutes if no update
    setTimeout(() => {
        const current = alertState.get(key);
        if (current && current.value === 1) {
            current.value = 0;
            const ph = prefixHealth.get(prefixKey);
            if (ph) {
                ph.value = 1;
            }
            console.log(`[resolved] ${type} on ${asn} ${prefix} (auto-timeout)`);
        }
    }, 30 * 60 * 1000);
}

// --- BGPalerter Health Check ---

/**
 * Poll BGPalerter /status endpoint periodically.
 */
async function checkAlerterHealth() {
    try {
        const res = await fetch(STATUS_URL);
        if (res.ok) {
            const data = await res.json();
            alerterHealthy = data.warning ? 0 : 1;
        } else {
            alerterHealthy = 0;
        }
    } catch {
        alerterHealthy = 0;
    }
}

setInterval(checkAlerterHealth, HEALTH_CHECK_INTERVAL);
checkAlerterHealth();

// --- Express Server ---
const app = express();
app.use(express.json());

/**
 * Webhook endpoint for BGPalerter reportHTTP.
 */
app.post("/alert", (req, res) => {
    try {
        processAlert(req.body);
        res.status(200).json({ ok: true });
    } catch (err) {
        console.error("[error] Failed to process alert:", err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Health endpoint.
 */
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        activeAlerts: alertState.size,
        alerterHealthy: alerterHealthy === 1,
        otelEndpoint: OTEL_ENDPOINT,
    });
});

app.listen(PORT, () => {
    console.log(`[iris-bgp-bridge] Listening on port ${PORT}`);
    console.log(`[iris-bgp-bridge] OTEL endpoint: ${OTEL_ENDPOINT}`);
    console.log(`[iris-bgp-bridge] BGPalerter status: ${STATUS_URL}`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
    console.log("[iris-bgp-bridge] Shutting down...");
    await meterProvider.shutdown();
    process.exit(0);
});
