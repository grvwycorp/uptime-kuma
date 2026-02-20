/**
 * Nitro server plugin: logs Faro configuration at startup.
 * The actual Faro SDK runs client-side (faro.client.ts), but this
 * provides server-side visibility in docker logs.
 */
export default defineNitroPlugin(() => {
    const config = useRuntimeConfig();
    const faroUrl = config.public.faroUrl as string;

    if (faroUrl) {
        // Mask the collector key for log safety
        const masked = faroUrl.replace(/\/collect\/.*/, "/collect/***");
        console.log(`[faro] Frontend observability enabled → ${masked}`);
    } else {
        console.log("[faro] Frontend observability disabled (NUXT_PUBLIC_FARO_URL not set)");
    }
});
