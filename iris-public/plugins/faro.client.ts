/**
 * Grafana Faro client-side plugin.
 * Initializes frontend observability on public pages only.
 * No cookies, no session tracking.
 */
export default defineNuxtPlugin(() => {
    const config = useRuntimeConfig();
    const faroUrl = config.public.faroUrl as string;

    if (!faroUrl) {
        return;
    }

    const route = useRoute();

    // Only initialize Faro on public pages (not /docs/*)
    if (route.path.startsWith("/docs")) {
        return;
    }

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
            sessionTracking: { enabled: false },
        });
    }).catch((err) => {
        console.warn("[faro] Failed to initialize:", err);
    });
});
