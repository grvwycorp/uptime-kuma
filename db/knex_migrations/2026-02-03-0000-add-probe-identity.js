/**
 * Migration to create probe_identity table for stable probe identification.
 * This table stores a single UUID that persists across restarts.
 */
exports.up = function (knex) {
    return knex.schema.createTable("probe_identity", function (table) {
        // Single row constraint - only id=1 is allowed
        table.integer("id").primary().checkIn([1]);
        table.string("probe_uuid", 36).notNullable();
        table.datetime("created_at").defaultTo(knex.fn.now());
    });
};

exports.down = function (knex) {
    return knex.schema.dropTable("probe_identity");
};
