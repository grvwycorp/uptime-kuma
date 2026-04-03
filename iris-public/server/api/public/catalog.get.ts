/**
 * GET /api/public/catalog
 *
 * Public read-only catalog payload for /docs.
 * Exposes sanitized monitor metadata plus live status.
 */
import { buildPublicCatalogResponse } from "~/server/utils/public-catalog";

export default defineEventHandler(async () => {
    const config = useRuntimeConfig();
    return buildPublicCatalogResponse(config.otelPromUrl as string);
});
