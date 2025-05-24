exports.up = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.text("globalping_locations");
        table.integer("globalping_success_threshold").defaultTo(80);
        table.text("globalping_api_token");
        table.boolean("globalping_auto_pause").defaultTo(false);
        table.integer("globalping_consecutive_429s").defaultTo(0);
        table.boolean("globalping_enable_progress_tracking").defaultTo(false);
        table.boolean("globalping_enable_observability").defaultTo(false);
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.dropColumn("globalping_locations");
        table.dropColumn("globalping_success_threshold");
        table.dropColumn("globalping_api_token");
        table.dropColumn("globalping_auto_pause");
        table.dropColumn("globalping_consecutive_429s");
        table.dropColumn("globalping_enable_progress_tracking");
        table.dropColumn("globalping_enable_observability");
    });
};
