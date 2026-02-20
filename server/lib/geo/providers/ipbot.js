const axios = require("axios");
const GeoProvider = require("../geo-provider");

/**
 * IPbot geolocation provider.
 *
 * API docs: https://ipbot.com/quickstart/
 * Schema:   https://ipbot.com/response-schema/
 *
 * Base URL: https://api.ipbot.com
 * - GET /{ip}  → lookup specific IP
 * - GET /      → returns caller's own IP + geo (probe self-registration)
 *
 * Auth: Anonymous = 60 req/min. X-API-Key header = 200 req/min (free tier).
 *
 * Response shape:
 * {
 *   ip: "1.2.3.4",
 *   location: { country_code, city, latitude, longitude, region, postal, timezone },
 *   network:  { asn, org, radar },
 *   security: { risk_score, is_datacenter, is_proxy, threat_level, ... },
 *   ...
 * }
 */
class IpbotGeoProvider extends GeoProvider {

    /** @type {string} */
    name = "ipbot";

    /**
     * @param {string} apiKey API key for higher rate limits (optional)
     */
    constructor(apiKey) {
        super();
        this.apiKey = apiKey || null;
        this.baseUrl = "https://api.ipbot.com";
    }

    /**
     * Look up geolocation for a specific IP address.
     * @param {string} ip IPv4 or IPv6 address
     * @returns {Promise<{lat: number|null, lon: number|null, country: string, city: string, region: string, asn: string, org: string}>}
     */
    async lookup(ip) {
        const headers = this.buildHeaders();
        const resp = await axios.get(`${this.baseUrl}/${ip}`, {
            headers,
            timeout: 5000,
        });
        return this.normalize(resp.data);
    }

    /**
     * Discover the caller's own public IP and geolocation.
     * IPbot returns the caller's IP when no IP parameter is provided.
     * @returns {Promise<{ip: string, lat: number|null, lon: number|null, country: string, city: string, region: string, asn: string, org: string}>}
     */
    async discoverSelf() {
        const headers = this.buildHeaders();
        const resp = await axios.get(this.baseUrl, {
            headers,
            timeout: 5000,
        });
        return {
            ip: resp.data.ip || "",
            ...this.normalize(resp.data),
        };
    }

    /**
     * Build request headers.
     * @returns {object} Headers object
     */
    buildHeaders() {
        const headers = { "User-Agent": "Iris-Probe/1.0" };
        if (this.apiKey) {
            headers["X-API-Key"] = this.apiKey;
        }
        return headers;
    }

    /**
     * Normalize IPbot response to the standard GeoProvider format.
     * @param {object} data Raw IPbot API response
     * @returns {{lat: number|null, lon: number|null, country: string, city: string, region: string, asn: string, org: string}}
     */
    normalize(data) {
        const loc = data.location || {};
        const net = data.network || {};
        return {
            lat: loc.latitude ?? null,
            lon: loc.longitude ?? null,
            country: loc.country_code || "",
            city: loc.city || "",
            region: loc.region || "",
            asn: net.asn || "",
            org: net.org || "",
        };
    }
}

module.exports = IpbotGeoProvider;
