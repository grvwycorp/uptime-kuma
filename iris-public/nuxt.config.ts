export default defineNuxtConfig({
    compatibilityDate: "2025-01-01",
    devtools: { enabled: true },

    app: {
        head: {
            title: "Iris — Fungerar Sveriges digitala tjänster?",
            meta: [
                { charset: "utf-8" },
                { name: "viewport", content: "width=device-width, initial-scale=1" },
                { name: "description", content: "Oberoende koll på Sveriges viktigaste digitala tjänster — BankID, Swish, 1177 med flera. Vi kontrollerar dem dygnet runt från flera platser i Sverige." },
            ],
            link: [
                { rel: "preconnect", href: "https://fonts.googleapis.com" },
                { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
                { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap" },
            ],
            htmlAttrs: { lang: "sv" },
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
        vmQueryUrl: process.env.VM_QUERY_URL || "http://localhost:8428",
        authUsername: process.env.AUTH_USERNAME || "admin",
        authPassword: process.env.AUTH_PASSWORD || "changeme",

        // Public (exposed to client)
        public: {
            statusPollInterval: parseInt(process.env.STATUS_POLL_INTERVAL || "15000"),
            faroUrl: "",
        },
    },

    nitro: {
        experimental: {
            websocket: true,
        },
        // Disable prerendering — server plugins (kuma-socket, rate-limiter)
        // hold the process open during prerender, causing builds to hang.
        prerender: {
            crawlLinks: false,
            routes: [],
        },
    },
});
