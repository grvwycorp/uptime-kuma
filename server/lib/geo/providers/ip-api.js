const axios = require("axios");
const GeoProvider = require("../geo-provider");

/**
 * ip-api.com geolocation provider.
 *
 * API docs: http://ip-api.com/docs/api:json
 *
 * Base URL: http://ip-api.com/json
 * - GET /{ip}  → lookup specific IP
 * - GET /      → returns caller's own IP + geo (probe self-registration)
 *
 * Free tier: 45 req/min, HTTP only, no API key required.
 *
 * Response shape:
 * {
 *   status: "success",
 *   countryCode: "SE",
 *   regionName: "Stockholm",
 *   city: "Stockholm",
 *   lat: 59.3293,
 *   lon: 18.0686,
 *   as: "AS24940 Hetzner Online GmbH",
 *   org: "Hetzner",
 *   query: "64.112.124.66"
 * }
 */
class IpApiGeoProvider extends GeoProvider {

    /** @type {string} */
    name = "ip-api";

    /**
     * Constructor — no API key needed for ip-api.com free tier.
     */
    constructor() {
        super();
        // Free tier: HTTP only (HTTPS requires Pro subscription)
        this.baseUrl = "http://ip-api.com/json";
        this.fields = "status,message,countryCode,regionName,city,lat,lon,as,org,query";
    }

    /**
     * Look up geolocation for a specific IP address.
     * @param {string} ip IPv4 or IPv6 address
     * @returns {Promise<{lat: number|null, lon: number|null, country: string, city: string, region: string, asn: string, org: string}>} Normalized geo data
     */
    async lookup(ip) {
        const resp = await axios.get(`${this.baseUrl}/${ip}?fields=${this.fields}`, {
            timeout: 5000,
        });
        this.checkStatus(resp.data);
        return this.normalize(resp.data);
    }

    /**
     * Discover the caller's own public IP and geolocation.
     * ip-api.com returns the caller's IP when no IP parameter is provided.
     * @returns {Promise<{ip: string, lat: number|null, lon: number|null, country: string, city: string, region: string, asn: string, org: string}>} Caller's IP and geo data
     */
    async discoverSelf() {
        const resp = await axios.get(`${this.baseUrl}/?fields=${this.fields}`, {
            timeout: 5000,
        });
        this.checkStatus(resp.data);
        return {
            ip: resp.data.query || "",
            ...this.normalize(resp.data),
        };
    }

    /**
     * Check if the API returned an error status.
     * @param {object} data Raw API response
     * @returns {void}
     * @throws {Error} If the lookup failed
     */
    checkStatus(data) {
        if (data.status === "fail") {
            throw new Error(`ip-api lookup failed: ${data.message || "unknown error"}`);
        }
    }

    /**
     * Normalize ip-api.com response to the standard GeoProvider format.
     * @param {object} data Raw ip-api.com API response
     * @returns {{lat: number|null, lon: number|null, country: string, city: string, region: string, asn: string, org: string}} Normalized geo data
     */
    normalize(data) {
        // "as" field format: "AS24940 Hetzner Online GmbH" — extract just the AS number
        const asField = data.as || "";
        const asn = asField.split(" ")[0] || "";
        return {
            lat: data.lat ?? null,
            lon: data.lon ?? null,
            country: data.countryCode || "",
            city: data.city || "",
            region: data.regionName || "",
            asn: asn,
            org: data.org || "",
        };
    }
}

module.exports = IpApiGeoProvider;
