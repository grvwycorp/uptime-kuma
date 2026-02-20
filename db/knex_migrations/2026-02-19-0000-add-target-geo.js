/**
 * Migration to create target_geo table for caching IP geolocation data.
 * Stores per-probe, per-IP geo metadata with TTL for cache freshness.
 *
 * The compound unique constraint (probe_id, monitor_id, resolved_ip) solves
 * the anycast problem: the same monitor can resolve to different IPs from
 * different probes, each with its own geo data.
 * @param {object} knex Knex instance
 * @returns {Promise<void>}
 */
exports.up = function (knex) {
    return knex.schema.createTable("target_geo", function (table) {
        table.increments("id").primary();
        table.string("probe_id", 255).notNullable();
        table.integer("monitor_id").notNullable();
        table.string("resolved_ip", 45).notNullable();
        table.float("lat").nullable();
        table.float("lon").nullable();
        table.string("country", 10).nullable();
        table.string("city", 255).nullable();
        table.string("asn", 50).nullable();
        table.datetime("last_updated").notNullable();
        table.datetime("created_at").defaultTo(knex.fn.now());

        table.unique(["probe_id", "monitor_id", "resolved_ip"]);
        table.index(["last_updated"], "idx_target_geo_ttl");
        table.index(["monitor_id", "probe_id"], "idx_target_geo_monitor");
    });
};

/**
 * Roll back the target_geo table creation.
 * @param {object} knex Knex instance
 * @returns {Promise<void>}
 */
exports.down = function (knex) {
    return knex.schema.dropTable("target_geo");
};
