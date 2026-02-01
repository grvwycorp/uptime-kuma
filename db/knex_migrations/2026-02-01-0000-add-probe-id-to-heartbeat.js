exports.up = function (knex) {
    return knex.schema.alterTable("heartbeat", function (table) {
        table.string("probe_id", 255).nullable().defaultTo(null);
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable("heartbeat", function (table) {
        table.dropColumn("probe_id");
    });
};
