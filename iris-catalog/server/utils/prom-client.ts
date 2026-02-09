/**
 * Prometheus metrics query client for the OTEL Collector.
 * Fetches and parses Prometheus text format to extract per-probe monitor status.
 */

export interface ProbeStatus {
    up: boolean;
    status: number;
    responseTime: number;
}

export interface MonitorStatus {
    aggregated: "up" | "down" | "degraded" | "unknown";
    probes: Record<string, ProbeStatus>;
}

interface MetricSample {
    name: string;
    labels: Record<string, string>;
    value: number;
}

let cachedStatus: Record<string, MonitorStatus> = {};
let cacheTime = 0;
const CACHE_TTL_MS = 5000;

/**
 * Parse Prometheus text exposition format into metric samples
 * @param text - raw Prometheus metrics text
 * @returns parsed metric samples
 */
function parsePrometheusText(text: string): MetricSample[] {
    const samples: MetricSample[] = [];
    for (const line of text.split("\n")) {
        if (!line || line.startsWith("#")) {
            continue;
        }

        // Format: metric_name{label1="val1",label2="val2"} value
        const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\{([^}]*)\}\s+(.+)$/);
        if (!match) {
            // No labels: metric_name value
            const simpleMatch = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\s+(.+)$/);
            if (simpleMatch) {
                samples.push({
                    name: simpleMatch[1],
                    labels: {},
                    value: parseFloat(simpleMatch[2]),
                });
            }
            continue;
        }

        const labels: Record<string, string> = {};
        const labelStr = match[2];
        // Parse labels: key="value",key="value"
        const labelRegex = /([a-zA-Z_][a-zA-Z0-9_]*)="([^"]*)"/g;
        let labelMatch;
        while ((labelMatch = labelRegex.exec(labelStr)) !== null) {
            labels[labelMatch[1]] = labelMatch[2];
        }

        samples.push({
            name: match[1],
            labels,
            value: parseFloat(match[3]),
        });
    }
    return samples;
}

/**
 * Fetch metrics from OTEL Prometheus exporter and aggregate per-monitor status
 * @param promUrl - URL of the Prometheus metrics endpoint
 * @returns per-monitor aggregated status across probes
 */
export async function fetchMonitorStatus(promUrl: string): Promise<Record<string, MonitorStatus>> {
    const now = Date.now();
    if (now - cacheTime < CACHE_TTL_MS) {
        return cachedStatus;
    }

    try {
        const response = await fetch(promUrl, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) {
            console.warn(`[prom-client] Failed to fetch metrics: ${response.status}`);
            return cachedStatus;
        }

        const text = await response.text();
        const samples = parsePrometheusText(text);

        // Group by monitor_id
        const statusMap: Record<string, MonitorStatus> = {};

        for (const sample of samples) {
            const monitorId = sample.labels.monitor_id;
            const probeId = sample.labels.probe_id;
            if (!monitorId || !probeId) {
                continue;
            }

            if (!statusMap[monitorId]) {
                statusMap[monitorId] = { aggregated: "unknown", probes: {} };
            }
            if (!statusMap[monitorId].probes[probeId]) {
                statusMap[monitorId].probes[probeId] = { up: true, status: 1, responseTime: 0 };
            }

            const probe = statusMap[monitorId].probes[probeId];
            if (sample.name === "monitor_up") {
                probe.up = sample.value === 1;
            } else if (sample.name === "monitor_status") {
                probe.status = sample.value;
            } else if (sample.name === "monitor_response_time") {
                probe.responseTime = sample.value;
            }
        }

        // Compute aggregated status (worst-status-wins)
        for (const monitorId of Object.keys(statusMap)) {
            const probes = Object.values(statusMap[monitorId].probes);
            if (probes.length === 0) {
                statusMap[monitorId].aggregated = "unknown";
            } else if (probes.every(p => p.up)) {
                statusMap[monitorId].aggregated = "up";
            } else if (probes.every(p => !p.up)) {
                statusMap[monitorId].aggregated = "down";
            } else {
                statusMap[monitorId].aggregated = "degraded";
            }
        }

        cachedStatus = statusMap;
        cacheTime = now;
        return statusMap;
    } catch (err) {
        console.warn(`[prom-client] Error fetching metrics:`, err);
        return cachedStatus;
    }
}
