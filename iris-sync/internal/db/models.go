package db

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
)

// Monitor represents an Uptime Kuma monitor with all configuration fields.
// Field names use Go conventions but map to Uptime Kuma's mixed camelCase/snake_case.
type Monitor struct {
	// Core identification
	ID          int64          `db:"id" json:"id"`
	Name        string         `db:"name" json:"name"`
	Description sql.NullString `db:"description" json:"description,omitempty"`
	UserID      sql.NullInt64  `db:"user_id" json:"user_id,omitempty"`
	Parent      sql.NullInt64  `db:"parent" json:"parent,omitempty"`
	Weight      int            `db:"weight" json:"weight"`

	// Monitor type and status
	Type    string         `db:"type" json:"type"`
	Subtype sql.NullString `db:"subtype" json:"subtype,omitempty"`
	Active  int            `db:"active" json:"active"`

	// HTTP/HTTPS configuration
	URL              sql.NullString `db:"url" json:"url,omitempty"`
	Method           sql.NullString `db:"method" json:"method,omitempty"`
	Body             sql.NullString `db:"body" json:"body,omitempty"`
	Headers          sql.NullString `db:"headers" json:"headers,omitempty"`
	HTTPBodyEncoding sql.NullString `db:"http_body_encoding" json:"httpBodyEncoding,omitempty"`
	MaxRedirects     sql.NullInt64  `db:"maxredirects" json:"maxredirects,omitempty"`

	// Response validation
	AcceptedStatusCodesJSON sql.NullString `db:"accepted_statuscodes_json" json:"accepted_statuscodes_json,omitempty"`
	Keyword                 sql.NullString `db:"keyword" json:"keyword,omitempty"`
	InvertKeyword           int            `db:"invert_keyword" json:"invertKeyword"`

	// Timing configuration
	Interval       int           `db:"interval" json:"interval"`
	RetryInterval  int           `db:"retry_interval" json:"retryInterval"`
	ResendInterval int           `db:"resend_interval" json:"resendInterval"`
	Timeout        sql.NullInt64 `db:"timeout" json:"timeout,omitempty"`
	MaxRetries     int           `db:"maxretries" json:"maxretries"`

	// TCP/Ping configuration
	Hostname sql.NullString `db:"hostname" json:"hostname,omitempty"`
	Port     sql.NullInt64  `db:"port" json:"port,omitempty"`

	// DNS configuration
	DNSResolveType   sql.NullString `db:"dns_resolve_type" json:"dns_resolve_type,omitempty"`
	DNSResolveServer sql.NullString `db:"dns_resolve_server" json:"dns_resolve_server,omitempty"`

	// TLS/SSL configuration
	IgnoreTLS                int            `db:"ignore_tls" json:"ignoreTls"`
	ExpiryNotification       int            `db:"expiry_notification" json:"expiryNotification"`
	DomainExpiryNotification int            `db:"domain_expiry_notification" json:"domainExpiryNotification"`
	TLSCa                    sql.NullString `db:"tls_ca" json:"tlsCa,omitempty"`
	TLSCert                  sql.NullString `db:"tls_cert" json:"tlsCert,omitempty"`
	TLSKey                   sql.NullString `db:"tls_key" json:"tlsKey,omitempty"`
	ExpectedTLSAlert         sql.NullString `db:"expected_tls_alert" json:"expectedTlsAlert,omitempty"`

	// Authentication
	AuthMethod    sql.NullString `db:"auth_method" json:"authMethod,omitempty"`
	BasicAuthUser sql.NullString `db:"basic_auth_user" json:"basic_auth_user,omitempty"`
	BasicAuthPass sql.NullString `db:"basic_auth_pass" json:"basic_auth_pass,omitempty"`
	AuthDomain    sql.NullString `db:"auth_domain" json:"authDomain,omitempty"`
	AuthWorkstation sql.NullString `db:"auth_workstation" json:"authWorkstation,omitempty"`

	// OAuth2
	OAuthClientID     sql.NullString `db:"oauth_client_id" json:"oauth_client_id,omitempty"`
	OAuthClientSecret sql.NullString `db:"oauth_client_secret" json:"oauth_client_secret,omitempty"`
	OAuthTokenURL     sql.NullString `db:"oauth_token_url" json:"oauth_token_url,omitempty"`
	OAuthScopes       sql.NullString `db:"oauth_scopes" json:"oauth_scopes,omitempty"`
	OAuthAudience     sql.NullString `db:"oauth_audience" json:"oauth_audience,omitempty"`
	OAuthAuthMethod   sql.NullString `db:"oauth_auth_method" json:"oauth_auth_method,omitempty"`

	// JSON Query
	JSONPath         sql.NullString `db:"json_path" json:"jsonPath,omitempty"`
	JSONPathOperator sql.NullString `db:"json_path_operator" json:"jsonPathOperator,omitempty"`
	ExpectedValue    sql.NullString `db:"expected_value" json:"expectedValue,omitempty"`

	// MQTT configuration
	MQTTTopic          sql.NullString `db:"mqtt_topic" json:"mqttTopic,omitempty"`
	MQTTUsername       sql.NullString `db:"mqtt_username" json:"mqttUsername,omitempty"`
	MQTTPassword       sql.NullString `db:"mqtt_password" json:"mqttPassword,omitempty"`
	MQTTSuccessMessage sql.NullString `db:"mqtt_success_message" json:"mqttSuccessMessage,omitempty"`
	MQTTCheckType      sql.NullString `db:"mqtt_check_type" json:"mqttCheckType,omitempty"`
	MQTTWebsocketPath  sql.NullString `db:"mqtt_websocket_path" json:"mqttWebsocketPath,omitempty"`

	// Database monitors
	DatabaseConnectionString sql.NullString `db:"database_connection_string" json:"databaseConnectionString,omitempty"`
	DatabaseQuery            sql.NullString `db:"database_query" json:"databaseQuery,omitempty"`

	// Docker configuration
	DockerContainer sql.NullString `db:"docker_container" json:"docker_container,omitempty"`
	DockerHost      sql.NullInt64  `db:"docker_host" json:"docker_host,omitempty"`

	// gRPC configuration
	GRPCUrl         sql.NullString `db:"grpc_url" json:"grpcUrl,omitempty"`
	GRPCProtobuf    sql.NullString `db:"grpc_protobuf" json:"grpcProtobuf,omitempty"`
	GRPCMethod      sql.NullString `db:"grpc_method" json:"grpcMethod,omitempty"`
	GRPCServiceName sql.NullString `db:"grpc_service_name" json:"grpcServiceName,omitempty"`
	GRPCBody        sql.NullString `db:"grpc_body" json:"grpcBody,omitempty"`
	GRPCMetadata    sql.NullString `db:"grpc_metadata" json:"grpcMetadata,omitempty"`
	GRPCEnableTLS   int            `db:"grpc_enable_tls" json:"grpcEnableTls"`

	// Push monitors
	PushToken sql.NullString `db:"push_token" json:"pushToken,omitempty"`

	// Ping options
	PacketSize            sql.NullInt64 `db:"packet_size" json:"packetSize,omitempty"`
	PingNumeric           int           `db:"ping_numeric" json:"ping_numeric"`
	PingCount             sql.NullInt64 `db:"ping_count" json:"ping_count,omitempty"`
	PingPerRequestTimeout sql.NullInt64 `db:"ping_per_request_timeout" json:"ping_per_request_timeout,omitempty"`

	// Game server monitoring
	Game                 sql.NullString `db:"game" json:"game,omitempty"`
	GamedigGivenPortOnly int            `db:"gamedig_given_port_only" json:"gamedigGivenPortOnly"`

	// RADIUS configuration
	RadiusUsername         sql.NullString `db:"radius_username" json:"radiusUsername,omitempty"`
	RadiusPassword         sql.NullString `db:"radius_password" json:"radiusPassword,omitempty"`
	RadiusSecret           sql.NullString `db:"radius_secret" json:"radiusSecret,omitempty"`
	RadiusCalledStationID  sql.NullString `db:"radius_called_station_id" json:"radiusCalledStationId,omitempty"`
	RadiusCallingStationID sql.NullString `db:"radius_calling_station_id" json:"radiusCallingStationId,omitempty"`

	// Kafka producer configuration
	KafkaProducerTopic                  sql.NullString `db:"kafka_producer_topic" json:"kafkaProducerTopic,omitempty"`
	KafkaProducerBrokers                sql.NullString `db:"kafka_producer_brokers" json:"kafkaProducerBrokers,omitempty"`
	KafkaProducerSaslOptions            sql.NullString `db:"kafka_producer_sasl_options" json:"kafkaProducerSaslOptions,omitempty"`
	KafkaProducerMessage                sql.NullString `db:"kafka_producer_message" json:"kafkaProducerMessage,omitempty"`
	KafkaProducerSsl                    int            `db:"kafka_producer_ssl" json:"kafkaProducerSsl"`
	KafkaProducerAllowAutoTopicCreation int            `db:"kafka_producer_allow_auto_topic_creation" json:"kafkaProducerAllowAutoTopicCreation"`

	// RabbitMQ configuration
	RabbitMQNodes    sql.NullString `db:"rabbitmq_nodes" json:"rabbitmqNodes,omitempty"`
	RabbitMQUsername sql.NullString `db:"rabbitmq_username" json:"rabbitmqUsername,omitempty"`
	RabbitMQPassword sql.NullString `db:"rabbitmq_password" json:"rabbitmqPassword,omitempty"`

	// SNMP configuration
	SNMPOid        sql.NullString `db:"snmp_oid" json:"snmpOid,omitempty"`
	SNMPVersion    sql.NullString `db:"snmp_version" json:"snmpVersion,omitempty"`
	SNMPV3Username sql.NullString `db:"snmp_v3_username" json:"snmpV3Username,omitempty"`

	// SMTP configuration
	SMTPSecurity sql.NullString `db:"smtp_security" json:"smtpSecurity,omitempty"`

	// WebSocket configuration
	WSIgnoreSecWebsocketAcceptHeader int            `db:"ws_ignore_sec_websocket_accept_header" json:"wsIgnoreSecWebsocketAcceptHeader"`
	WSSubprotocol                    sql.NullString `db:"ws_subprotocol" json:"wsSubprotocol,omitempty"`

	// Conditions
	Conditions sql.NullString `db:"conditions" json:"conditions,omitempty"`

	// Behavior flags
	UpsideDown                   int `db:"upside_down" json:"upsideDown"`
	CacheBust                    int `db:"cache_bust" json:"cacheBust"`
	RetryOnlyOnStatusCodeFailure int `db:"retry_only_on_status_code_failure" json:"retryOnlyOnStatusCodeFailure"`

	// Proxy and network
	ProxyID  sql.NullInt64  `db:"proxy_id" json:"proxyId,omitempty"`
	IPFamily sql.NullString `db:"ip_family" json:"ipFamily,omitempty"`

	// Remote browser
	RemoteBrowser   sql.NullString `db:"remote_browser" json:"remote_browser,omitempty"`
	ScreenshotDelay sql.NullInt64  `db:"screenshot_delay" json:"screenshotDelay,omitempty"`

	// Response saving
	SaveResponse      int           `db:"save_response" json:"saveResponse"`
	SaveErrorResponse int           `db:"save_error_response" json:"saveErrorResponse"`
	ResponseMaxLength sql.NullInt64 `db:"response_max_length" json:"responseMaxLength,omitempty"`

	// System service
	SystemServiceName sql.NullString `db:"system_service_name" json:"system_service_name,omitempty"`

	// Manual status
	ManualStatus sql.NullInt64 `db:"manual_status" json:"manual_status,omitempty"`

	// Globalping
	Location sql.NullString `db:"location" json:"location,omitempty"`
	Protocol sql.NullString `db:"protocol" json:"protocol,omitempty"`

	// Computed field for change detection (not persisted)
	ContentHash string `db:"-" json:"-"`
}

// monitorHashData contains only the fields used for hash computation.
// Excludes ID (probe-specific) and Description (documentation-only, no effect on checks).
type monitorHashData struct {
	Name                             string  `json:"name"`
	Type                             string  `json:"type"`
	Subtype                          *string `json:"subtype,omitempty"`
	Active                           int     `json:"active"`
	URL                              *string `json:"url,omitempty"`
	Method                           *string `json:"method,omitempty"`
	Body                             *string `json:"body,omitempty"`
	Headers                          *string `json:"headers,omitempty"`
	HTTPBodyEncoding                 *string `json:"httpBodyEncoding,omitempty"`
	MaxRedirects                     *int64  `json:"maxredirects,omitempty"`
	AcceptedStatusCodesJSON          *string `json:"accepted_statuscodes_json,omitempty"`
	Keyword                          *string `json:"keyword,omitempty"`
	InvertKeyword                    int     `json:"invertKeyword"`
	Interval                         int     `json:"interval"`
	RetryInterval                    int     `json:"retryInterval"`
	ResendInterval                   int     `json:"resendInterval"`
	Timeout                          *int64  `json:"timeout,omitempty"`
	MaxRetries                       int     `json:"maxretries"`
	Hostname                         *string `json:"hostname,omitempty"`
	Port                             *int64  `json:"port,omitempty"`
	DNSResolveType                   *string `json:"dns_resolve_type,omitempty"`
	DNSResolveServer                 *string `json:"dns_resolve_server,omitempty"`
	IgnoreTLS                        int     `json:"ignoreTls"`
	ExpiryNotification               int     `json:"expiryNotification"`
	DomainExpiryNotification         int     `json:"domainExpiryNotification"`
	TLSCa                            *string `json:"tlsCa,omitempty"`
	TLSCert                          *string `json:"tlsCert,omitempty"`
	TLSKey                           *string `json:"tlsKey,omitempty"`
	AuthMethod                       *string `json:"authMethod,omitempty"`
	BasicAuthUser                    *string `json:"basic_auth_user,omitempty"`
	BasicAuthPass                    *string `json:"basic_auth_pass,omitempty"`
	JSONPath                         *string `json:"jsonPath,omitempty"`
	JSONPathOperator                 *string `json:"jsonPathOperator,omitempty"`
	ExpectedValue                    *string `json:"expectedValue,omitempty"`
	MQTTTopic                        *string `json:"mqttTopic,omitempty"`
	MQTTUsername                     *string `json:"mqttUsername,omitempty"`
	MQTTPassword                     *string `json:"mqttPassword,omitempty"`
	MQTTSuccessMessage               *string `json:"mqttSuccessMessage,omitempty"`
	MQTTCheckType                    *string `json:"mqttCheckType,omitempty"`
	DatabaseConnectionString         *string `json:"databaseConnectionString,omitempty"`
	DatabaseQuery                    *string `json:"databaseQuery,omitempty"`
	DockerContainer                  *string `json:"docker_container,omitempty"`
	DockerHost                       *int64  `json:"docker_host,omitempty"`
	GRPCUrl                          *string `json:"grpcUrl,omitempty"`
	GRPCProtobuf                     *string `json:"grpcProtobuf,omitempty"`
	GRPCMethod                       *string `json:"grpcMethod,omitempty"`
	GRPCServiceName                  *string `json:"grpcServiceName,omitempty"`
	GRPCBody                         *string `json:"grpcBody,omitempty"`
	GRPCMetadata                     *string `json:"grpcMetadata,omitempty"`
	GRPCEnableTLS                    int     `json:"grpcEnableTls"`
	PushToken                        *string `json:"pushToken,omitempty"`
	PacketSize                       *int64  `json:"packetSize,omitempty"`
	PingNumeric                      int     `json:"ping_numeric"`
	PingCount                        *int64  `json:"ping_count,omitempty"`
	PingPerRequestTimeout            *int64  `json:"ping_per_request_timeout,omitempty"`
	Game                             *string `json:"game,omitempty"`
	GamedigGivenPortOnly             int     `json:"gamedigGivenPortOnly"`
	RadiusUsername                   *string `json:"radiusUsername,omitempty"`
	RadiusPassword                   *string `json:"radiusPassword,omitempty"`
	RadiusSecret                     *string `json:"radiusSecret,omitempty"`
	RadiusCalledStationID            *string `json:"radiusCalledStationId,omitempty"`
	RadiusCallingStationID           *string `json:"radiusCallingStationId,omitempty"`
	KafkaProducerTopic               *string `json:"kafkaProducerTopic,omitempty"`
	KafkaProducerBrokers             *string `json:"kafkaProducerBrokers,omitempty"`
	KafkaProducerSaslOptions         *string `json:"kafkaProducerSaslOptions,omitempty"`
	KafkaProducerMessage             *string `json:"kafkaProducerMessage,omitempty"`
	KafkaProducerSsl                 int     `json:"kafkaProducerSsl"`
	KafkaProducerAllowAutoTopicCreation int  `json:"kafkaProducerAllowAutoTopicCreation"`
	RabbitMQNodes                    *string `json:"rabbitmqNodes,omitempty"`
	RabbitMQUsername                 *string `json:"rabbitmqUsername,omitempty"`
	RabbitMQPassword                 *string `json:"rabbitmqPassword,omitempty"`
	SNMPOid                          *string `json:"snmpOid,omitempty"`
	SNMPVersion                      *string `json:"snmpVersion,omitempty"`
	SMTPSecurity                     *string `json:"smtpSecurity,omitempty"`
	WSIgnoreSecWebsocketAcceptHeader int     `json:"wsIgnoreSecWebsocketAcceptHeader"`
	WSSubprotocol                    *string `json:"wsSubprotocol,omitempty"`
	Conditions                       *string `json:"conditions,omitempty"`
	UpsideDown                       int     `json:"upsideDown"`
	CacheBust                        int     `json:"cacheBust"`
	RetryOnlyOnStatusCodeFailure     int     `json:"retryOnlyOnStatusCodeFailure"`
	ProxyID                          *int64  `json:"proxyId,omitempty"`
	IPFamily                         *string `json:"ipFamily,omitempty"`
	RemoteBrowser                    *string `json:"remote_browser,omitempty"`
	SaveResponse                     int     `json:"saveResponse"`
	SaveErrorResponse                int     `json:"saveErrorResponse"`
	ResponseMaxLength                *int64  `json:"responseMaxLength,omitempty"`
	SystemServiceName                *string `json:"system_service_name,omitempty"`
	Location                         *string `json:"location,omitempty"`
	Protocol                         *string `json:"protocol,omitempty"`
	Parent                           *int64  `json:"parent,omitempty"`
	Weight                           int     `json:"weight"`
	ExpectedTLSAlert                 *string `json:"expectedTlsAlert,omitempty"`
	AuthDomain                       *string `json:"authDomain,omitempty"`
	AuthWorkstation                  *string `json:"authWorkstation,omitempty"`
	MQTTWebsocketPath                *string `json:"mqttWebsocketPath,omitempty"`
	ScreenshotDelay                  *int64  `json:"screenshotDelay,omitempty"`
	ManualStatus                     *int64  `json:"manual_status,omitempty"`
}

// nullStringPtr returns a pointer to the string value if valid, nil otherwise.
func nullStringPtr(ns sql.NullString) *string {
	if ns.Valid {
		return &ns.String
	}
	return nil
}

// nullInt64Ptr returns a pointer to the int64 value if valid, nil otherwise.
func nullInt64Ptr(ni sql.NullInt64) *int64 {
	if ni.Valid {
		return &ni.Int64
	}
	return nil
}

// ComputeHash generates a SHA256 hash of monitor configuration for change detection.
// The hash excludes the ID field since probes have their own auto-increment IDs.
func (m *Monitor) ComputeHash() string {
	data := monitorHashData{
		Name:                             m.Name,
		Type:                             m.Type,
		Subtype:                          nullStringPtr(m.Subtype),
		Active:                           m.Active,
		URL:                              nullStringPtr(m.URL),
		Method:                           nullStringPtr(m.Method),
		Body:                             nullStringPtr(m.Body),
		Headers:                          nullStringPtr(m.Headers),
		HTTPBodyEncoding:                 nullStringPtr(m.HTTPBodyEncoding),
		MaxRedirects:                     nullInt64Ptr(m.MaxRedirects),
		AcceptedStatusCodesJSON:          nullStringPtr(m.AcceptedStatusCodesJSON),
		Keyword:                          nullStringPtr(m.Keyword),
		InvertKeyword:                    m.InvertKeyword,
		Interval:                         m.Interval,
		RetryInterval:                    m.RetryInterval,
		ResendInterval:                   m.ResendInterval,
		Timeout:                          nullInt64Ptr(m.Timeout),
		MaxRetries:                       m.MaxRetries,
		Hostname:                         nullStringPtr(m.Hostname),
		Port:                             nullInt64Ptr(m.Port),
		DNSResolveType:                   nullStringPtr(m.DNSResolveType),
		DNSResolveServer:                 nullStringPtr(m.DNSResolveServer),
		IgnoreTLS:                        m.IgnoreTLS,
		ExpiryNotification:               m.ExpiryNotification,
		DomainExpiryNotification:         m.DomainExpiryNotification,
		TLSCa:                            nullStringPtr(m.TLSCa),
		TLSCert:                          nullStringPtr(m.TLSCert),
		TLSKey:                           nullStringPtr(m.TLSKey),
		AuthMethod:                       nullStringPtr(m.AuthMethod),
		BasicAuthUser:                    nullStringPtr(m.BasicAuthUser),
		BasicAuthPass:                    nullStringPtr(m.BasicAuthPass),
		JSONPath:                         nullStringPtr(m.JSONPath),
		JSONPathOperator:                 nullStringPtr(m.JSONPathOperator),
		ExpectedValue:                    nullStringPtr(m.ExpectedValue),
		MQTTTopic:                        nullStringPtr(m.MQTTTopic),
		MQTTUsername:                     nullStringPtr(m.MQTTUsername),
		MQTTPassword:                     nullStringPtr(m.MQTTPassword),
		MQTTSuccessMessage:               nullStringPtr(m.MQTTSuccessMessage),
		MQTTCheckType:                    nullStringPtr(m.MQTTCheckType),
		DatabaseConnectionString:         nullStringPtr(m.DatabaseConnectionString),
		DatabaseQuery:                    nullStringPtr(m.DatabaseQuery),
		DockerContainer:                  nullStringPtr(m.DockerContainer),
		DockerHost:                       nullInt64Ptr(m.DockerHost),
		GRPCUrl:                          nullStringPtr(m.GRPCUrl),
		GRPCProtobuf:                     nullStringPtr(m.GRPCProtobuf),
		GRPCMethod:                       nullStringPtr(m.GRPCMethod),
		GRPCServiceName:                  nullStringPtr(m.GRPCServiceName),
		GRPCBody:                         nullStringPtr(m.GRPCBody),
		GRPCMetadata:                     nullStringPtr(m.GRPCMetadata),
		GRPCEnableTLS:                    m.GRPCEnableTLS,
		PushToken:                        nullStringPtr(m.PushToken),
		PacketSize:                       nullInt64Ptr(m.PacketSize),
		PingNumeric:                      m.PingNumeric,
		PingCount:                        nullInt64Ptr(m.PingCount),
		PingPerRequestTimeout:            nullInt64Ptr(m.PingPerRequestTimeout),
		Game:                             nullStringPtr(m.Game),
		GamedigGivenPortOnly:             m.GamedigGivenPortOnly,
		RadiusUsername:                   nullStringPtr(m.RadiusUsername),
		RadiusPassword:                   nullStringPtr(m.RadiusPassword),
		RadiusSecret:                     nullStringPtr(m.RadiusSecret),
		RadiusCalledStationID:            nullStringPtr(m.RadiusCalledStationID),
		RadiusCallingStationID:           nullStringPtr(m.RadiusCallingStationID),
		KafkaProducerTopic:               nullStringPtr(m.KafkaProducerTopic),
		KafkaProducerBrokers:             nullStringPtr(m.KafkaProducerBrokers),
		KafkaProducerSaslOptions:         nullStringPtr(m.KafkaProducerSaslOptions),
		KafkaProducerMessage:             nullStringPtr(m.KafkaProducerMessage),
		KafkaProducerSsl:                 m.KafkaProducerSsl,
		KafkaProducerAllowAutoTopicCreation: m.KafkaProducerAllowAutoTopicCreation,
		RabbitMQNodes:                    nullStringPtr(m.RabbitMQNodes),
		RabbitMQUsername:                 nullStringPtr(m.RabbitMQUsername),
		RabbitMQPassword:                 nullStringPtr(m.RabbitMQPassword),
		SNMPOid:                          nullStringPtr(m.SNMPOid),
		SNMPVersion:                      nullStringPtr(m.SNMPVersion),
		SMTPSecurity:                     nullStringPtr(m.SMTPSecurity),
		WSIgnoreSecWebsocketAcceptHeader: m.WSIgnoreSecWebsocketAcceptHeader,
		WSSubprotocol:                    nullStringPtr(m.WSSubprotocol),
		Conditions:                       nullStringPtr(m.Conditions),
		UpsideDown:                       m.UpsideDown,
		CacheBust:                        m.CacheBust,
		RetryOnlyOnStatusCodeFailure:     m.RetryOnlyOnStatusCodeFailure,
		ProxyID:                          nullInt64Ptr(m.ProxyID),
		IPFamily:                         nullStringPtr(m.IPFamily),
		RemoteBrowser:                    nullStringPtr(m.RemoteBrowser),
		SaveResponse:                     m.SaveResponse,
		SaveErrorResponse:                m.SaveErrorResponse,
		ResponseMaxLength:                nullInt64Ptr(m.ResponseMaxLength),
		SystemServiceName:                nullStringPtr(m.SystemServiceName),
		Location:                         nullStringPtr(m.Location),
		Protocol:                         nullStringPtr(m.Protocol),
		Parent:                           nullInt64Ptr(m.Parent),
		Weight:                           m.Weight,
		ExpectedTLSAlert:                 nullStringPtr(m.ExpectedTLSAlert),
		AuthDomain:                       nullStringPtr(m.AuthDomain),
		AuthWorkstation:                  nullStringPtr(m.AuthWorkstation),
		MQTTWebsocketPath:                nullStringPtr(m.MQTTWebsocketPath),
		ScreenshotDelay:                  nullInt64Ptr(m.ScreenshotDelay),
		ManualStatus:                     nullInt64Ptr(m.ManualStatus),
	}

	jsonData, _ := json.Marshal(data)
	hash := sha256.Sum256(jsonData)
	return fmt.Sprintf("%x", hash)
}

// ToKumaPayload converts the Monitor to the format expected by Uptime Kuma's Socket.IO API.
func (m *Monitor) ToKumaPayload() map[string]interface{} {
	payload := map[string]interface{}{
		"name":           m.Name,
		"type":           m.Type,
		"active":         m.Active == 1,
		"interval":       m.Interval,
		"maxretries":     m.MaxRetries,
		"retryInterval":  m.RetryInterval,
		"resendInterval": m.ResendInterval,
		"weight":         m.Weight,
	}

	// Add ID if present (for edit operations)
	if m.ID > 0 {
		payload["id"] = m.ID
	}

	// Add optional string fields
	addNullString := func(key string, ns sql.NullString) {
		if ns.Valid {
			payload[key] = ns.String
		}
	}

	// Add optional int fields
	addNullInt := func(key string, ni sql.NullInt64) {
		if ni.Valid {
			payload[key] = ni.Int64
		}
	}

	addNullString("description", m.Description)
	addNullString("subtype", m.Subtype)
	addNullString("url", m.URL)
	addNullString("method", m.Method)
	addNullString("body", m.Body)
	addNullString("headers", m.Headers)
	addNullString("httpBodyEncoding", m.HTTPBodyEncoding)
	addNullInt("maxredirects", m.MaxRedirects)
	addNullString("hostname", m.Hostname)
	addNullInt("port", m.Port)
	addNullInt("timeout", m.Timeout)
	addNullString("keyword", m.Keyword)
	addNullString("dns_resolve_type", m.DNSResolveType)
	addNullString("dns_resolve_server", m.DNSResolveServer)
	addNullString("tlsCa", m.TLSCa)
	addNullString("tlsCert", m.TLSCert)
	addNullString("tlsKey", m.TLSKey)
	addNullString("expectedTlsAlert", m.ExpectedTLSAlert)
	addNullString("authMethod", m.AuthMethod)
	addNullString("authDomain", m.AuthDomain)
	addNullString("authWorkstation", m.AuthWorkstation)
	addNullString("basic_auth_user", m.BasicAuthUser)
	addNullString("basic_auth_pass", m.BasicAuthPass)
	addNullString("jsonPath", m.JSONPath)
	addNullString("jsonPathOperator", m.JSONPathOperator)
	addNullString("expectedValue", m.ExpectedValue)
	addNullString("mqttTopic", m.MQTTTopic)
	addNullString("mqttUsername", m.MQTTUsername)
	addNullString("mqttPassword", m.MQTTPassword)
	addNullString("mqttSuccessMessage", m.MQTTSuccessMessage)
	addNullString("mqttCheckType", m.MQTTCheckType)
	addNullString("mqttWebsocketPath", m.MQTTWebsocketPath)
	addNullString("databaseConnectionString", m.DatabaseConnectionString)
	addNullString("databaseQuery", m.DatabaseQuery)
	addNullString("docker_container", m.DockerContainer)
	addNullInt("docker_host", m.DockerHost)
	addNullString("grpcUrl", m.GRPCUrl)
	addNullString("grpcProtobuf", m.GRPCProtobuf)
	addNullString("grpcMethod", m.GRPCMethod)
	addNullString("grpcServiceName", m.GRPCServiceName)
	addNullString("grpcBody", m.GRPCBody)
	addNullString("grpcMetadata", m.GRPCMetadata)
	addNullString("pushToken", m.PushToken)
	addNullInt("packetSize", m.PacketSize)
	addNullInt("ping_count", m.PingCount)
	addNullInt("ping_per_request_timeout", m.PingPerRequestTimeout)
	addNullString("game", m.Game)
	addNullString("radiusUsername", m.RadiusUsername)
	addNullString("radiusPassword", m.RadiusPassword)
	addNullString("radiusSecret", m.RadiusSecret)
	addNullString("radiusCalledStationId", m.RadiusCalledStationID)
	addNullString("radiusCallingStationId", m.RadiusCallingStationID)
	addNullString("kafkaProducerTopic", m.KafkaProducerTopic)
	addNullString("kafkaProducerMessage", m.KafkaProducerMessage)
	addNullString("rabbitmqUsername", m.RabbitMQUsername)
	addNullString("rabbitmqPassword", m.RabbitMQPassword)
	addNullString("snmpOid", m.SNMPOid)
	addNullString("snmpVersion", m.SNMPVersion)
	addNullString("smtpSecurity", m.SMTPSecurity)
	addNullString("wsSubprotocol", m.WSSubprotocol)

	// JSON-encoded fields: parse from DB string into objects so the Uptime Kuma
	// server can JSON.stringify() them correctly (avoids double-stringification).
	addJSONField := func(key string, ns sql.NullString) {
		if !ns.Valid {
			return
		}
		var parsed interface{}
		if err := json.Unmarshal([]byte(ns.String), &parsed); err == nil {
			payload[key] = parsed
		} else {
			payload[key] = ns.String
		}
	}

	addJSONField("kafkaProducerBrokers", m.KafkaProducerBrokers)
	addJSONField("kafkaProducerSaslOptions", m.KafkaProducerSaslOptions)
	addJSONField("rabbitmqNodes", m.RabbitMQNodes)
	addJSONField("conditions", m.Conditions)
	addNullInt("proxyId", m.ProxyID)
	addNullString("ipFamily", m.IPFamily)
	addNullString("remote_browser", m.RemoteBrowser)
	addNullInt("screenshotDelay", m.ScreenshotDelay)
	addNullInt("responseMaxLength", m.ResponseMaxLength)
	addNullString("system_service_name", m.SystemServiceName)
	addNullInt("manual_status", m.ManualStatus)
	addNullString("location", m.Location)
	addNullString("protocol", m.Protocol)

	// Parent field for group relationships - MUST ALWAYS be present in payload.
	// When Parent is not valid (root-level monitor), explicitly send null so the
	// probe's editMonitor handler sets bean.parent = null (clearing group assignment)
	// instead of bean.parent = undefined (which preserves the old value).
	if m.Parent.Valid {
		payload["parent"] = m.Parent.Int64
	} else {
		payload["parent"] = nil
	}

	// Boolean/int flags
	payload["ignoreTls"] = m.IgnoreTLS == 1
	payload["invertKeyword"] = m.InvertKeyword == 1
	payload["expiryNotification"] = m.ExpiryNotification == 1
	payload["domainExpiryNotification"] = m.DomainExpiryNotification == 1
	payload["grpcEnableTls"] = m.GRPCEnableTLS == 1
	payload["ping_numeric"] = m.PingNumeric == 1
	payload["gamedigGivenPortOnly"] = m.GamedigGivenPortOnly == 1
	payload["kafkaProducerSsl"] = m.KafkaProducerSsl == 1
	payload["kafkaProducerAllowAutoTopicCreation"] = m.KafkaProducerAllowAutoTopicCreation == 1
	payload["wsIgnoreSecWebsocketAcceptHeader"] = m.WSIgnoreSecWebsocketAcceptHeader == 1
	payload["upsideDown"] = m.UpsideDown == 1
	payload["cacheBust"] = m.CacheBust == 1
	payload["retryOnlyOnStatusCodeFailure"] = m.RetryOnlyOnStatusCodeFailure == 1
	payload["saveResponse"] = m.SaveResponse == 1
	payload["saveErrorResponse"] = m.SaveErrorResponse == 1

	// Handle accepted_statuscodes - convert JSON string to array
	if m.AcceptedStatusCodesJSON.Valid {
		var codes []string
		if err := json.Unmarshal([]byte(m.AcceptedStatusCodesJSON.String), &codes); err == nil {
			payload["accepted_statuscodes"] = codes
		} else {
			payload["accepted_statuscodes"] = []string{"200-299"}
		}
	} else {
		payload["accepted_statuscodes"] = []string{"200-299"}
	}

	// Empty notification list (probes manage their own notifications)
	payload["notificationIDList"] = map[string]bool{}

	return payload
}
