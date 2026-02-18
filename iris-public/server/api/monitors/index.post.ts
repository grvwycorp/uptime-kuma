/**
 * POST /api/monitors
 * Creates a new monitor on the Uptime Kuma master via Socket.IO.
 *
 * Body: monitor config object. Required fields: name, type.
 * Optional fields depend on type (url for http, hostname for dns/ping, etc.)
 *
 * The handler applies sensible defaults for fields the Uptime Kuma
 * `add` event expects but that callers shouldn't need to know about.
 */
import { getKumaSocket } from "~/server/plugins/kuma-socket";

export default defineEventHandler(async (event) => {
    const body = await readBody<Record<string, unknown>>(event);

    if (!body?.name || typeof body.name !== "string") {
        throw createError({ statusCode: 400, statusMessage: "\"name\" is required" });
    }
    if (!body?.type || typeof body.type !== "string") {
        throw createError({ statusCode: 400, statusMessage: "\"type\" is required" });
    }

    const socket = getKumaSocket();
    if (!socket || !socket.connected) {
        throw createError({ statusCode: 503, statusMessage: "Not connected to Uptime Kuma master" });
    }

    // Apply defaults for fields the add handler expects
    const monitor: Record<string, unknown> = {
        active: true,
        interval: 60,
        retryInterval: 60,
        resendInterval: 0,
        maxretries: 0,
        notificationIDList: [],
        accepted_statuscodes: ["200-299"],
        kafkaProducerBrokers: [],
        kafkaProducerSaslOptions: {},
        conditions: [],
        rabbitmqNodes: [],
        ...body,
    };

    const result = await new Promise<{ ok: boolean; msg?: string; monitorID?: number }>((resolve) => {
        socket.emit("add", monitor, (res: { ok: boolean; msg?: string; monitorID?: number }) => {
            resolve(res);
        });
    });

    if (!result.ok) {
        throw createError({ statusCode: 502, statusMessage: result.msg || "Failed to add monitor" });
    }

    console.log(`[api] Created monitor ${result.monitorID} (${body.name})`);

    return { ok: true, monitorId: result.monitorID, name: body.name };
});
