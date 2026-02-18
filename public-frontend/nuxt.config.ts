export default defineNuxtConfig({
    compatibilityDate: "2025-01-01",
    devtools: { enabled: false },
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
    runtimeConfig: {
        // Server-only (not exposed to client)
        catalogUrl: process.env.CATALOG_URL || "http://localhost:3002",
        catalogUsername: process.env.CATALOG_USERNAME || "admin",
        catalogPassword: process.env.CATALOG_PASSWORD || "",
        // Public (exposed to client)
        public: {
            statusPollInterval: parseInt(process.env.STATUS_POLL_INTERVAL || "15000"),
        },
    },
});
