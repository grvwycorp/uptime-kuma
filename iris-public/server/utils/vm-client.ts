interface PrometheusResultItem {
    metric: Record<string, string>;
    value?: [number, string];
    values?: Array<[number, string]>;
}

interface PrometheusApiResponse {
    status: string;
    data?: {
        resultType: string;
        result: PrometheusResultItem[];
    };
    errorType?: string;
    error?: string;
}

interface CacheEntry<T> {
    expiresAt: number;
    value: T;
}

const cache = new Map<string, CacheEntry<PrometheusResultItem[]>>();
const CACHE_TTL_MS = 60_000;

function buildCacheKey(kind: string, url: string, query: string, params: Record<string, string>): string {
    const serializedParams = Object.entries(params)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join("&");
    return `${kind}:${url}:${query}:${serializedParams}`;
}

async function fetchPrometheusApi(
    baseUrl: string,
    path: string,
    query: string,
    params: Record<string, string>,
): Promise<PrometheusResultItem[]> {
    const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    const cacheKey = buildCacheKey(path, normalizedBaseUrl, query, params);
    const now = Date.now();
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        return cached.value;
    }

    const url = new URL(`${normalizedBaseUrl}${path}`);
    url.searchParams.set("query", query);
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }

    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
        throw new Error(`VictoriaMetrics query failed with HTTP ${response.status}`);
    }

    const payload = await response.json() as PrometheusApiResponse;
    if (payload.status !== "success" || !payload.data?.result) {
        throw new Error(payload.error || payload.errorType || "VictoriaMetrics query returned an invalid response");
    }

    cache.set(cacheKey, {
        expiresAt: now + CACHE_TTL_MS,
        value: payload.data.result,
    });

    return payload.data.result;
}

export function queryVmInstant(baseUrl: string, query: string, time?: Date): Promise<PrometheusResultItem[]> {
    return fetchPrometheusApi(
        baseUrl,
        "/api/v1/query",
        query,
        time ? { time: `${Math.floor(time.getTime() / 1000)}` } : {}
    );
}

export function queryVmRange(
    baseUrl: string,
    query: string,
    start: Date,
    end: Date,
    stepSeconds: number,
): Promise<PrometheusResultItem[]> {
    return fetchPrometheusApi(baseUrl, "/api/v1/query_range", query, {
        start: `${Math.floor(start.getTime() / 1000)}`,
        end: `${Math.floor(end.getTime() / 1000)}`,
        step: `${stepSeconds}`,
    });
}

export type { PrometheusResultItem };
