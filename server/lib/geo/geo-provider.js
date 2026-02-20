/**
 * Abstract base class for IP Geolocation providers.
 *
 * All providers must implement lookup(ip) and discoverSelf().
 * Return contract for lookup():
 *   { lat: number|null, lon: number|null, country: string, city: string,
 *     region: string, asn: string, org: string }
 *
 * Swap providers by setting GEO_PROVIDER env var.
 * See geo-registry.js for the factory.
 */
class GeoProvider {

    /**
     * Provider name (must be overridden)
     * @type {string}
     */
    name = undefined;

    /**
     * Look up geolocation data for a specific IP address.
     * @param {string} ip IPv4 or IPv6 address
     * @returns {Promise<{lat: number|null, lon: number|null, country: string, city: string, region: string, asn: string, org: string}>}
     */
    async lookup(ip) {
        throw new Error("GeoProvider.lookup() must be overridden");
    }

    /**
     * Discover the caller's own public IP and geolocation.
     * Used for probe self-registration at startup.
     * @returns {Promise<{ip: string, lat: number|null, lon: number|null, country: string, city: string, region: string, asn: string, org: string}>}
     */
    async discoverSelf() {
        throw new Error("GeoProvider.discoverSelf() must be overridden");
    }
}

module.exports = GeoProvider;
