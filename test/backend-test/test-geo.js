const { describe, test, beforeEach } = require("node:test");
const assert = require("node:assert");

const GeoProvider = require("../../server/lib/geo/geo-provider");
const IpApiGeoProvider = require("../../server/lib/geo/providers/ip-api");
const { extractHostname } = require("../../server/lib/geo/geo-resolver");

describe("GeoProvider Base Class", () => {
    test("lookup() throws if not overridden", async () => {
        const provider = new GeoProvider();
        await assert.rejects(
            () => provider.lookup("1.2.3.4"),
            { message: "GeoProvider.lookup() must be overridden" }
        );
    });

    test("discoverSelf() throws if not overridden", async () => {
        const provider = new GeoProvider();
        await assert.rejects(
            () => provider.discoverSelf(),
            { message: "GeoProvider.discoverSelf() must be overridden" }
        );
    });

    test("name defaults to undefined", () => {
        const provider = new GeoProvider();
        assert.strictEqual(provider.name, undefined);
    });
});

describe("IpApiGeoProvider", () => {
    test("has correct name", () => {
        const provider = new IpApiGeoProvider();
        assert.strictEqual(provider.name, "ip-api");
    });

    test("sets baseUrl correctly", () => {
        const provider = new IpApiGeoProvider();
        assert.strictEqual(provider.baseUrl, "http://ip-api.com/json");
    });

    test("sets fields parameter", () => {
        const provider = new IpApiGeoProvider();
        assert.ok(provider.fields.includes("countryCode"));
        assert.ok(provider.fields.includes("lat"));
        assert.ok(provider.fields.includes("lon"));
        assert.ok(provider.fields.includes("as"));
        assert.ok(provider.fields.includes("query"));
    });

    test("normalize() maps ip-api response to standard format", () => {
        const provider = new IpApiGeoProvider();
        const raw = {
            status: "success",
            countryCode: "SE",
            regionName: "Stockholm",
            city: "Stockholm",
            lat: 59.3293,
            lon: 18.0686,
            as: "AS24940 Hetzner Online GmbH",
            org: "Hetzner",
            query: "64.112.124.66",
        };

        const result = provider.normalize(raw);
        assert.deepStrictEqual(result, {
            lat: 59.3293,
            lon: 18.0686,
            country: "SE",
            city: "Stockholm",
            region: "Stockholm",
            asn: "AS24940",
            org: "Hetzner",
        });
    });

    test("normalize() extracts ASN number from compound field", () => {
        const provider = new IpApiGeoProvider();

        const result = provider.normalize({
            as: "AS15169 Google LLC",
            countryCode: "US",
            city: "Mountain View",
            lat: 37.386,
            lon: -122.0838,
        });
        assert.strictEqual(result.asn, "AS15169");
        assert.strictEqual(result.org, "");
    });

    test("normalize() handles missing fields gracefully", () => {
        const provider = new IpApiGeoProvider();

        const result = provider.normalize({});
        assert.deepStrictEqual(result, {
            lat: null,
            lon: null,
            country: "",
            city: "",
            region: "",
            asn: "",
            org: "",
        });
    });

    test("normalize() handles empty as field", () => {
        const provider = new IpApiGeoProvider();

        const result = provider.normalize({ as: "" });
        assert.strictEqual(result.asn, "");
    });

    test("checkStatus() throws on fail response", () => {
        const provider = new IpApiGeoProvider();

        assert.throws(
            () => provider.checkStatus({ status: "fail", message: "invalid query" }),
            { message: "ip-api lookup failed: invalid query" }
        );
    });

    test("checkStatus() does not throw on success", () => {
        const provider = new IpApiGeoProvider();

        assert.doesNotThrow(
            () => provider.checkStatus({ status: "success" })
        );
    });

    test("checkStatus() handles missing message on fail", () => {
        const provider = new IpApiGeoProvider();

        assert.throws(
            () => provider.checkStatus({ status: "fail" }),
            { message: "ip-api lookup failed: unknown error" }
        );
    });
});

describe("extractHostname", () => {
    test("extracts hostname from HTTP URL", () => {
        assert.strictEqual(
            extractHostname({ url: "https://api.example.com/health", type: "http" }),
            "api.example.com"
        );
    });

    test("extracts hostname from URL with port", () => {
        assert.strictEqual(
            extractHostname({ url: "https://api.example.com:8443/path", type: "http" }),
            "api.example.com"
        );
    });

    test("falls back to hostname field when no URL", () => {
        assert.strictEqual(
            extractHostname({ hostname: "ping.example.com", type: "ping" }),
            "ping.example.com"
        );
    });

    test("falls back to hostname field when URL is invalid", () => {
        assert.strictEqual(
            extractHostname({ url: "not-a-url", hostname: "fallback.com", type: "http" }),
            "fallback.com"
        );
    });

    test("returns null when neither URL nor hostname", () => {
        assert.strictEqual(
            extractHostname({ type: "push" }),
            null
        );
    });

    test("returns null for empty monitor", () => {
        assert.strictEqual(
            extractHostname({}),
            null
        );
    });

    test("handles URL with IP address", () => {
        assert.strictEqual(
            extractHostname({ url: "http://192.168.1.1:8080/status", type: "http" }),
            "192.168.1.1"
        );
    });
});

describe("GeoRegistry", () => {
    let originalEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
    });

    test("getInstance returns singleton", () => {
        // Clear module cache to get fresh instance
        delete require.cache[require.resolve("../../server/lib/geo/geo-registry")];
        const { GeoRegistry } = require("../../server/lib/geo/geo-registry");
        const a = GeoRegistry.getInstance();
        const b = GeoRegistry.getInstance();
        assert.strictEqual(a, b);
    });

    test("disabled when GEO_PROVIDER not set", async () => {
        delete require.cache[require.resolve("../../server/lib/geo/geo-registry")];
        delete process.env.GEO_PROVIDER;
        const { GeoRegistry } = require("../../server/lib/geo/geo-registry");
        const registry = new GeoRegistry();
        await registry.init();
        assert.strictEqual(registry.enabled, false);
        assert.strictEqual(registry.provider, null);

        // Restore
        process.env = originalEnv;
    });

    test("disabled for unknown provider", async () => {
        delete require.cache[require.resolve("../../server/lib/geo/geo-registry")];
        process.env.GEO_PROVIDER = "nonexistent";
        const { GeoRegistry } = require("../../server/lib/geo/geo-registry");
        const registry = new GeoRegistry();
        await registry.init();
        assert.strictEqual(registry.enabled, false);

        // Restore
        process.env = originalEnv;
    });

    test("lookup returns null when disabled", async () => {
        delete require.cache[require.resolve("../../server/lib/geo/geo-registry")];
        delete process.env.GEO_PROVIDER;
        const { GeoRegistry } = require("../../server/lib/geo/geo-registry");
        const registry = new GeoRegistry();
        await registry.init();
        const result = await registry.lookup("1.2.3.4");
        assert.strictEqual(result, null);

        // Restore
        process.env = originalEnv;
    });

    test("discoverSelf returns null when disabled", async () => {
        delete require.cache[require.resolve("../../server/lib/geo/geo-registry")];
        delete process.env.GEO_PROVIDER;
        const { GeoRegistry } = require("../../server/lib/geo/geo-registry");
        const registry = new GeoRegistry();
        await registry.init();
        const result = await registry.discoverSelf();
        assert.strictEqual(result, null);

        // Restore
        process.env = originalEnv;
    });
});

describe("GeoCache", () => {
    test("memory cache: get returns null on miss", async () => {
        delete require.cache[require.resolve("../../server/lib/geo/geo-cache")];
        const { GeoCache } = require("../../server/lib/geo/geo-cache");
        const cache = new GeoCache();

        // Memory-only test (no DB)
        const result = cache.memoryCache.get("probe1:1:1.2.3.4");
        assert.strictEqual(result, undefined);
    });

    test("memory cache: setMemory and retrieve", () => {
        delete require.cache[require.resolve("../../server/lib/geo/geo-cache")];
        const { GeoCache } = require("../../server/lib/geo/geo-cache");
        const cache = new GeoCache();

        const geoData = { lat: 50.11, lon: 8.68, country: "DE", city: "Frankfurt", asn: "AS24940" };
        cache.setMemory("probe1:1:1.2.3.4", geoData, Date.now());

        const entry = cache.memoryCache.get("probe1:1:1.2.3.4");
        assert.ok(entry);
        assert.deepStrictEqual(entry.data, geoData);
    });

    test("memory cache: FIFO eviction at max capacity", () => {
        delete require.cache[require.resolve("../../server/lib/geo/geo-cache")];
        const { GeoCache } = require("../../server/lib/geo/geo-cache");
        const cache = new GeoCache();

        // Fill cache to max by inserting 5001 entries (max is 5000)
        const geoData = { lat: 0, lon: 0, country: "XX", city: "Test", asn: "AS1" };
        for (let i = 0; i < 5001; i++) {
            cache.setMemory(`key:${i}`, geoData, Date.now());
        }

        assert.strictEqual(cache.memoryCache.size, 5000);
        // First entry should have been evicted
        assert.strictEqual(cache.memoryCache.has("key:0"), false);
        // Last entry should exist
        assert.strictEqual(cache.memoryCache.has("key:5000"), true);
    });

    test("memory cache: clearMemory empties all entries", () => {
        delete require.cache[require.resolve("../../server/lib/geo/geo-cache")];
        const { GeoCache } = require("../../server/lib/geo/geo-cache");
        const cache = new GeoCache();

        cache.setMemory("test:1:1.1.1.1", { lat: 0, lon: 0 }, Date.now());
        cache.setMemory("test:2:2.2.2.2", { lat: 0, lon: 0 }, Date.now());
        assert.strictEqual(cache.memoryCache.size, 2);

        cache.clearMemory();
        assert.strictEqual(cache.memoryCache.size, 0);
    });

    test("buildKey formats correctly", () => {
        delete require.cache[require.resolve("../../server/lib/geo/geo-cache")];
        const { GeoCache } = require("../../server/lib/geo/geo-cache");
        const cache = new GeoCache();

        assert.strictEqual(cache.buildKey("probe-abc", 42, "8.8.8.8"), "probe-abc:42:8.8.8.8");
        assert.strictEqual(cache.buildKey("p1", 1, "2001:db8::1"), "p1:1:2001:db8::1");
    });
});
