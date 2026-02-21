/**
 * Transforms flat iris monitor + status data into the grouped
 * "services" shape used by the public status page.
 *
 * Services = top-level monitor groups (type="group", parent=null).
 * Each service contains its direct child monitors with live status.
 */
import type { MonitorData } from "./kuma-state";
import type { MonitorStatus, TargetGeo } from "./prom-client";

export interface PublicMonitor {
    id: number;
    name: string;
    type: string;
    status: "up" | "down" | "degraded" | "unknown";
    response_time: number | null;
    uptime_24h: number | null;
    uptime_7d: number | null;
    uptime_30d: number | null;
}

export interface PublicService {
    name: string;
    slug: string;
    overall_status: "up" | "down" | "degraded" | "unknown";
    probe_count: number;
    probes_up: number;
    monitors: PublicMonitor[];
}

export interface PublicTarget {
    lat: number;
    lon: number;
    country: string;
    city: string;
    asn: string;
    ip: string;
    monitorName: string;
    status: "up" | "down" | "degraded" | "unknown";
}

export interface PublicStatusData {
    generated_at: string;
    services: PublicService[];
    monitors_total: number;
    monitors_up: number;
    checks_per_second: number | null;
    targets: PublicTarget[];
}

const STATUS_PRIORITY: Record<string, number> = {
    down: 0,
    degraded: 1,
    up: 2,
    unknown: 3,
};

/**
 * Recursively collect all leaf (non-group) monitors from a group tree.
 * Descends into nested subgroups to include their children.
 * @param groupId - master ID of the group monitor
 * @param monitors - full monitor map from kuma-state
 * @returns array of non-group, active child monitors
 */
function collectLeafMonitors(
    groupId: number,
    monitors: Record<string, MonitorData>,
): MonitorData[] {
    const group = monitors[String(groupId)];
    if (!group) {
        return [];
    }
    const leaves: MonitorData[] = [];
    for (const childId of group.childrenIDs || []) {
        const child = monitors[String(childId)];
        if (!child || !child.active) {
            continue;
        }
        if (child.type === "group") {
            leaves.push(...collectLeafMonitors(child.id, monitors));
        } else {
            leaves.push(child);
        }
    }
    return leaves;
}

/**
 * Slugify a service name for use as a URL-safe identifier
 * @param name - human-readable service name
 * @returns lowercase hyphenated slug
 */
function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

/**
 * Compute average response time across all probes for a monitor
 * @param monitorStatus - status entry with per-probe data
 * @returns average response time in ms, or null if no data
 */
function averageResponseTime(monitorStatus: MonitorStatus | undefined): number | null {
    if (!monitorStatus) {
        return null;
    }
    const probes = Object.values(monitorStatus.probes);
    if (probes.length === 0) {
        return null;
    }
    const sum = probes.reduce((acc, p) => acc + p.responseTime, 0);
    return Math.round(sum / probes.length);
}

/**
 * Compute worst-status-wins across a list of statuses
 * @param statuses - array of status strings
 * @returns the worst status
 */
function worstStatus(statuses: Array<"up" | "down" | "degraded" | "unknown">): "up" | "down" | "degraded" | "unknown" {
    const known = statuses.filter(s => s !== "unknown");
    if (known.length === 0) {
        return "unknown";
    }
    let worst: "up" | "down" | "degraded" | "unknown" = "up";
    for (const s of known) {
        if (STATUS_PRIORITY[s] < STATUS_PRIORITY[worst]) {
            worst = s;
        }
    }
    return worst;
}

/**
 * Map flat monitor data into grouped services for the public UI.
 * @param monitors - monitor config map (keyed by master ID)
 * @param statusMap - per-monitor status (keyed by master ID)
 * @returns public status data with services and monitors
 */
export function mapServices(
    monitors: Record<string, MonitorData>,
    statusMap: Record<string, MonitorStatus>,
    checksPerSecond: number | null = null,
    targetGeo: TargetGeo[] = [],
): PublicStatusData {
    // Find top-level groups (services)
    const groups = Object.values(monitors)
        .filter(m => m.type === "group" && m.parent === null && m.active)
        .sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0) || a.name.localeCompare(b.name));

    const services: PublicService[] = groups.map(group => {
        // Resolve child monitors (recursively includes nested subgroup children)
        const children = collectLeafMonitors(group.id, monitors)
            .sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0) || a.name.localeCompare(b.name));

        const publicMonitors: PublicMonitor[] = children.map(child => {
            const st = statusMap[String(child.id)];
            return {
                id: child.id,
                name: child.name,
                type: child.type,
                status: st?.aggregated || "unknown",
                response_time: averageResponseTime(st),
                uptime_24h: null,
                uptime_7d: null,
                uptime_30d: null,
            };
        });

        const childStatuses = publicMonitors.map(m => m.status);
        const overall = worstStatus(childStatuses);

        // Aggregate probe health across all monitors in this service
        // A probe is "up" for this service if it reports up for every monitor it covers
        const probeUpCounts = new Map<string, { total: number; up: number }>();
        for (const child of children) {
            const st = statusMap[String(child.id)];
            if (!st) {
                continue;
            }
            for (const [probeId, probeStatus] of Object.entries(st.probes)) {
                if (!probeUpCounts.has(probeId)) {
                    probeUpCounts.set(probeId, { total: 0, up: 0 });
                }
                const counts = probeUpCounts.get(probeId)!;
                counts.total++;
                if (probeStatus.up) {
                    counts.up++;
                }
            }
        }
        const probeCount = probeUpCounts.size;
        const probesUp = Array.from(probeUpCounts.values())
            .filter(c => c.up === c.total).length;

        return {
            name: group.name,
            slug: slugify(group.name),
            overall_status: overall,
            probe_count: probeCount,
            probes_up: probesUp,
            monitors: publicMonitors,
        };
    });

    // Count ALL active non-group monitors from kuma-state (not just those in services).
    // This ensures the header total matches the true number of monitored endpoints,
    // including monitors in nested subgroups or ungrouped monitors.
    let monitorsTotal = 0;
    let monitorsUp = 0;
    for (const [id, mon] of Object.entries(monitors)) {
        if (mon.type === "group" || !mon.active) {
            continue;
        }
        monitorsTotal++;
        const st = statusMap[id];
        if (st?.aggregated === "up") {
            monitorsUp++;
        }
    }

    // Build target geo list enriched with monitor name and status
    const targets: PublicTarget[] = targetGeo
        .map(tg => {
            const mon = monitors[tg.masterId];
            const st = statusMap[tg.masterId];
            return {
                lat: tg.lat,
                lon: tg.lon,
                country: tg.country,
                city: tg.city,
                asn: tg.asn,
                ip: tg.targetIp,
                monitorName: mon?.name || "Unknown",
                status: (st?.aggregated || "unknown") as "up" | "down" | "degraded" | "unknown",
            };
        })
        .filter(t => t.lat !== 0 || t.lon !== 0);

    return {
        generated_at: new Date().toISOString(),
        services,
        monitors_total: monitorsTotal,
        monitors_up: monitorsUp,
        checks_per_second: checksPerSecond,
        targets,
    };
}
