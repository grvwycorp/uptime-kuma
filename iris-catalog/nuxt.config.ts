export default defineNuxtConfig({
    compatibilityDate: "2024-11-01",
    devtools: { enabled: true },

    css: ["~/assets/css/everforest.css"],

    modules: [
        "@nuxt/content",
    ],

    content: {
        documentDriven: false,
    },

    runtimeConfig: {
        // Server-only (not exposed to client)
        kumaUrl: process.env.KUMA_URL || "http://localhost:3001",
        kumaUsername: process.env.KUMA_USERNAME || "admin",
        kumaPassword: process.env.KUMA_PASSWORD || "",
        otelPromUrl: process.env.OTEL_PROM_URL || "http://localhost:8889/metrics",
        authUsername: process.env.AUTH_USERNAME || "admin",
        authPassword: process.env.AUTH_PASSWORD || "changeme",

        // Public (exposed to client)
        public: {
            statusPollInterval: parseInt(process.env.STATUS_POLL_INTERVAL || "8000"),
        },
    },

    nitro: {
        experimental: {
            websocket: true,
        },
    },
});
