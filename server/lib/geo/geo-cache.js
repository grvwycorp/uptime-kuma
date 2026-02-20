const { R } = require("redbean-node");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const { log } = require("../../../src/util");

dayjs.extend(utc);

/** 7-day TTL for geo cache freshness */
const STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum in-memory cache entries (prevents unbounded growth) */
const MEMORY_CACHE_MAX = 5000;

/** @type {GeoCache|null} */
let instance = null;

/**
 * Two-tier cache for IP geolocation data.
 *
 * Tier 1: In-memory Map (fast, volatile)
 * Tier 2: Database target_geo table (persistent, survives restarts)
 *
 * Cache key: (probe_id, monitor_id, resolved_ip)
 * TTL: 7 days — after which the entry is considered stale and eligible for refresh.
 */
class GeoCache {

    /** @type {Map<string, {data: object, lastUpdated: number}>} */
    memoryCache = new Map();

    /**
     * Get or create the singleton instance.
     * @returns {GeoCache}
     */
    static getInstance() {
        if (!instance) {
            instance = new GeoCache();
        }
        return instance;
    }

    /**
     * Build the in-memory cache key.
     * @param {string} probeId Probe ID
     * @param {number} monitorId Monitor ID
     * @param {string} ip Resolved IP
     * @returns {string}
     */
    buildKey(probeId, monitorId, ip) {
        return `${probeId}:${monitorId}:${ip}`;
    }

    /**
     * Get geo data from cache (memory first, then database).
     * @param {string} probeId Probe ID
     * @param {number} monitorId Monitor ID
     * @param {string} ip Resolved IP address
     * @returns {Promise<{data: object, isStale: boolean}|null>} Cached data or null on miss
     */
    async get(probeId, monitorId, ip) {
        const key = this.buildKey(probeId, monitorId, ip);

        // Tier 1: In-memory
        if (this.memoryCache.has(key)) {
            const entry = this.memoryCache.get(key);
            const isStale = (Date.now() - entry.lastUpdated) > STALE_TTL_MS;
            return { data: entry.data, isStale };
        }

        // Tier 2: Database
        try {
            const row = await R.getRow(
                "SELECT lat, lon, country, city, asn, last_updated FROM target_geo WHERE probe_id = ? AND monitor_id = ? AND resolved_ip = ?",
                [probeId, monitorId, ip]
            );

            if (!row) {
                return null;
            }

            const data = {
                lat: row.lat,
                lon: row.lon,
                country: row.country || "",
                city: row.city || "",
                asn: row.asn || "",
            };

            const lastUpdated = new Date(row.last_updated).getTime();
            const isStale = (Date.now() - lastUpdated) > STALE_TTL_MS;

            // Promote to memory cache
            this.setMemory(key, data, lastUpdated);

            return { data, isStale };
        } catch (err) {
            log.debug("geo-cache", `DB read failed: ${err.message}`);
            return null;
        }
    }

    /**
     * Store geo data in both memory and database.
     * Uses SELECT-then-INSERT/UPDATE for SQLite + MariaDB portability.
     * @param {string} probeId Probe ID
     * @param {number} monitorId Monitor ID
     * @param {string} ip Resolved IP address
     * @param {object} geoData Geo data from provider
     */
    async set(probeId, monitorId, ip, geoData) {
        const key = this.buildKey(probeId, monitorId, ip);
        const now = Date.now();

        // Tier 1: Memory
        this.setMemory(key, geoData, now);

        // Tier 2: Database (upsert via SELECT + INSERT/UPDATE for portability)
        try {
            const nowIso = R.isoDateTime(dayjs.utc());
            const existing = await R.getRow(
                "SELECT id FROM target_geo WHERE probe_id = ? AND monitor_id = ? AND resolved_ip = ?",
                [probeId, monitorId, ip]
            );

            if (existing) {
                await R.exec(
                    "UPDATE target_geo SET lat = ?, lon = ?, country = ?, city = ?, asn = ?, last_updated = ? WHERE id = ?",
                    [geoData.lat, geoData.lon, geoData.country, geoData.city, geoData.asn, nowIso, existing.id]
                );
            } else {
                await R.exec(
                    "INSERT INTO target_geo (probe_id, monitor_id, resolved_ip, lat, lon, country, city, asn, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [probeId, monitorId, ip, geoData.lat, geoData.lon, geoData.country, geoData.city, geoData.asn, nowIso]
                );
            }
        } catch (err) {
            log.debug("geo-cache", `DB write failed: ${err.message}`);
        }
    }

    /**
     * Store entry in memory cache with FIFO eviction.
     * @param {string} key Cache key
     * @param {object} data Geo data
     * @param {number} lastUpdated Timestamp in ms
     */
    setMemory(key, data, lastUpdated) {
        if (this.memoryCache.size >= MEMORY_CACHE_MAX && !this.memoryCache.has(key)) {
            // Evict oldest entry (Map preserves insertion order)
            const firstKey = this.memoryCache.keys().next().value;
            this.memoryCache.delete(firstKey);
        }
        this.memoryCache.set(key, { data, lastUpdated });
    }

    /**
     * Delete stale entries from the database.
     * Called periodically from a background job.
     * @param {number} maxAgeDays Maximum age in days before deletion (default 30)
     * @returns {Promise<void>}
     */
    async cleanup(maxAgeDays = 30) {
        try {
            const cutoff = dayjs.utc().subtract(maxAgeDays, "day").format("YYYY-MM-DD HH:mm:ss");
            await R.exec(
                "DELETE FROM target_geo WHERE last_updated < ?",
                [cutoff]
            );
            log.info("geo-cache", `Cleaned up target_geo entries older than ${maxAgeDays} days`);
        } catch (err) {
            log.debug("geo-cache", `Cleanup failed: ${err.message}`);
        }
    }

    /**
     * Clear all in-memory cache entries.
     */
    clearMemory() {
        this.memoryCache.clear();
    }
}

module.exports = { GeoCache };
