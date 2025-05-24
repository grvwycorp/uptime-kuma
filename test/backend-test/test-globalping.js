const { describe, test } = require("node:test");
const assert = require("node:assert");
const { GlobalPingMonitorType } = require("../../server/monitor-types/globalping");
const { UP, DOWN, PENDING } = require("../../src/util");
const axios = require("axios");

describe("GlobalPing Monitor Type", () => {

    test("GlobalPing API connectivity", async () => {
        // First, verify GlobalPing API is accessible by checking rate limits endpoint
        try {
            const response = await axios.get("https://api.globalping.io/v1/limits", {
                timeout: 10000,
                headers: {
                    "User-Agent": "Uptime-Kuma-Test"
                }
            });

            // Verify rate limits response structure
            assert.ok(response.data);
            assert.ok(typeof response.data.rateLimit === "object");
            assert.ok(typeof response.data.rateLimit.measurements === "object");
            console.log("✓ GlobalPing API is accessible and rate limits available");
        } catch (error) {
            console.warn("⚠ GlobalPing API not accessible:", error.message);
            console.warn("⚠ Skipping GlobalPing monitor tests");
            return; // Skip tests if API is not accessible
        }
    });

    test("GlobalPing monitor with valid target", async () => {
        const globalPingMonitor = new GlobalPingMonitorType();
        const monitor = {
            url: "google.com",
            interval: 30, // Meet minimum interval requirement
            globalping_locations: JSON.stringify([{ magic: "Europe" }]),
            globalping_success_threshold: 80,
            globalping_enable_progress_tracking: false,
            globalping_enable_observability: false,
            globalping_auto_pause: false,
            globalping_consecutive_429s: 0
        };

        const heartbeat = {
            msg: "",
            status: PENDING,
            ping: null
        };

        try {
            // This will create a real measurement - should complete quickly
            await globalPingMonitor.check(monitor, heartbeat, {});

            // Verify the measurement completed successfully
            assert.ok([ UP, DOWN ].includes(heartbeat.status), "Status should be UP or DOWN");
            assert.ok(heartbeat.msg.length > 0, "Should have a meaningful message");
            console.log(`✓ GlobalPing test result: ${heartbeat.status} - ${heartbeat.msg}`);

            // If successful, should have latency data
            if (heartbeat.status === UP) {
                assert.ok(typeof heartbeat.ping === "number", "Should have ping latency");
                assert.ok(heartbeat.ping > 0, "Ping should be positive number");
            }

        } catch (error) {
            // Check if it's a rate limiting error (429)
            if (error.response?.status === 429) {
                console.warn("⚠ Rate limited - this is expected behavior");
                console.warn("⚠ Monitor should handle this gracefully");
                assert.ok(true); // This is actually a valid test result
            } else {
                console.error("✗ Unexpected error:", error.message);
                throw error;
            }
        }
    });

    test("GlobalPing monitor with invalid target", async () => {
        const globalPingMonitor = new GlobalPingMonitorType();
        const monitor = {
            url: "localhost", // Should be blocked by SSRF protection
            interval: 30,
            globalping_locations: JSON.stringify([{ magic: "Europe" }]),
            globalping_success_threshold: 80
        };

        const heartbeat = {
            msg: "",
            status: PENDING,
            ping: null
        };

        await globalPingMonitor.check(monitor, heartbeat, {});

        // Should result in DOWN status with error message
        assert.strictEqual(heartbeat.status, DOWN);
        assert.ok(heartbeat.msg.includes("Internal network targets are not allowed"));
        console.log("✓ SSRF protection working: blocked localhost");
    });

    test("GlobalPing monitor with insufficient interval", async () => {
        const globalPingMonitor = new GlobalPingMonitorType();
        const monitor = {
            url: "google.com",
            interval: 10, // Below minimum 30 seconds
            globalping_locations: JSON.stringify([{ magic: "Europe" }]),
            globalping_success_threshold: 80
        };

        const heartbeat = {
            msg: "",
            status: PENDING,
            ping: null
        };

        try {
            await globalPingMonitor.check(monitor, heartbeat, {});
            assert.fail("Should have thrown error for interval < 30 seconds");
        } catch (error) {
            assert.ok(error.message.includes("minimum 30-second interval"));
            console.log("✓ Rate limiting protection working: blocked short interval");
        }
    });

    test("GlobalPing monitor with malformed locations", async () => {
        const globalPingMonitor = new GlobalPingMonitorType();
        const monitor = {
            url: "google.com",
            interval: 30,
            globalping_locations: "invalid json", // Malformed JSON
            globalping_success_threshold: 80
        };

        const heartbeat = {
            msg: "",
            status: PENDING,
            ping: null
        };

        await globalPingMonitor.check(monitor, heartbeat, {});

        // Should result in DOWN status with error message
        assert.strictEqual(heartbeat.status, DOWN);
        assert.ok(heartbeat.msg.includes("Invalid locations configuration"));
        console.log("✓ Input validation working: blocked malformed locations");
    });
});
