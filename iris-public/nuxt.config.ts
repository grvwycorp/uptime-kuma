export default defineNuxtConfig({
    compatibilityDate: "2025-01-01",
    devtools: { enabled: true },

    app: {
        head: {
            title: "Iris — Swedish Infrastructure Status",
            meta: [
                { charset: "utf-8" },
                { name: "viewport", content: "width=device-width, initial-scale=1" },
                { name: "description", content: "Real-time availability monitoring of Swedish digital infrastructure" },
            ],
            htmlAttrs: { lang: "en" },
        },
    },

    css: ["~/assets/css/theme.css"],

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
            statusPollInterval: parseInt(process.env.STATUS_POLL_INTERVAL || "15000"),
            faroUrl: process.env.FARO_COLLECTOR_URL || "",
        },
    },

    nitro: {
        experimental: {
            websocket: true,
        },
    },
});
