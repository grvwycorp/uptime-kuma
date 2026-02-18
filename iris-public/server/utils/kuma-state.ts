/**
 * In-memory store for monitor data received from Uptime Kuma master via Socket.IO.
 * Updated by the kuma-socket plugin, read by API routes.
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

interface KumaState {
    monitors: Record<string, MonitorData>;
    connected: boolean;
    lastUpdate: number;
}

const state: KumaState = {
    monitors: {},
    connected: false,
    lastUpdate: 0,
};

/**
 * Get the current monitor list
 * @returns monitor map keyed by ID
 */
export function getMonitors(): Record<string, MonitorData> {
    return state.monitors;
}

/**
 * Replace the entire monitor list (called when master sends monitorList event)
 * @param monitors - full monitor map from master
 */
export function setMonitors(monitors: Record<string, MonitorData>): void {
    state.monitors = monitors;
    state.lastUpdate = Date.now();
}

/**
 * Set connection status
 * @param connected - whether we're connected to master
 */
export function setConnected(connected: boolean): void {
    state.connected = connected;
}

/**
 * Get connection status and last update time
 * @returns connection info
 */
export function getConnectionInfo(): { connected: boolean; lastUpdate: number } {
    return { connected: state.connected, lastUpdate: state.lastUpdate };
}
