/**
 * Legacy OpenTelemetry Metrics SDK initialization (DISABLED)
 *
 * This module has been superseded by the new OTEL pipeline:
 *   - server/otel.js (SDK with proper Resource attributes: service.name, probe_id, geo)
 *   - server/lib/metrics.js (label-controlled metrics enforcer)
 *
 * The legacy pipeline created a MeterProvider with no Resource attributes,
 * resulting in metrics exported as job="unknown_service:node" with
 * high-cardinality labels (monitor_url, monitor_name) directly attached.
 *
 * Kept as a stub so existing require("./otel-init") calls don't break.
 */
module.exports = { meterProvider: null, isEnabled: false };
