import type { MonitorStatus } from "~/server/utils/prom-client";

export interface PublicProbeSummary {
    probe_id: string;
    overall_status: "up" | "down" | "degraded" | "unknown";
    up_monitors: number;
    total_monitors: number;
    avg_response_time: number | null;
}

export interface PublicMonitorSummary {
    id: number;
    name: string;
    type: string;
    status: "up" | "down" | "degraded" | "unknown";
    response_time: number | null;
    uptime_24h: number | null;
    uptime_7d: number | null;
    uptime_30d: number | null;
    endpoint: string | null;
    description_excerpt: string | null;
}

export interface PublicServiceSummary {
    id: number;
    name: string;
    slug: string;
    docs_path: string;
    overall_status: "up" | "down" | "degraded" | "unknown";
    description_excerpt: string | null;
    why_monitored: string | null;
    probe_count: number;
    probes_up: number;
    probes: PublicProbeSummary[];
    monitors: PublicMonitorSummary[];
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
    services: PublicServiceSummary[];
    monitors_total: number;
    monitors_up: number;
    checks_per_second: number | null;
    targets: PublicTarget[];
}

export interface ServiceRecentItem {
    service_id: number;
    service_name: string;
    service_slug: string;
    docs_path: string;
    current_status: "up" | "down" | "degraded" | "unknown";
    summary: string;
    event_at: string;
    affected_monitors?: string[];
    probes_summary?: string;
}

export interface PublicRecentData {
    generated_at: string;
    window_minutes: number;
    newly_down: ServiceRecentItem[];
    newly_recovered: ServiceRecentItem[];
    most_unstable: ServiceRecentItem[];
    probe_disagreement: ServiceRecentItem[];
    available: boolean;
    reason?: string;
}

export interface PublicCatalogTag {
    tag_id: number;
    name: string;
    color: string;
    value: string;
}

export interface PublicCatalogMonitor {
    id: number;
    name: string;
    description: string | null;
    type: string;
    parent: number | null;
    active: boolean;
    tags: PublicCatalogTag[];
    url?: string;
    hostname?: string;
    port?: number;
    weight: number;
    pathName: string;
    childrenIDs: number[];
}

export interface PublicCatalogResponse {
    connected: boolean;
    monitorListUpdatedAt: number;
    statusLastUpdated: number;
    monitors: Record<string, PublicCatalogMonitor>;
    status: Record<string, MonitorStatus>;
}
