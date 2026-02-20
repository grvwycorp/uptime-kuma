const dns = require("node:dns/promises");
const { log } = require("../../../src/util");
const { getProbeIdSync } = require("../identity");

/**
 * Non-network monitor types excluded from geo resolution.
 * These don't perform outbound network requests so there is no target IP.
 */
const NON_NETWORK_TYPES = new Set(["group", "push", "manual"]);

/**
 * Resolve target geolocation for a monitor.
 *
 * Flow:
 * 1. Extract hostname from monitor (URL or hostname field)
 * 2. DNS resolve using the probe's local OS resolver (critical for anycast correctness)
 * 3. Check cache for existing geo data for this (probe, monitor, IP)
 * 4. If cache miss or stale: call GeoRegistry.lookup(ip)
 * 5. Store result in cache (memory + database)
 * 6. Update the target_geo_info metric for Grafana joins
 *
 * This function is called fire-and-forget from the beat() loop.
 * It must never throw — errors are caught and logged at debug level.
 * @param {object} monitor The monitor bean
 * @returns {Promise<void>}
 */
async function resolveTargetGeo(monitor) {
    if (NON_NETWORK_TYPES.has(monitor.type)) {
        return;
    }

    const { GeoRegistry } = require("./geo-registry");
    const geoRegistry = GeoRegistry.getInstance();
    if (!geoRegistry.enabled) {
        return;
    }

    const probeId = getProbeIdSync();
    if (!probeId) {
        return;
    }

    // Step 1: Extract hostname from monitor
    const hostname = extractHostname(monitor);
    if (!hostname) {
        return;
    }

    // Step 2: DNS resolve locally on this probe (OS resolver = anycast-correct)
    let resolvedIp;
    try {
        const result = await dns.lookup(hostname);
        resolvedIp = result.address;
    } catch (err) {
        log.debug("geo", `DNS lookup failed for ${hostname}: ${err.message}`);
        return;
    }

    // Step 3: Check cache
    const { GeoCache } = require("./geo-cache");
    const geoCache = GeoCache.getInstance();
    const cached = await geoCache.get(probeId, monitor.id, resolvedIp);

    if (cached && !cached.isStale) {
        // Fresh cache hit — just ensure the metric is current
        updateGeoMetric(probeId, monitor.id, resolvedIp, cached.data);
        return;
    }

    // Step 4: Cache miss or stale — call the geo provider
    try {
        const geoData = await geoRegistry.lookup(resolvedIp);
        if (!geoData) {
            return;
        }

        // Step 5: Store in cache (both tiers)
        await geoCache.set(probeId, monitor.id, resolvedIp, geoData);

        // Step 6: Update metric
        updateGeoMetric(probeId, monitor.id, resolvedIp, geoData);

        log.debug("geo", `Target geo resolved: monitor=${monitor.id} ip=${resolvedIp} → ${geoData.country}/${geoData.city}`);
    } catch (err) {
        log.debug("geo", `Geo lookup failed for ${resolvedIp}: ${err.message}`);
        // If we have stale data, still use it for the metric
        if (cached && cached.data) {
            updateGeoMetric(probeId, monitor.id, resolvedIp, cached.data);
        }
    }
}

/**
 * Extract hostname from a monitor bean.
 * HTTP-like monitors use the URL field, others use the hostname field.
 * @param {object} monitor Monitor bean
 * @returns {string|null} Hostname or null if not extractable
 */
function extractHostname(monitor) {
    // URL-based monitors (http, keyword, json-query, etc.)
    if (monitor.url) {
        try {
            return new URL(monitor.url).hostname;
        } catch (_) {
            // fall through to hostname field
        }
    }
    // Direct hostname monitors (ping, tcp/port, dns, etc.)
    if (monitor.hostname) {
        return monitor.hostname;
    }
    return null;
}

/**
 * Update the target_geo_info OTEL metric.
 * @param {string} probeId Probe ID
 * @param {number} monitorId Monitor ID
 * @param {string} resolvedIp The resolved IP address
 * @param {object} geoData Geo data object
 */
function updateGeoMetric(probeId, monitorId, resolvedIp, geoData) {
    const metrics = require("../metrics");
    if (!metrics.isInitialized()) {
        return;
    }
    metrics.recordTargetGeo(monitorId, {
        resolvedIp,
        lat: geoData.lat,
        lon: geoData.lon,
        country: geoData.country,
        city: geoData.city,
        asn: geoData.asn,
    });
}

module.exports = { resolveTargetGeo, extractHostname };
