/**
 * Transforms flat iris monitor + status data into the grouped
 * "services" shape used by the public status page.
 *
 * Services = top-level monitor groups (type="group", parent=null).
 * Each service contains its direct child monitors with live status.
 */
import type { MonitorData } from "./kuma-state";
import type { MonitorStatus, TargetGeo } from "./prom-client";
import type { PublicMonitorSummary, PublicProbeSummary, PublicServiceSummary, PublicStatusData, PublicTarget } from "~/types/public";
import { getDescriptionExcerpt, getMonitorEndpoint, getWhyMonitored } from "./public-monitor";

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

function probeOverallStatus(upMonitors: number, totalMonitors: number): "up" | "down" | "degraded" | "unknown" {
    if (totalMonitors === 0) {
        return "unknown";
    }
    if (upMonitors === totalMonitors) {
        return "up";
    }
    if (upMonitors === 0) {
        return "down";
    }
    return "degraded";
}

function resolveServiceDescription(group: MonitorData, children: MonitorData[]): string | null {
    if (group.description) {
        return getDescriptionExcerpt(group.description);
    }

    const fallback = children.find((child) => child.description);
    return getDescriptionExcerpt(fallback?.description);
}

function resolveWhyMonitored(group: MonitorData, children: MonitorData[]): string | null {
    if (group.description) {
        return getWhyMonitored(group.description);
    }

    const fallback = children.find((child) => child.description);
    return getWhyMonitored(fallback?.description);
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

    const services: PublicServiceSummary[] = groups.map(group => {
        // Resolve child monitors (recursively includes nested subgroup children)
        const children = collectLeafMonitors(group.id, monitors)
            .sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0) || a.name.localeCompare(b.name));

        const publicMonitors: PublicMonitorSummary[] = children.map(child => {
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
                endpoint: getMonitorEndpoint(child),
                description_excerpt: getDescriptionExcerpt(child.description),
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
        const probes: PublicProbeSummary[] = Array.from(probeUpCounts.entries())
            .map(([probeId, counts]) => {
                const responseTimes = children
                    .map((child) => statusMap[String(child.id)]?.probes?.[probeId]?.responseTime ?? 0)
                    .filter((responseTime) => responseTime > 0);

                const avgResponseTime = responseTimes.length > 0
                    ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length)
                    : null;

                return {
                    probe_id: probeId,
                    up_monitors: counts.up,
                    total_monitors: counts.total,
                    avg_response_time: avgResponseTime,
                    overall_status: probeOverallStatus(counts.up, counts.total),
                };
            })
            .sort((a, b) => a.probe_id.localeCompare(b.probe_id));

        const probeCount = probes.length;
        const probesUp = probes.filter((probe) => probe.overall_status === "up").length;

        return {
            id: group.id,
            name: group.name,
            slug: slugify(group.name),
            docs_path: `/docs/${group.id}`,
            overall_status: overall,
            description_excerpt: resolveServiceDescription(group, children),
            why_monitored: resolveWhyMonitored(group, children),
            probe_count: probeCount,
            probes_up: probesUp,
            probes,
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
