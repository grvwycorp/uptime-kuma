/**
 * GET /api/public/catalog/:id
 *
 * Public read-only monitor detail payload for future on-demand detail fetches.
 */
import type { PublicCatalogMonitor } from "~/types/public";
import { buildPublicCatalogResponse } from "~/server/utils/public-catalog";

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig();
    const catalog = await buildPublicCatalogResponse(config.otelPromUrl as string);
    const id = getRouterParam(event, "id");

    if (!id) {
        throw createError({ statusCode: 400, statusMessage: "Missing monitor ID" });
    }

    const monitor = catalog.monitors[id] as PublicCatalogMonitor | undefined;
    if (!monitor) {
        throw createError({ statusCode: 404, statusMessage: "Monitor not found" });
    }

    return {
        connected: catalog.connected,
        monitorListUpdatedAt: catalog.monitorListUpdatedAt,
        statusLastUpdated: catalog.statusLastUpdated,
        monitor,
        status: catalog.status[id] || null,
    };
});
