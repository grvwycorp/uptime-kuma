const { MonitorType } = require("./monitor-type");
const { log, UP, DOWN } = require("../../src/util");
const { axiosAbortSignal } = require("../util-server");
const axios = require("axios");
const { ConditionVariable } = require("../monitor-conditions/variables");
const { numericOperators } = require("../monitor-conditions/operators");

class GlobalPingMonitorType extends MonitorType {
    name = "globalping";

    /**
     * GlobalPing supports conditions based on measurement results
     */
    supportsConditions = true;

    /**
     * Available condition variables for GlobalPing monitoring
     */
    conditionVariables = [
        new ConditionVariable("avgLatency", numericOperators),
        new ConditionVariable("successRate", numericOperators),
        new ConditionVariable("probeCount", numericOperators)
    ];

    /**
     * @inheritdoc
     */
    async check(monitor, heartbeat, server) {
        // Validate minimum interval (30 seconds) to prevent rate limiting
        if (monitor.interval < 30) {
            throw new Error("GlobalPing monitors require minimum 30-second interval to prevent API rate limiting");
        }

        try {
            // Step 1: Create measurement
            const measurement = await this.createMeasurement(monitor);
            log.debug("monitor", `[${monitor.name}] GlobalPing measurement created: ${measurement.id}`);

            // Step 2: Wait for completion (measurements finish in 1-2 seconds)
            const result = await this.pollForResult(measurement.id, monitor);
            log.debug("monitor", `[${monitor.name}] GlobalPing measurement completed`);

            // Step 3: Parse results and set heartbeat
            this.parseResults(result, heartbeat, monitor);

            // Reset consecutive 429 errors on successful measurement
            if (monitor.globalping_consecutive_429s > 0) {
                await this.resetConsecutive429s(monitor);
            }

        } catch (error) {
            log.debug("monitor", `[${monitor.name}] GlobalPing error: ${error.message}`);

            // Handle rate limiting with auto-pause feature
            if (error.response?.status === 429) {
                await this.handleRateLimit(monitor, heartbeat);
            } else {
                heartbeat.status = DOWN;
                heartbeat.msg = `GlobalPing error: ${error.message}`;
            }
        }
    }

    /**
     * Create a new measurement using GlobalPing API
     * @param {object} monitor Monitor configuration
     * @returns {Promise<object>} Measurement response
     */
    async createMeasurement(monitor) {
        // Parse locations (default to Europe if not specified)
        let locations;
        try {
            locations = monitor.globalping_locations ?
                JSON.parse(monitor.globalping_locations) :
                [{ magic: "Europe" }];
        } catch (error) {
            throw new Error("Invalid locations configuration");
        }

        // Validate target to prevent SSRF attacks
        this.validateTarget(monitor.url);

        const requestBody = {
            type: "ping",
            target: monitor.url,
            locations: locations,
            measurementOptions: {
                packets: 3
            }
        };

        const options = {
            url: "https://api.globalping.io/v1/measurements",
            method: "post",
            timeout: 10000, // 10 seconds for measurement creation
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Uptime-Kuma"
            },
            data: requestBody,
            signal: axiosAbortSignal(15000), // 15 seconds total timeout
        };

        // Add API token if provided
        if (monitor.globalping_api_token) {
            options.headers.Authorization = `Bearer ${monitor.globalping_api_token}`;
        }

        log.debug("monitor", `[${monitor.name}] Creating GlobalPing measurement: ${JSON.stringify(requestBody)}`);
        const response = await axios.request(options);

        return {
            id: response.data.id,
            probesCount: response.data.probesCount
        };
    }

    /**
     * Poll for measurement results
     * @param {string} measurementId Measurement ID
     * @param {object} monitor Monitor configuration
     * @returns {Promise<object>} Measurement results
     */
    async pollForResult(measurementId, monitor) {
        // Mode 1: Simple - just wait 3 seconds then get result
        if (!monitor.globalping_enable_progress_tracking) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            return await this.getMeasurement(measurementId);
        }

        // Mode 2: Progress tracking - poll every 5 seconds
        const maxAttempts = 6; // 30 seconds max
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const result = await this.getMeasurement(measurementId);

            if (result.status === "finished") {
                return result;
            }

            // Wait 5 seconds before next attempt
            if (attempt < maxAttempts - 1) {
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        throw new Error("Measurement timeout after 30 seconds");
    }

    /**
     * Get measurement results from GlobalPing API
     * @param {string} measurementId Measurement ID
     * @returns {Promise<object>} Measurement data
     */
    async getMeasurement(measurementId) {
        const options = {
            url: `https://api.globalping.io/v1/measurements/${measurementId}`,
            method: "get",
            timeout: 10000,
            signal: axiosAbortSignal(15000),
        };

        const response = await axios.request(options);
        return response.data;
    }

    /**
     * Parse GlobalPing results and update heartbeat
     * @param {object} apiResponse GlobalPing API response
     * @param {object} heartbeat Heartbeat to update
     * @param {object} monitor Monitor configuration
     * @returns {void}
     */
    parseResults(apiResponse, heartbeat, monitor) {
        const results = apiResponse.results;
        const totalProbes = results.length;
        const successfulProbes = results.filter(r => r.result.status === "finished").length;
        const successRate = totalProbes > 0 ? (successfulProbes / totalProbes) * 100 : 0;

        // Calculate average latency from successful probes
        const successfulResults = results.filter(r => r.result.status === "finished");
        const avgLatency = successfulResults.length > 0 ?
            successfulResults.reduce((sum, r) => sum + r.result.stats.avg, 0) / successfulResults.length :
            null;

        // Determine status based on success threshold
        const threshold = monitor.globalping_success_threshold || 80;
        heartbeat.status = successRate >= threshold ? UP : DOWN;

        // Set latency
        heartbeat.ping = avgLatency;

        // Create user-friendly message with location details
        const locationSummary = results.slice(0, 3).map(r =>
            `${r.probe.country}/${r.probe.city}`
        ).join(", ");

        const moreLocations = results.length > 3 ? ` +${results.length - 3} more` : "";

        if (heartbeat.status === UP) {
            heartbeat.msg = `Global connectivity OK (${successfulProbes}/${totalProbes} probes, avg ${Math.round(avgLatency)}ms) - ${locationSummary}${moreLocations}`;
        } else {
            heartbeat.msg = `Global connectivity failed (${successfulProbes}/${totalProbes} probes succeeded) - ${locationSummary}${moreLocations}`;
        }

        log.debug("monitor", `[${monitor.name}] GlobalPing result: ${heartbeat.status} - ${heartbeat.msg}`);
    }

    /**
     * Handle rate limiting with auto-pause functionality
     * @param {object} monitor Monitor configuration
     * @param {object} heartbeat Heartbeat to update
     * @returns {Promise<void>}
     */
    async handleRateLimit(monitor, heartbeat) {
        const R = require("redbean-node").R;

        // Increment consecutive 429 counter
        const count = (monitor.globalping_consecutive_429s || 0) + 1;
        await R.exec("UPDATE monitor SET globalping_consecutive_429s = ? WHERE id = ?", [ count, monitor.id ]);

        // Auto-pause if enabled and threshold reached
        if (monitor.globalping_auto_pause && count >= 3) {
            log.warn("monitor", `Auto-pausing GlobalPing monitor ${monitor.name} after ${count} consecutive rate limit errors`);

            // Use existing pause functionality
            await R.exec("UPDATE monitor SET active = 0 WHERE id = ?", [ monitor.id ]);

            heartbeat.status = DOWN;
            heartbeat.msg = "Auto-paused due to rate limiting. Please check your API usage and resume manually.";
        } else {
            heartbeat.status = DOWN;
            heartbeat.msg = `Rate limited (${count}/3 strikes before auto-pause)`;
        }
    }

    /**
     * Reset consecutive 429 error counter
     * @param {object} monitor Monitor configuration
     * @returns {Promise<void>}
     */
    async resetConsecutive429s(monitor) {
        const R = require("redbean-node").R;
        await R.exec("UPDATE monitor SET globalping_consecutive_429s = 0 WHERE id = ?", [ monitor.id ]);
    }

    /**
     * Validate target to prevent SSRF attacks
     * @param {string} target Target hostname or IP
     * @throws {Error} When target is invalid or not allowed
     * @returns {void}
     */
    validateTarget(target) {
        if (!target) {
            throw new Error("Target is required");
        }

        // Basic validation - prevent obvious internal targets
        const forbiddenTargets = [
            "localhost",
            "127.0.0.1",
            "0.0.0.0",
            "::1"
        ];

        const lowerTarget = target.toLowerCase();
        if (forbiddenTargets.some(forbidden => lowerTarget.includes(forbidden))) {
            throw new Error("Internal network targets are not allowed");
        }

        // Check for private network ranges in IP addresses
        if (this.isPrivateIP(target)) {
            throw new Error("Private network targets are not allowed");
        }
    }

    /**
     * Check if target is a private IP address
     * @param {string} target Target to check
     * @returns {boolean} True if private IP
     */
    isPrivateIP(target) {
        // Basic private IP detection
        const privateRanges = [
            /^10\./,
            /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
            /^192\.168\./,
            /^169\.254\./
        ];

        return privateRanges.some(range => range.test(target));
    }
}

module.exports = {
    GlobalPingMonitorType,
};
