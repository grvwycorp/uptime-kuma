package db

import (
	"context"
	"database/sql"
	"fmt"

	_ "github.com/go-sql-driver/mysql"
)

// Repository provides access to the master MariaDB database.
type Repository struct {
	db *sql.DB
}

// NewRepository creates a new MariaDB repository with connection pooling.
func NewRepository(host string, port int, database, username, password string) (*Repository, error) {
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?parseTime=true&charset=utf8mb4&collation=utf8mb4_unicode_ci",
		username, password, host, port, database)

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open database connection: %w", err)
	}

	// Configure connection pool
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)

	// Verify connection
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &Repository{db: db}, nil
}

// Close closes the database connection pool.
func (r *Repository) Close() error {
	return r.db.Close()
}

// GetAllMonitors retrieves all active monitors from the master database.
func (r *Repository) GetAllMonitors(ctx context.Context) (map[int64]*Monitor, error) {
	query := `
		SELECT
			id, name, description, user_id, parent, weight, type, subtype, active,
			url, method, body, headers, http_body_encoding, maxredirects,
			accepted_statuscodes_json, keyword, invert_keyword,
			` + "`interval`" + `, retry_interval, resend_interval, timeout, maxretries,
			hostname, port, dns_resolve_type, dns_resolve_server,
			ignore_tls, expiry_notification, domain_expiry_notification,
			tls_ca, tls_cert, tls_key, expected_tls_alert,
			auth_method, basic_auth_user, basic_auth_pass, auth_domain, auth_workstation,
			oauth_client_id, oauth_client_secret, oauth_token_url,
			oauth_scopes, oauth_audience, oauth_auth_method,
			json_path, json_path_operator, expected_value,
			mqtt_topic, mqtt_username, mqtt_password, mqtt_success_message,
			mqtt_check_type, mqtt_websocket_path,
			database_connection_string, database_query,
			docker_container, docker_host,
			grpc_url, grpc_protobuf, grpc_method, grpc_service_name,
			grpc_body, grpc_metadata, grpc_enable_tls,
			push_token, packet_size, ping_numeric, ping_count, ping_per_request_timeout,
			game, gamedig_given_port_only,
			radius_username, radius_password, radius_secret,
			radius_called_station_id, radius_calling_station_id,
			kafka_producer_topic, kafka_producer_brokers, kafka_producer_sasl_options,
			kafka_producer_message, kafka_producer_ssl, kafka_producer_allow_auto_topic_creation,
			rabbitmq_nodes, rabbitmq_username, rabbitmq_password,
			snmp_oid, snmp_version, snmp_v3_username, smtp_security,
			ws_ignore_sec_websocket_accept_header, ws_subprotocol, conditions,
			upside_down, cache_bust, retry_only_on_status_code_failure,
			proxy_id, ip_family, remote_browser, screenshot_delay,
			save_response, save_error_response, response_max_length,
			system_service_name, manual_status, location, protocol
		FROM monitor
		WHERE active = 1
		ORDER BY weight DESC, name ASC
	`

	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query monitors: %w", err)
	}
	defer rows.Close()

	monitors := make(map[int64]*Monitor)

	for rows.Next() {
		m := &Monitor{}

		err := rows.Scan(
			&m.ID, &m.Name, &m.Description, &m.UserID, &m.Parent, &m.Weight,
			&m.Type, &m.Subtype, &m.Active,
			&m.URL, &m.Method, &m.Body, &m.Headers, &m.HTTPBodyEncoding, &m.MaxRedirects,
			&m.AcceptedStatusCodesJSON, &m.Keyword, &m.InvertKeyword,
			&m.Interval, &m.RetryInterval, &m.ResendInterval, &m.Timeout, &m.MaxRetries,
			&m.Hostname, &m.Port, &m.DNSResolveType, &m.DNSResolveServer,
			&m.IgnoreTLS, &m.ExpiryNotification, &m.DomainExpiryNotification,
			&m.TLSCa, &m.TLSCert, &m.TLSKey, &m.ExpectedTLSAlert,
			&m.AuthMethod, &m.BasicAuthUser, &m.BasicAuthPass, &m.AuthDomain, &m.AuthWorkstation,
			&m.OAuthClientID, &m.OAuthClientSecret, &m.OAuthTokenURL,
			&m.OAuthScopes, &m.OAuthAudience, &m.OAuthAuthMethod,
			&m.JSONPath, &m.JSONPathOperator, &m.ExpectedValue,
			&m.MQTTTopic, &m.MQTTUsername, &m.MQTTPassword, &m.MQTTSuccessMessage,
			&m.MQTTCheckType, &m.MQTTWebsocketPath,
			&m.DatabaseConnectionString, &m.DatabaseQuery,
			&m.DockerContainer, &m.DockerHost,
			&m.GRPCUrl, &m.GRPCProtobuf, &m.GRPCMethod, &m.GRPCServiceName,
			&m.GRPCBody, &m.GRPCMetadata, &m.GRPCEnableTLS,
			&m.PushToken, &m.PacketSize, &m.PingNumeric, &m.PingCount, &m.PingPerRequestTimeout,
			&m.Game, &m.GamedigGivenPortOnly,
			&m.RadiusUsername, &m.RadiusPassword, &m.RadiusSecret,
			&m.RadiusCalledStationID, &m.RadiusCallingStationID,
			&m.KafkaProducerTopic, &m.KafkaProducerBrokers, &m.KafkaProducerSaslOptions,
			&m.KafkaProducerMessage, &m.KafkaProducerSsl, &m.KafkaProducerAllowAutoTopicCreation,
			&m.RabbitMQNodes, &m.RabbitMQUsername, &m.RabbitMQPassword,
			&m.SNMPOid, &m.SNMPVersion, &m.SNMPV3Username, &m.SMTPSecurity,
			&m.WSIgnoreSecWebsocketAcceptHeader, &m.WSSubprotocol, &m.Conditions,
			&m.UpsideDown, &m.CacheBust, &m.RetryOnlyOnStatusCodeFailure,
			&m.ProxyID, &m.IPFamily, &m.RemoteBrowser, &m.ScreenshotDelay,
			&m.SaveResponse, &m.SaveErrorResponse, &m.ResponseMaxLength,
			&m.SystemServiceName, &m.ManualStatus, &m.Location, &m.Protocol,
		)

		if err != nil {
			return nil, fmt.Errorf("failed to scan monitor row: %w", err)
		}

		monitors[m.ID] = m
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating monitor rows: %w", err)
	}

	return monitors, nil
}

// GetMonitorsByTags retrieves monitors that have any of the specified tags.
func (r *Repository) GetMonitorsByTags(ctx context.Context, tags []string) (map[int64]*Monitor, error) {
	if len(tags) == 0 {
		return r.GetAllMonitors(ctx)
	}

	// First get all monitors
	allMonitors, err := r.GetAllMonitors(ctx)
	if err != nil {
		return nil, err
	}

	// Build query for tagged monitor IDs
	placeholders := make([]string, len(tags))
	args := make([]interface{}, len(tags))
	for i, tag := range tags {
		placeholders[i] = "?"
		args[i] = tag
	}

	query := fmt.Sprintf(`
		SELECT DISTINCT mt.monitor_id
		FROM monitor_tag mt
		JOIN tag t ON mt.tag_id = t.id
		WHERE t.name IN (%s)
	`, joinStrings(placeholders, ","))

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query monitor tags: %w", err)
	}
	defer rows.Close()

	taggedIDs := make(map[int64]bool)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("failed to scan tag row: %w", err)
		}
		taggedIDs[id] = true
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating tag rows: %w", err)
	}

	// Filter monitors by tagged IDs
	filtered := make(map[int64]*Monitor)
	for id, m := range allMonitors {
		if taggedIDs[id] {
			filtered[id] = m
		}
	}

	return filtered, nil
}

// AttachTags populates the Tags slice on each monitor in the map from the
// monitor_tag/tag join. Used for tag-driven probe selection
// (sync.FilterMonitorsForProbe). A single query fetches every association, so
// cost is one round-trip regardless of monitor count. Monitors with no tags are
// left with a nil Tags slice. Mutates the monitors in place.
func (r *Repository) AttachTags(ctx context.Context, monitors map[int64]*Monitor) error {
	if len(monitors) == 0 {
		return nil
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT mt.monitor_id, t.name
		FROM monitor_tag mt
		JOIN tag t ON mt.tag_id = t.id
	`)
	if err != nil {
		return fmt.Errorf("failed to query monitor tags: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var monitorID int64
		var tagName string
		if err := rows.Scan(&monitorID, &tagName); err != nil {
			return fmt.Errorf("failed to scan monitor_tag row: %w", err)
		}
		if m, ok := monitors[monitorID]; ok {
			m.Tags = append(m.Tags, tagName)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("error iterating monitor_tag rows: %w", err)
	}
	return nil
}

// GetMonitorsByTypes retrieves monitors of the specified types.
func (r *Repository) GetMonitorsByTypes(ctx context.Context, types []string) (map[int64]*Monitor, error) {
	if len(types) == 0 {
		return r.GetAllMonitors(ctx)
	}

	allMonitors, err := r.GetAllMonitors(ctx)
	if err != nil {
		return nil, err
	}

	typeSet := make(map[string]bool)
	for _, t := range types {
		typeSet[t] = true
	}

	filtered := make(map[int64]*Monitor)
	for id, m := range allMonitors {
		if typeSet[m.Type] {
			filtered[id] = m
		}
	}

	return filtered, nil
}

// GetMonitorCount returns the total number of active monitors.
func (r *Repository) GetMonitorCount(ctx context.Context) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM monitor WHERE active = 1").Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count monitors: %w", err)
	}
	return count, nil
}

// joinStrings joins strings with a separator.
func joinStrings(strs []string, sep string) string {
	if len(strs) == 0 {
		return ""
	}
	result := strs[0]
	for i := 1; i < len(strs); i++ {
		result += sep + strs[i]
	}
	return result
}
