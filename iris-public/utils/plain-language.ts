/**
 * Plain-language Swedish vocabulary for the public status page.
 *
 * Every operator term (monitor, probe, degraded, endpoint …) is translated
 * here into words an ordinary person understands. All homepage-facing
 * strings should come from this module so the vocabulary stays consistent.
 */

export type PublicStatus = "up" | "down" | "degraded" | "unknown";

const PROBE_PLACE_NAMES: Record<string, string> = {
    "probe01": "Stockholm",
    "probe04-oraclesto": "Stockholm (moln)",
    "probe03-karabro": "Malmö",
    "labbmartin": "Karlstad",
};

/**
 * Human place name for a measurement location (probe id). Falls back to
 * the raw id so new locations never break the page.
 */
export function probePlaceName(probeId: string): string {
    return PROBE_PLACE_NAMES[probeId] ?? probeId;
}

/**
 * Plain Swedish status word, used on chips throughout the page.
 */
export function statusWord(status: PublicStatus): string {
    if (status === "up") {
        return "Fungerar";
    }
    if (status === "degraded") {
        return "Delvis störningar";
    }
    if (status === "down") {
        return "Störningar";
    }
    return "Ingen data";
}

/**
 * Response time in words. Pair with formatMs() in muted small print.
 */
export function speedWord(ms: number): string {
    if (ms < 300) {
        return "Snabb";
    }
    if (ms <= 1000) {
        return "Normal";
    }
    return "Långsam";
}

export function formatMs(ms: number | null): string {
    if (ms === null) {
        return "";
    }
    return `${Math.round(ms)} ms`;
}

const MONITOR_TYPE_LABELS: Record<string, string> = {
    "http": "Webbsida svarar",
    "keyword": "Sidinnehåll korrekt",
    "json-query": "API-svar korrekt",
    "dns": "Adressuppslag",
    "ping": "Nätverkssvar",
    "port": "Anslutning öppen",
    "push": "Hjärtslag",
};

/**
 * Friendly Swedish label for a technical check type.
 */
export function monitorTypeLabel(type: string): string {
    return MONITOR_TYPE_LABELS[type] ?? "Automatisk kontroll";
}

/**
 * Relative time in friendly Swedish ("nyss", "för 5 min sedan").
 */
export function timeAgo(eventAt: string): string {
    const parsed = Date.parse(eventAt);
    if (Number.isNaN(parsed)) {
        return "";
    }
    const seconds = Math.max(0, Math.round((Date.now() - parsed) / 1000));
    if (seconds < 60) {
        return "nyss";
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return `för ${minutes} min sedan`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours === 1) {
        return "för 1 timme sedan";
    }
    return `för ${hours} timmar sedan`;
}

/**
 * "Kontrolleras från N platser" — how many locations watch a service.
 */
export function placesPhrase(probeCount: number): string {
    if (probeCount <= 0) {
        return "Väntar på första kontrollen";
    }
    if (probeCount === 1) {
        return "Kontrolleras från 1 plats";
    }
    return `Kontrolleras från ${probeCount} platser`;
}
