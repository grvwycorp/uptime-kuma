/**
 * Grafana Faro client-side plugin.
 * Initializes frontend observability on public pages only.
 * No cookies, no session tracking.
 */
export default defineNuxtPlugin(() => {
    const config = useRuntimeConfig();
    const faroUrl = config.public.faroUrl as string;

    if (!faroUrl) {
        console.log("[faro] Disabled (no NUXT_PUBLIC_FARO_URL configured)");
        return;
    }

    const route = useRoute();

    // Only initialize Faro on public pages (not /docs/*)
    if (route.path.startsWith("/docs")) {
        console.log("[faro] Skipped on /docs route");
        return;
    }

    console.log("[faro] Initializing with collector:", faroUrl.replace(/\/collect\/.*/, "/collect/***"));

    // Dynamic import to avoid bundling Faro on auth-protected pages
    Promise.all([
        import("@grafana/faro-web-sdk"),
        import("@grafana/faro-web-tracing"),
    ]).then(([{ initializeFaro, getWebInstrumentations }, { TracingInstrumentation }]) => {
        initializeFaro({
            url: faroUrl,
            app: { name: "iris-public", version: "1.0.0", environment: "production" },
            instrumentations: [
                ...getWebInstrumentations(),
                new TracingInstrumentation(),
            ],
        });
        console.log("[faro] Initialized successfully");
    }).catch((err) => {
        console.warn("[faro] Failed to initialize:", err);
    });
});
