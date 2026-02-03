package client

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"iris-sync/internal/db"
)

// Engine.IO packet types
const (
	engineOpen    = '0'
	engineClose   = '1'
	enginePing    = '2'
	enginePong    = '3'
	engineMessage = '4'
)

// Socket.IO packet types
const (
	socketConnect      = '0'
	socketDisconnect   = '1'
	socketEvent        = '2'
	socketAck          = '3'
	socketConnectError = '4'
)

// KumaClient provides Socket.IO communication with an Uptime Kuma probe.
type KumaClient struct {
	endpoint   string
	username   string
	password   string
	conn       *websocket.Conn
	token      string
	sid        string
	connected  atomic.Bool
	ackCounter atomic.Int64
	ackMap     sync.Map // map[int64]chan []interface{}
	mu         sync.Mutex

	// Event handlers
	handlers   map[string]func([]interface{})
	handlersMu sync.RWMutex
}

// NewKumaClient creates a new Uptime Kuma Socket.IO client.
func NewKumaClient(endpoint, username, password string) *KumaClient {
	return &KumaClient{
		endpoint: strings.TrimSuffix(endpoint, "/"),
		username: username,
		password: password,
		handlers: make(map[string]func([]interface{})),
	}
}

// Connect establishes a Socket.IO connection to the Uptime Kuma probe.
func (c *KumaClient) Connect(ctx context.Context) error {
	// Step 1: Engine.IO handshake via HTTP polling to get session ID
	handshakeURL := fmt.Sprintf("%s/socket.io/?EIO=4&transport=polling", c.endpoint)

	req, err := http.NewRequestWithContext(ctx, "GET", handshakeURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create handshake request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to perform handshake: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read handshake response: %w", err)
	}

	// Parse Engine.IO open packet: 0{"sid":"...", ...}
	if len(body) < 2 || body[0] != engineOpen {
		return fmt.Errorf("invalid handshake response: %s", string(body))
	}

	var handshake struct {
		SID          string   `json:"sid"`
		Upgrades     []string `json:"upgrades"`
		PingInterval int      `json:"pingInterval"`
		PingTimeout  int      `json:"pingTimeout"`
	}

	if err := json.Unmarshal(body[1:], &handshake); err != nil {
		return fmt.Errorf("failed to parse handshake: %w", err)
	}

	c.sid = handshake.SID

	// Step 2: Upgrade to WebSocket
	wsURL := strings.Replace(c.endpoint, "http", "ws", 1)
	wsURL = fmt.Sprintf("%s/socket.io/?EIO=4&transport=websocket&sid=%s", wsURL, url.QueryEscape(c.sid))

	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	conn, _, err := dialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return fmt.Errorf("failed to upgrade to websocket: %w", err)
	}

	c.conn = conn

	// Send WebSocket upgrade probe
	if err := c.conn.WriteMessage(websocket.TextMessage, []byte("2probe")); err != nil {
		c.conn.Close()
		return fmt.Errorf("failed to send upgrade probe: %w", err)
	}

	// Read probe response
	_, msg, err := c.conn.ReadMessage()
	if err != nil {
		c.conn.Close()
		return fmt.Errorf("failed to read probe response: %w", err)
	}

	if string(msg) != "3probe" {
		c.conn.Close()
		return fmt.Errorf("unexpected probe response: %s", string(msg))
	}

	// Send upgrade complete
	if err := c.conn.WriteMessage(websocket.TextMessage, []byte("5")); err != nil {
		c.conn.Close()
		return fmt.Errorf("failed to send upgrade complete: %w", err)
	}

	c.connected.Store(true)

	// Start message reader goroutine
	go c.readLoop()

	// Start ping goroutine
	go c.pingLoop(time.Duration(handshake.PingInterval) * time.Millisecond)

	// Send Socket.IO CONNECT packet to join default namespace
	// Format: 40 (Engine.IO MESSAGE + Socket.IO CONNECT)
	if err := c.conn.WriteMessage(websocket.TextMessage, []byte("40")); err != nil {
		c.conn.Close()
		return fmt.Errorf("failed to send namespace connect: %w", err)
	}

	// Wait for Socket.IO connect confirmation (server sends 40{"sid":"..."})
	time.Sleep(200 * time.Millisecond)

	return nil
}

// readLoop continuously reads messages from the WebSocket connection.
func (c *KumaClient) readLoop() {
	for c.connected.Load() {
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			if c.connected.Load() {
				c.connected.Store(false)
			}
			return
		}

		c.handleMessage(msg)
	}
}

// pingLoop sends periodic ping messages.
func (c *KumaClient) pingLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for c.connected.Load() {
		<-ticker.C
		if !c.connected.Load() {
			return
		}

		c.mu.Lock()
		err := c.conn.WriteMessage(websocket.TextMessage, []byte("2"))
		c.mu.Unlock()

		if err != nil {
			c.connected.Store(false)
			return
		}
	}
}

// handleMessage processes incoming Socket.IO messages.
func (c *KumaClient) handleMessage(msg []byte) {
	if len(msg) == 0 {
		return
	}

	switch msg[0] {
	case enginePong:
		// Pong received, connection alive
	case engineMessage:
		// Socket.IO message
		if len(msg) > 1 {
			c.handleSocketIOMessage(msg[1:])
		}
	}
}

// handleSocketIOMessage processes Socket.IO protocol messages.
func (c *KumaClient) handleSocketIOMessage(msg []byte) {
	if len(msg) == 0 {
		return
	}

	switch msg[0] {
	case socketConnect:
		// Connected to namespace
	case socketEvent:
		c.handleEvent(msg[1:])
	case socketAck:
		c.handleAck(msg[1:])
	}
}

// handleEvent processes Socket.IO event messages.
func (c *KumaClient) handleEvent(msg []byte) {
	// Parse event: [ackId]["eventName", ...args]
	var ackID int64 = -1
	data := msg

	// Check for ack ID prefix
	for i, b := range msg {
		if b == '[' {
			if i > 0 {
				ackID, _ = strconv.ParseInt(string(msg[:i]), 10, 64)
				data = msg[i:]
			}
			break
		}
	}

	var payload []interface{}
	if err := json.Unmarshal(data, &payload); err != nil {
		return
	}

	if len(payload) < 1 {
		return
	}

	eventName, ok := payload[0].(string)
	if !ok {
		return
	}

	// Call registered handler
	c.handlersMu.RLock()
	handler, exists := c.handlers[eventName]
	c.handlersMu.RUnlock()

	if exists && handler != nil {
		handler(payload[1:])
	}

	// Send ack if requested
	if ackID >= 0 {
		c.sendAck(ackID, nil)
	}
}

// handleAck processes acknowledgment responses.
func (c *KumaClient) handleAck(msg []byte) {
	// Parse ack: ackId[...data]
	var ackID int64
	var data []byte

	for i, b := range msg {
		if b == '[' {
			ackID, _ = strconv.ParseInt(string(msg[:i]), 10, 64)
			data = msg[i:]
			break
		}
	}

	var payload []interface{}
	if err := json.Unmarshal(data, &payload); err != nil {
		return
	}

	// Deliver to waiting channel
	if ch, ok := c.ackMap.LoadAndDelete(ackID); ok {
		ackCh := ch.(chan []interface{})
		select {
		case ackCh <- payload:
		default:
		}
	}
}

// sendAck sends an acknowledgment response.
func (c *KumaClient) sendAck(ackID int64, data interface{}) {
	payload := "[]"
	if data != nil {
		if jsonData, err := json.Marshal([]interface{}{data}); err == nil {
			payload = string(jsonData)
		}
	}

	msg := fmt.Sprintf("43%d%s", ackID, payload)
	c.mu.Lock()
	c.conn.WriteMessage(websocket.TextMessage, []byte(msg))
	c.mu.Unlock()
}

// On registers an event handler.
func (c *KumaClient) On(event string, handler func([]interface{})) {
	c.handlersMu.Lock()
	c.handlers[event] = handler
	c.handlersMu.Unlock()
}

// Emit sends an event with optional acknowledgment.
func (c *KumaClient) Emit(ctx context.Context, event string, args ...interface{}) ([]interface{}, error) {
	if !c.connected.Load() {
		return nil, errors.New("not connected")
	}

	ackID := c.ackCounter.Add(1)

	// Create ack channel
	ackCh := make(chan []interface{}, 1)
	c.ackMap.Store(ackID, ackCh)
	defer c.ackMap.Delete(ackID)

	// Build payload
	payload := make([]interface{}, 0, len(args)+1)
	payload = append(payload, event)
	payload = append(payload, args...)

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal event: %w", err)
	}

	// Send: 42<ackId>["event", ...args]
	msg := fmt.Sprintf("42%d%s", ackID, string(jsonData))

	c.mu.Lock()
	err = c.conn.WriteMessage(websocket.TextMessage, []byte(msg))
	c.mu.Unlock()

	if err != nil {
		return nil, fmt.Errorf("failed to send event: %w", err)
	}

	// Wait for ack
	select {
	case response := <-ackCh:
		return response, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Login authenticates with the Uptime Kuma instance.
func (c *KumaClient) Login(ctx context.Context) error {
	loginData := map[string]interface{}{
		"username": c.username,
		"password": c.password,
	}

	response, err := c.Emit(ctx, "login", loginData)
	if err != nil {
		return fmt.Errorf("login failed: %w", err)
	}

	if len(response) == 0 {
		return errors.New("empty login response")
	}

	resp, ok := response[0].(map[string]interface{})
	if !ok {
		return errors.New("invalid login response format")
	}

	if ok, _ := resp["ok"].(bool); !ok {
		msg, _ := resp["msg"].(string)
		return fmt.Errorf("login failed: %s", msg)
	}

	if token, ok := resp["token"].(string); ok {
		c.token = token
	}

	return nil
}

// GetMonitorList retrieves all monitors from the probe.
func (c *KumaClient) GetMonitorList(ctx context.Context) (map[int64]*db.Monitor, error) {
	// Register handler for monitorList event
	monitorsCh := make(chan map[string]interface{}, 1)
	c.On("monitorList", func(args []interface{}) {
		if len(args) > 0 {
			if monitors, ok := args[0].(map[string]interface{}); ok {
				select {
				case monitorsCh <- monitors:
				default:
				}
			}
		}
	})
	defer c.On("monitorList", nil)

	// Request monitor list
	response, err := c.Emit(ctx, "getMonitorList")
	if err != nil {
		return nil, fmt.Errorf("getMonitorList failed: %w", err)
	}

	if len(response) > 0 {
		if resp, ok := response[0].(map[string]interface{}); ok {
			if ok, _ := resp["ok"].(bool); !ok {
				msg, _ := resp["msg"].(string)
				return nil, fmt.Errorf("getMonitorList failed: %s", msg)
			}
		}
	}

	// Wait for monitorList event
	select {
	case monitorsData := <-monitorsCh:
		return parseMonitorList(monitorsData), nil
	case <-time.After(30 * time.Second):
		return nil, errors.New("timeout waiting for monitorList")
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// AddMonitor creates a new monitor on the probe.
func (c *KumaClient) AddMonitor(ctx context.Context, monitor *db.Monitor) (int64, error) {
	payload := monitor.ToKumaPayload()
	// Remove ID for create operation
	delete(payload, "id")

	response, err := c.Emit(ctx, "add", payload)
	if err != nil {
		return 0, fmt.Errorf("add monitor failed: %w", err)
	}

	if len(response) == 0 {
		return 0, errors.New("empty add response")
	}

	resp, ok := response[0].(map[string]interface{})
	if !ok {
		return 0, errors.New("invalid add response format")
	}

	if ok, _ := resp["ok"].(bool); !ok {
		msg, _ := resp["msg"].(string)
		return 0, fmt.Errorf("add monitor failed: %s", msg)
	}

	monitorID, _ := resp["monitorID"].(float64)
	return int64(monitorID), nil
}

// EditMonitor updates an existing monitor on the probe.
func (c *KumaClient) EditMonitor(ctx context.Context, monitor *db.Monitor) error {
	payload := monitor.ToKumaPayload()

	response, err := c.Emit(ctx, "editMonitor", payload)
	if err != nil {
		return fmt.Errorf("edit monitor failed: %w", err)
	}

	if len(response) == 0 {
		return errors.New("empty edit response")
	}

	resp, ok := response[0].(map[string]interface{})
	if !ok {
		return errors.New("invalid edit response format")
	}

	if ok, _ := resp["ok"].(bool); !ok {
		msg, _ := resp["msg"].(string)
		return fmt.Errorf("edit monitor failed: %s", msg)
	}

	return nil
}

// DeleteMonitor removes a monitor from the probe.
func (c *KumaClient) DeleteMonitor(ctx context.Context, monitorID int64, deleteChildren bool) error {
	response, err := c.Emit(ctx, "deleteMonitor", monitorID, deleteChildren)
	if err != nil {
		return fmt.Errorf("delete monitor failed: %w", err)
	}

	if len(response) == 0 {
		return errors.New("empty delete response")
	}

	resp, ok := response[0].(map[string]interface{})
	if !ok {
		return errors.New("invalid delete response format")
	}

	if ok, _ := resp["ok"].(bool); !ok {
		msg, _ := resp["msg"].(string)
		return fmt.Errorf("delete monitor failed: %s", msg)
	}

	return nil
}

// Disconnect closes the Socket.IO connection.
func (c *KumaClient) Disconnect() {
	c.connected.Store(false)
	if c.conn != nil {
		c.conn.Close()
	}
}

// IsConnected returns true if the client is connected.
func (c *KumaClient) IsConnected() bool {
	return c.connected.Load()
}

// parseMonitorList converts the raw monitor list data to typed Monitor structs.
func parseMonitorList(data map[string]interface{}) map[int64]*db.Monitor {
	monitors := make(map[int64]*db.Monitor)

	for idStr, monitorData := range data {
		id, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil {
			continue
		}

		monitorJSON, err := json.Marshal(monitorData)
		if err != nil {
			continue
		}

		// Parse into a generic map first, then extract needed fields
		var rawMonitor map[string]interface{}
		if err := json.Unmarshal(monitorJSON, &rawMonitor); err != nil {
			continue
		}

		monitor := &db.Monitor{
			ID: id,
		}

		// Extract basic fields
		if name, ok := rawMonitor["name"].(string); ok {
			monitor.Name = name
		}
		if typ, ok := rawMonitor["type"].(string); ok {
			monitor.Type = typ
		}
		if active, ok := rawMonitor["active"].(bool); ok {
			if active {
				monitor.Active = 1
			}
		}
		if interval, ok := rawMonitor["interval"].(float64); ok {
			monitor.Interval = int(interval)
		}

		monitors[id] = monitor
	}

	return monitors
}
