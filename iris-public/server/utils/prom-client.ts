/**
 * Prometheus metrics query client for the OTEL Collector.
 * Fetches and parses Prometheus text format to extract per-probe monitor status.
 *
 * Handles two translation layers:
 * 1. OTEL Prometheus exporter renames metrics with unit suffixes
 *    (monitor_up → monitor_up_ratio, monitor_response_time → monitor_response_time_milliseconds)
 * 2. Probe-local monitor IDs differ from master IDs — translated via
 *    monitor_info_ratio name matching against kuma-state.
 */
import { getMonitors, type MonitorData } from "./kuma-state";

export interface ProbeStatus {
    up: boolean;
    status: number;
    responseTime: number;
}

export interface MonitorStatus {
    aggregated: "up" | "down" | "degraded" | "unknown";
    probes: Record<string, ProbeStatus>;
}

export interface StatusResult {
    status: Record<string, MonitorStatus>;
    lastUpdated: number;
}

interface MetricSample {
    name: string;
    labels: Record<string, string>;
    value: number;
}

let cachedResult: StatusResult = { status: {}, lastUpdated: 0 };
let cacheTime = 0;
const CACHE_TTL_MS = 5000;

// OTEL Prometheus exporter metric names (with unit suffixes)
const METRIC_UP = "monitor_up_ratio";
const METRIC_STATUS = "monitor_status_ratio";
const METRIC_RESPONSE_TIME = "monitor_response_time_milliseconds";
const METRIC_INFO = "monitor_info_ratio";

// Priority for worst-status-wins aggregation (lower = worse)
const STATUS_PRIORITY: Record<string, number> = {
    down: 0,
    degraded: 1,
    up: 2,
    unknown: 3,
};

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
 * Derive aggregated status for group monitors from their children.
 * Groups don't emit OTEL metrics (NON_NETWORK_TYPES), so their status
 * is computed bottom-up from the tree.
 * @param statusMap - status map keyed by master ID (mutated in place)
 * @param monitors - master monitor map from kuma-state
 */
function deriveGroupStatus(
    statusMap: Record<string, MonitorStatus>,
    monitors: Record<string, MonitorData>,
): void {
    /**
     * Recursively compute a group's aggregated status from children
     * @param monitorId - master ID of the monitor
     * @returns aggregated status
     */
    function computeGroup(monitorId: string): "up" | "down" | "degraded" | "unknown" {
        const mon = monitors[monitorId];
        if (!mon || mon.type !== "group") {
            return statusMap[monitorId]?.aggregated || "unknown";
        }

        const childIds = mon.childrenIDs || [];
        if (childIds.length === 0) {
            return "unknown";
        }

        const childStatuses: Array<"up" | "down" | "degraded" | "unknown"> = [];
        for (const childId of childIds) {
            const childMon = monitors[String(childId)];
            if (childMon && childMon.type === "group") {
                childStatuses.push(computeGroup(String(childId)));
            } else {
                childStatuses.push(statusMap[String(childId)]?.aggregated || "unknown");
            }
        }

        // Filter out unknown children (no data yet)
        const known = childStatuses.filter(s => s !== "unknown");
        if (known.length === 0) {
            return "unknown";
        }

        // Worst status wins
        let worst: "up" | "down" | "degraded" | "unknown" = "up";
        for (const s of known) {
            if (STATUS_PRIORITY[s] < STATUS_PRIORITY[worst]) {
                worst = s;
            }
        }
        return worst;
    }

    for (const [monitorId, mon] of Object.entries(monitors)) {
        if (mon.type === "group") {
            const derived = computeGroup(monitorId);
            if (!statusMap[monitorId]) {
                statusMap[monitorId] = { aggregated: "unknown", probes: {} };
            }
            statusMap[monitorId].aggregated = derived;
        }
    }
}

/**
 * Fetch metrics from OTEL Prometheus exporter and aggregate per-monitor status.
 * Translates probe-local IDs to master IDs using monitor_info_ratio name matching.
 * Derives group status from children.
 * @param promUrl - URL of the Prometheus metrics endpoint
 * @returns per-monitor aggregated status across probes, keyed by master ID
 */
export async function fetchMonitorStatus(promUrl: string): Promise<StatusResult> {
    const now = Date.now();
    if (now - cacheTime < CACHE_TTL_MS) {
        return cachedResult;
    }

    try {
        const response = await fetch(promUrl, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) {
            console.warn(`[prom-client] Failed to fetch metrics: ${response.status}`);
            return cachedResult;
        }

        const text = await response.text();
        const samples = parsePrometheusText(text);

        // --- Build ID translation via monitor_info_ratio + kuma-state ---
        const masterMonitors = getMonitors();

        // Master monitor name → master ID
        const masterNameToId = new Map<string, string>();
        for (const [masterId, mon] of Object.entries(masterMonitors)) {
            if (mon.name) {
                masterNameToId.set(mon.name, masterId);
            }
        }

        // "probeId:probeLocalId" → master ID (via name matching)
        const probeLocalToMaster = new Map<string, string>();
        for (const sample of samples) {
            if (sample.name === METRIC_INFO) {
                const monName = sample.labels.monitor_name;
                const probeLocalId = sample.labels.monitor_id;
                const probeId = sample.labels.probe_id;
                if (monName && probeLocalId && probeId) {
                    const masterId = masterNameToId.get(monName);
                    if (masterId) {
                        probeLocalToMaster.set(`${probeId}:${probeLocalId}`, masterId);
                    }
                }
            }
        }

        // --- Build status map keyed by master ID ---
        const statusMap: Record<string, MonitorStatus> = {};

        for (const sample of samples) {
            const probeLocalId = sample.labels.monitor_id;
            const probeId = sample.labels.probe_id;
            if (!probeLocalId || !probeId) {
                continue;
            }

            // Translate probe-local ID to master ID
            const masterId = probeLocalToMaster.get(`${probeId}:${probeLocalId}`);
            if (!masterId) {
                continue;
            }

            if (!statusMap[masterId]) {
                statusMap[masterId] = { aggregated: "unknown", probes: {} };
            }
            if (!statusMap[masterId].probes[probeId]) {
                statusMap[masterId].probes[probeId] = { up: true, status: 1, responseTime: 0 };
            }

            const probe = statusMap[masterId].probes[probeId];
            if (sample.name === METRIC_UP) {
                probe.up = sample.value === 1;
            } else if (sample.name === METRIC_STATUS) {
                probe.status = sample.value;
            } else if (sample.name === METRIC_RESPONSE_TIME) {
                probe.responseTime = sample.value;
            }
        }

        // Compute aggregated status per leaf monitor (worst-status-wins)
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

        // Derive group status from children
        deriveGroupStatus(statusMap, masterMonitors);

        cachedResult = { status: statusMap, lastUpdated: Date.now() };
        cacheTime = now;
        return cachedResult;
    } catch (err) {
        console.warn(`[prom-client] Error fetching metrics:`, err);
        return cachedResult;
    }
}
