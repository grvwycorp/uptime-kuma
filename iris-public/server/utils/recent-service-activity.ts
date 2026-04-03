import type { PublicRecentData, PublicServiceSummary, ServiceRecentItem } from "~/types/public";
import { queryVmInstant, queryVmRange } from "./vm-client";

const WINDOW_MINUTES = 60;
const NEWLY_DOWN_LOOKBACK_MINUTES = 15;
const STEP_SECONDS = 60;

type ServiceState = "up" | "down" | "degraded" | "unknown";

const STATUS_PRIORITY: Record<ServiceState, number> = {
    down: 0,
    degraded: 1,
    up: 2,
    unknown: 3,
};

interface StatePoint {
    timestamp: number;
    state: ServiceState;
}

function aggregateServiceState(monitorStates: Map<string, Map<string, boolean>>): ServiceState {
    const states: ServiceState[] = [];

    for (const probeStates of monitorStates.values()) {
        const values = Array.from(probeStates.values());
        if (values.length === 0) {
            continue;
        }
        if (values.every(Boolean)) {
            states.push("up");
        } else if (values.every((value) => !value)) {
            states.push("down");
        } else {
            states.push("degraded");
        }
    }

    if (states.length === 0) {
        return "unknown";
    }

    return states.reduce<ServiceState>((worst, current) => {
        if (STATUS_PRIORITY[current] < STATUS_PRIORITY[worst]) {
            return current;
        }
        return worst;
    }, "up");
}

function getStateAtOrBefore(points: StatePoint[], targetTimestamp: number): ServiceState | null {
    let match: ServiceState | null = null;
    for (const point of points) {
        if (point.timestamp > targetTimestamp) {
            break;
        }
        match = point.state;
    }
    return match;
}

function getTransitions(points: StatePoint[]): Array<{ from: ServiceState; to: ServiceState; timestamp: number }> {
    const transitions: Array<{ from: ServiceState; to: ServiceState; timestamp: number }> = [];
    let previous: ServiceState | null = null;

    for (const point of points) {
        if (point.state === "unknown") {
            continue;
        }
        if (previous !== null && previous !== point.state) {
            transitions.push({
                from: previous,
                to: point.state,
                timestamp: point.timestamp,
            });
        }
        previous = point.state;
    }

    return transitions;
}

function affectedMonitors(service: PublicServiceSummary): string[] | undefined {
    const monitors = service.monitors
        .filter((monitor) => monitor.status !== "up")
        .map((monitor) => monitor.name)
        .slice(0, 3);

    return monitors.length > 0 ? monitors : undefined;
}

function formatProbeSummary(service: PublicServiceSummary): string | undefined {
    if (service.probe_count <= 1) {
        return undefined;
    }
    return `${service.probes_up}/${service.probe_count} probes fully healthy`;
}

function buildRecentItem(
    service: PublicServiceSummary,
    summary: string,
    eventTimestamp: number,
    includeAffectedMonitors = true,
): ServiceRecentItem {
    return {
        service_id: service.id,
        service_name: service.name,
        service_slug: service.slug,
        docs_path: service.docs_path,
        current_status: service.overall_status,
        summary,
        event_at: new Date(eventTimestamp).toISOString(),
        affected_monitors: includeAffectedMonitors ? affectedMonitors(service) : undefined,
        probes_summary: formatProbeSummary(service),
    };
}

export async function buildRecentServiceActivity(
    vmUrl: string,
    services: PublicServiceSummary[],
): Promise<PublicRecentData> {
    const generatedAt = new Date();
    const emptyResult: PublicRecentData = {
        generated_at: generatedAt.toISOString(),
        window_minutes: WINDOW_MINUTES,
        newly_down: [],
        newly_recovered: [],
        most_unstable: [],
        probe_disagreement: [],
        available: false,
    };

    if (services.length === 0) {
        return { ...emptyResult, available: true };
    }

    const serviceByName = new Map(services.map((service) => [service.name, service]));

    try {
        const monitorInfo = await queryVmInstant(vmUrl, "monitor_info_ratio");
        const monitorMap = new Map<string, { serviceName: string; monitorName: string }>();

        for (const sample of monitorInfo) {
            const probeId = sample.metric.probe_id;
            const monitorId = sample.metric.monitor_id;
            const serviceName = sample.metric.service;
            const monitorName = sample.metric.monitor_name;

            if (!probeId || !monitorId || !serviceName || !monitorName) {
                continue;
            }
            if (!serviceByName.has(serviceName)) {
                continue;
            }

            monitorMap.set(`${probeId}:${monitorId}`, { serviceName, monitorName });
        }

        if (monitorMap.size === 0) {
            return {
                ...emptyResult,
                reason: "VictoriaMetrics returned no usable monitor_info mapping for public services.",
            };
        }

        const end = generatedAt;
        const start = new Date(end.getTime() - WINDOW_MINUTES * 60_000);
        const historySamples = await queryVmRange(vmUrl, "monitor_up_ratio", start, end, STEP_SECONDS);

        if (historySamples.length === 0) {
            return {
                ...emptyResult,
                reason: "VictoriaMetrics returned no recent monitor_up history.",
            };
        }

        const timeline = new Map<string, Map<number, Map<string, Map<string, boolean>>>>();

        for (const sample of historySamples) {
            const probeId = sample.metric.probe_id;
            const monitorId = sample.metric.monitor_id;
            const mappedMonitor = probeId && monitorId ? monitorMap.get(`${probeId}:${monitorId}`) : undefined;

            if (!mappedMonitor || !sample.values) {
                continue;
            }

            for (const [timestampSeconds, rawValue] of sample.values) {
                const timestamp = Math.round(Number(timestampSeconds) * 1000);
                const serviceEntries = timeline.get(mappedMonitor.serviceName) || new Map<number, Map<string, Map<string, boolean>>>();
                const timestampEntry = serviceEntries.get(timestamp) || new Map<string, Map<string, boolean>>();
                const monitorEntry = timestampEntry.get(mappedMonitor.monitorName) || new Map<string, boolean>();

                monitorEntry.set(probeId!, Number(rawValue) === 1);
                timestampEntry.set(mappedMonitor.monitorName, monitorEntry);
                serviceEntries.set(timestamp, timestampEntry);
                timeline.set(mappedMonitor.serviceName, serviceEntries);
            }
        }

        const historyByService = new Map<string, StatePoint[]>();
        for (const [serviceName, entries] of timeline.entries()) {
            const points = Array.from(entries.entries())
                .sort(([a], [b]) => a - b)
                .map(([timestamp, monitorStates]) => ({
                    timestamp,
                    state: aggregateServiceState(monitorStates),
                }));

            historyByService.set(serviceName, points);
        }

        const fifteenMinutesAgo = end.getTime() - NEWLY_DOWN_LOOKBACK_MINUTES * 60_000;
        const newlyDown = services
            .filter((service) => service.overall_status === "down" || service.overall_status === "degraded")
            .flatMap((service) => {
                const history = historyByService.get(service.name);
                if (!history || history.length === 0) {
                    return [];
                }

                const previousState = getStateAtOrBefore(history, fifteenMinutesAgo);
                if (previousState !== "up") {
                    return [];
                }

                const lastTransition = getTransitions(history)
                    .filter((transition) => transition.from === "up" && transition.to !== "up")
                    .at(-1);

                return [
                    buildRecentItem(
                        service,
                        `Healthy 15m ago; now ${service.overall_status}.`,
                        lastTransition?.timestamp || end.getTime(),
                    ),
                ];
            })
            .sort((a, b) => Date.parse(b.event_at) - Date.parse(a.event_at))
            .slice(0, 5);

        const newlyRecovered = services
            .filter((service) => service.overall_status === "up")
            .flatMap((service) => {
                const history = historyByService.get(service.name);
                if (!history || history.length === 0) {
                    return [];
                }

                const lastTransition = getTransitions(history)
                    .filter((transition) => transition.from !== "up" && transition.to === "up")
                    .at(-1);

                if (!lastTransition) {
                    return [];
                }

                return [
                    buildRecentItem(
                        service,
                        `Recovered from ${lastTransition.from} in the last hour.`,
                        lastTransition.timestamp,
                        false
                    ),
                ];
            })
            .sort((a, b) => Date.parse(b.event_at) - Date.parse(a.event_at))
            .slice(0, 5);

        const mostUnstable = services
            .flatMap((service) => {
                const history = historyByService.get(service.name);
                if (!history || history.length === 0) {
                    return [];
                }

                const transitions = getTransitions(history);
                if (transitions.length === 0) {
                    return [];
                }

                const lastTransition = transitions[transitions.length - 1];
                return [
                    buildRecentItem(
                        service,
                        `${transitions.length} state change${transitions.length === 1 ? "" : "s"} in the last hour.`,
                        lastTransition.timestamp,
                        false
                    ),
                ];
            })
            .sort((a, b) => {
                const aCount = Number(a.summary.match(/^(\d+)/)?.[1] || "0");
                const bCount = Number(b.summary.match(/^(\d+)/)?.[1] || "0");
                return bCount - aCount || Date.parse(b.event_at) - Date.parse(a.event_at);
            })
            .slice(0, 5);

        const probeDisagreement = services
            .filter((service) => service.probe_count > 1 && service.probes_up > 0 && service.probes_up < service.probe_count)
            .map((service) =>
                buildRecentItem(
                    service,
                    `${service.probes_up}/${service.probe_count} probes fully healthy right now.`,
                    end.getTime(),
                )
            )
            .slice(0, 5);

        return {
            generated_at: end.toISOString(),
            window_minutes: WINDOW_MINUTES,
            newly_down: newlyDown,
            newly_recovered: newlyRecovered,
            most_unstable: mostUnstable,
            probe_disagreement: probeDisagreement,
            available: true,
        };
    } catch (error) {
        return {
            ...emptyResult,
            reason: error instanceof Error ? error.message : "VictoriaMetrics recent-history query failed.",
        };
    }
}
