/**
 * Nitro server plugin: maintains a persistent Socket.IO connection to the
 * Uptime Kuma master instance. Populates the in-memory kuma-state store
 * with monitor configs, descriptions, hierarchy, and tags.
 */
import { io, Socket } from "socket.io-client";
import { setMonitors, setConnected } from "../utils/kuma-state";

let socket: Socket | null = null;
let token: string | null = null;

/**
 * Get the shared Socket.IO client instance (used by API routes to emit events)
 * @returns the socket or null if not connected
 */
export function getKumaSocket(): Socket | null {
    return socket;
}

/**
 * Login to Uptime Kuma via Socket.IO
 * @param sock - Socket.IO client instance
 * @param username - admin username
 * @param password - admin password
 * @returns JWT token on success
 */
function login(sock: Socket, username: string, password: string): Promise<string> {
    return new Promise((resolve, reject) => {
        sock.emit("login", { username, password }, (res: { ok: boolean; token?: string; msg?: string }) => {
            if (res.ok && res.token) {
                resolve(res.token);
            } else {
                reject(new Error(res.msg || "Login failed"));
            }
        });
    });
}

/**
 * Re-authenticate using a saved JWT token
 * @param sock - Socket.IO client instance
 * @param savedToken - previously issued JWT token
 * @returns true if re-auth succeeded
 */
function loginByToken(sock: Socket, savedToken: string): Promise<boolean> {
    return new Promise((resolve) => {
        sock.emit("loginByToken", savedToken, (res: { ok: boolean }) => {
            resolve(res.ok);
        });
    });
}

export default defineNitroPlugin(() => {
    const config = useRuntimeConfig();
    const url = config.kumaUrl as string;
    const username = config.kumaUsername as string;
    const password = config.kumaPassword as string;

    if (!password) {
        console.warn("[kuma-socket] KUMA_PASSWORD not set, skipping connection");
        return;
    }

    console.log(`[kuma-socket] Connecting to Uptime Kuma at ${url}`);
    socket = io(url, {
        reconnection: true,
        reconnectionDelay: 3000,
        reconnectionDelayMax: 30000,
        timeout: 10000,
    });

    socket.on("connect", async () => {
        console.log("[kuma-socket] Connected to master");
        setConnected(true);

        try {
            // Try token re-auth first, fall back to username/password
            if (token) {
                const ok = await loginByToken(socket!, token);
                if (ok) {
                    console.log("[kuma-socket] Re-authenticated with token");
                    return;
                }
            }
            token = await login(socket!, username, password);
            console.log("[kuma-socket] Logged in successfully");
        } catch (err) {
            console.error("[kuma-socket] Login failed:", err);
        }
    });

    socket.on("disconnect", (reason) => {
        console.warn(`[kuma-socket] Disconnected: ${reason}`);
        setConnected(false);
    });

    // Full monitor list (sent after login and on changes)
    socket.on("monitorList", (data: Record<string, unknown>) => {
        setMonitors(data as any);
        const count = Object.keys(data).length;
        console.log(`[kuma-socket] Received monitorList (${count} monitors)`);
    });

    // Incremental updates
    socket.on("updateMonitorIntoList", (data: Record<string, unknown>) => {
        const { getMonitors } = require("../utils/kuma-state");
        const monitors = { ...getMonitors(), ...data };
        setMonitors(monitors as any);
    });

    // Monitor removals
    socket.on("deleteMonitorFromList", (monitorID: string) => {
        const { getMonitors } = require("../utils/kuma-state");
        const monitors = { ...getMonitors() };
        delete monitors[monitorID];
        setMonitors(monitors);
    });

    socket.on("connect_error", (err) => {
        console.warn(`[kuma-socket] Connection error: ${err.message}`);
    });
});
