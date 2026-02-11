/**
 * PATCH /api/monitors/:id/description
 * Updates a monitor's description on the Uptime Kuma master via Socket.IO.
 * Reads the full monitor object from kuma-state, merges the new description,
 * and emits editMonitor to avoid overwriting other fields.
 *
 * Body: { "description": "markdown string" }
 */
import { getMonitors } from "~/server/utils/kuma-state";
import { getKumaSocket } from "~/server/plugins/kuma-socket";

export default defineEventHandler(async (event) => {
    const id = getRouterParam(event, "id");
    if (!id || isNaN(Number(id))) {
        throw createError({ statusCode: 400, statusMessage: "Invalid monitor ID" });
    }

    const body = await readBody<{ description?: string }>(event);
    if (typeof body?.description !== "string") {
        throw createError({ statusCode: 400, statusMessage: "Body must contain a \"description\" string" });
    }

    const monitors = getMonitors();
    const monitor = monitors[id];
    if (!monitor) {
        throw createError({ statusCode: 404, statusMessage: `Monitor ${id} not found` });
    }

    const socket = getKumaSocket();
    if (!socket || !socket.connected) {
        throw createError({ statusCode: 503, statusMessage: "Not connected to Uptime Kuma master" });
    }

    // Merge the new description into the full monitor object
    const payload = { ...monitor, description: body.description };

    // Emit editMonitor and wait for the callback
    const result = await new Promise<{ ok: boolean; msg?: string }>((resolve) => {
        socket.emit("editMonitor", payload, (res: { ok: boolean; msg?: string }) => {
            resolve(res);
        });
    });

    if (!result.ok) {
        throw createError({ statusCode: 502, statusMessage: result.msg || "editMonitor failed" });
    }

    console.log(`[api] Updated description for monitor ${id} (${monitor.name})`);

    return { ok: true, monitorId: Number(id), name: monitor.name };
});
