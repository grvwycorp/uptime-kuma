/**
 * Stable Probe Identity Module
 *
 * Ensures the probe has a permanent, stable UUID that persists across restarts.
 * This prevents "dirty label" issues in metrics where hostname or container ID
 * changes would create orphaned series.
 *
 * Priority order:
 * 1. IRIS_PROBE_ID env var (explicit override for special cases)
 * 2. SQLite-persisted UUID (stable across restarts)
 * 3. HOSTNAME env var (container fallback)
 * 4. "unknown" (should never happen in production)
 */
const crypto = require("crypto");
const { R } = require("redbean-node");
const { log } = require("../../src/util");

let cachedProbeId = null;

/**
 * Get or create a persistent probe UUID from the database.
 * Uses a single-row table (id=1) to store the UUID.
 * @returns {Promise<string>} The probe UUID
 */
async function getOrCreateFromDatabase() {
    // Check if UUID already exists
    const existing = await R.getRow("SELECT probe_uuid FROM probe_identity WHERE id = 1");

    if (existing && existing.probe_uuid) {
        log.debug("identity", `Loaded existing probe UUID: ${existing.probe_uuid}`);
        return existing.probe_uuid;
    }

    // Generate new UUID
    const newUuid = crypto.randomUUID();
    log.info("identity", `Generated new probe UUID: ${newUuid}`);

    // Insert new UUID (single row with id=1)
    await R.exec(
        "INSERT INTO probe_identity (id, probe_uuid, created_at) VALUES (1, ?, datetime('now'))",
        [newUuid]
    );

    return newUuid;
}

/**
 * Get the probe ID with fallback chain.
 * Results are cached after first call for performance.
 * @returns {Promise<string>} The probe ID
 */
async function getProbeId() {
    // Return cached value if available
    if (cachedProbeId) {
        return cachedProbeId;
    }

    // Priority 1: Explicit override via environment variable
    if (process.env.IRIS_PROBE_ID) {
        cachedProbeId = process.env.IRIS_PROBE_ID;
        log.info("identity", `Using IRIS_PROBE_ID from env: ${cachedProbeId}`);
        return cachedProbeId;
    }

    // Priority 2: SQLite-persisted UUID
    try {
        cachedProbeId = await getOrCreateFromDatabase();
        return cachedProbeId;
    } catch (err) {
        log.warn("identity", `Database unavailable for identity, falling back to hostname: ${err.message}`);
    }

    // Priority 3: HOSTNAME environment variable (common in containers)
    if (process.env.HOSTNAME) {
        cachedProbeId = process.env.HOSTNAME;
        log.info("identity", `Using HOSTNAME as probe ID: ${cachedProbeId}`);
        return cachedProbeId;
    }

    // Priority 4: Ultimate fallback
    cachedProbeId = "unknown";
    log.warn("identity", "No probe ID available, using 'unknown'");
    return cachedProbeId;
}

/**
 * Get the cached probe ID synchronously.
 * Must call getProbeId() first to initialize.
 * @returns {string|null} The cached probe ID or null if not initialized
 */
function getProbeIdSync() {
    return cachedProbeId;
}

/**
 * Clear the cached probe ID (for testing purposes)
 * @returns {void}
 */
function clearCache() {
    cachedProbeId = null;
}

module.exports = {
    getProbeId,
    getProbeIdSync,
    clearCache,
};
