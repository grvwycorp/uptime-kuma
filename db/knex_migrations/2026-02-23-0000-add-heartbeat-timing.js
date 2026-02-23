exports.up = function (knex) {
    return knex.schema.alterTable("heartbeat", function (table) {
        table.integer("timing_dns").nullable().defaultTo(null);
        table.integer("timing_tcp").nullable().defaultTo(null);
        table.integer("timing_tls").nullable().defaultTo(null);
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable("heartbeat", function (table) {
        table.dropColumn("timing_dns");
        table.dropColumn("timing_tcp");
        table.dropColumn("timing_tls");
    });
};
