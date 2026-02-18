/**
 * HTTP client for fetching monitor data from iris-catalog.
 * Authenticates with Basic Auth and caches responses in memory.
 */

export interface MonitorData {
    id: number;
    name: string;
    description: string | null;
    type: string;
    parent: number | null;
    active: boolean;
    tags: Array<{ tag_id: number; name: string; color: string; value: string }>;
    url?: string;
    hostname?: string;
    port?: number;
    weight: number;
    pathName: string;
    childrenIDs: number[];
    [key: string]: unknown;
}

export interface ProbeStatus {
    up: boolean;
    status: number;
    responseTime: number;
}

export interface MonitorStatus {
    aggregated: "up" | "down" | "degraded" | "unknown";
    probes: Record<string, ProbeStatus>;
}

interface MonitorsResponse {
    connected: boolean;
    lastUpdate: number;
    monitors: Record<string, MonitorData>;
}

interface StatusResponse {
    status: Record<string, MonitorStatus>;
    lastUpdated: number;
}

interface CacheEntry<T> {
    data: T;
    time: number;
}

const CACHE_TTL_MS = 10_000;

let monitorsCache: CacheEntry<MonitorsResponse> | null = null;
let statusCache: CacheEntry<StatusResponse> | null = null;

/**
 * Build Basic Auth header value from username and password
 * @param username - HTTP Basic Auth username
 * @param password - HTTP Basic Auth password
 * @returns Authorization header value
 */
function basicAuth(username: string, password: string): string {
    return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

/**
 * Fetch monitor configs from iris-catalog.
 * Returns cached data on failure for graceful degradation.
 * @returns monitors response with connection info and monitor map
 */
export async function fetchMonitors(): Promise<MonitorsResponse> {
    const now = Date.now();
    if (monitorsCache && now - monitorsCache.time < CACHE_TTL_MS) {
        return monitorsCache.data;
    }

    const config = useRuntimeConfig();
    const url = `${config.catalogUrl}/api/monitors`;
    const auth = basicAuth(config.catalogUsername as string, config.catalogPassword as string);

    try {
        const data = await $fetch<MonitorsResponse>(url, {
            headers: { Authorization: auth },
            timeout: 5000,
        });
        monitorsCache = { data, time: now };
        return data;
    } catch (err) {
        console.warn("[catalog-client] Failed to fetch monitors:", err);
        if (monitorsCache) {
            return monitorsCache.data;
        }
        return { connected: false, lastUpdate: 0, monitors: {} };
    }
}

/**
 * Fetch live monitor status from iris-catalog.
 * Returns cached data on failure for graceful degradation.
 * @returns status response with per-monitor aggregated status
 */
export async function fetchStatus(): Promise<StatusResponse> {
    const now = Date.now();
    if (statusCache && now - statusCache.time < CACHE_TTL_MS) {
        return statusCache.data;
    }

    const config = useRuntimeConfig();
    const url = `${config.catalogUrl}/api/status`;
    const auth = basicAuth(config.catalogUsername as string, config.catalogPassword as string);

    try {
        const data = await $fetch<StatusResponse>(url, {
            headers: { Authorization: auth },
            timeout: 5000,
        });
        statusCache = { data, time: now };
        return data;
    } catch (err) {
        console.warn("[catalog-client] Failed to fetch status:", err);
        if (statusCache) {
            return statusCache.data;
        }
        return { status: {}, lastUpdated: 0 };
    }
}
