const { log } = require("../../../src/util");

/**
 * Provider factory map.
 * Add new providers here — they are lazy-loaded to avoid importing
 * unused dependencies.
 */
const PROVIDERS = {
    "ipbot": () => {
        const IpbotGeoProvider = require("./providers/ipbot");
        return new IpbotGeoProvider(process.env.GEO_API_KEY);
    },
    // Future providers:
    // "maxmind": () => { ... },
    // "ipinfo": () => { ... },
};

/** @type {GeoRegistry|null} */
let instance = null;

/**
 * Singleton registry for the IP geolocation subsystem.
 *
 * Reads GEO_PROVIDER env var to select which provider to use.
 * If GEO_PROVIDER is not set, the entire subsystem is disabled
 * and all calls are no-ops.
 *
 * Usage:
 *   const { GeoRegistry } = require("./lib/geo/geo-registry");
 *   await GeoRegistry.getInstance().init();
 *
 *   // Later:
 *   const geo = await GeoRegistry.getInstance().lookup("1.2.3.4");
 */
class GeoRegistry {

    /** @type {import('./geo-provider')|null} */
    provider = null;

    /** @type {boolean} */
    enabled = false;

    /**
     * Get or create the singleton instance.
     * @returns {GeoRegistry}
     */
    static getInstance() {
        if (!instance) {
            instance = new GeoRegistry();
        }
        return instance;
    }

    /**
     * Initialize the geolocation subsystem.
     * Reads GEO_PROVIDER env var and instantiates the matching provider.
     */
    async init() {
        const providerName = (process.env.GEO_PROVIDER || "").toLowerCase().trim();

        if (!providerName) {
            log.info("geo", "GEO_PROVIDER not set, geolocation subsystem disabled");
            this.enabled = false;
            return;
        }

        const factory = PROVIDERS[providerName];
        if (!factory) {
            log.error("geo", `Unknown GEO_PROVIDER: "${providerName}". Available: ${Object.keys(PROVIDERS).join(", ")}`);
            this.enabled = false;
            return;
        }

        this.provider = factory();
        this.enabled = true;
        log.info("geo", `Geolocation provider initialized: ${this.provider.name}`);
    }

    /**
     * Look up geolocation for an IP address through the configured provider.
     * Returns null if the subsystem is disabled or the lookup fails.
     * @param {string} ip IPv4 or IPv6 address
     * @returns {Promise<{lat: number|null, lon: number|null, country: string, city: string, region: string, asn: string, org: string}|null>}
     */
    async lookup(ip) {
        if (!this.enabled || !this.provider) {
            return null;
        }
        return await this.provider.lookup(ip);
    }

    /**
     * Discover the probe's own public IP and geolocation.
     * Returns null if the subsystem is disabled or discovery fails.
     * @returns {Promise<{ip: string, lat: number|null, lon: number|null, country: string, city: string, region: string, asn: string, org: string}|null>}
     */
    async discoverSelf() {
        if (!this.enabled || !this.provider) {
            return null;
        }
        return await this.provider.discoverSelf();
    }
}

module.exports = { GeoRegistry };
