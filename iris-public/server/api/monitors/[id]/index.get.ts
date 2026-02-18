/**
 * GET /api/monitors/:id
 * Returns a single monitor from the in-memory state.
 */
import { getMonitors } from "~/server/utils/kuma-state";

export default defineEventHandler((event) => {
    const id = getRouterParam(event, "id");
    if (!id || isNaN(Number(id))) {
        throw createError({ statusCode: 400, statusMessage: "Invalid monitor ID" });
    }

    const monitors = getMonitors();
    const monitor = monitors[id];
    if (!monitor) {
        throw createError({ statusCode: 404, statusMessage: `Monitor ${id} not found` });
    }

    return monitor;
});
