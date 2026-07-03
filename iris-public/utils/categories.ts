/**
 * Service category mapping for the public homepage.
 *
 * Services are grouped under Swedish everyday headings by keyword matching
 * on the service slug. The longest (most specific) keyword wins, so
 * "icabanken" lands in Bank & pengar before "ica" pulls it into Handel.
 * Anything unmatched falls back to "Övrigt".
 */

export interface CategoryDefinition {
    id: string;
    title: string;
    keywords: string[];
}

export const FALLBACK_CATEGORY_ID = "ovrigt";

export const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
    {
        id: "bank",
        title: "Bank & pengar",
        keywords: ["avanza", "bankgirot", "bankid", "icabanken", "trustly", "swish", "betal"],
    },
    {
        id: "myndigheter",
        title: "Myndigheter & samhälle",
        keywords: [
            "skatteverket", "bolagsverket", "csn", "digg", "migrationsverket",
            "lantmateriet", "val", "trafikverket", "sos-alarm", "sosalarm",
            "smhi", "polisen", "forsakringskassan",
        ],
    },
    {
        id: "vard",
        title: "Vård & apotek",
        keywords: ["1177", "apotea", "apotek", "ehalsomyndigheten", "halsa", "vard"],
    },
    {
        id: "handel",
        title: "Handel & vardag",
        keywords: ["ica", "hemtex", "ica-gruppen"],
    },
    {
        id: "internet",
        title: "Internet & telefoni",
        keywords: ["telia", "chilimobil", "karlstadsnat", "bahnhof", "telenor", "tre"],
    },
    {
        id: "karlstad",
        title: "Karlstad & Värmland",
        keywords: ["karlstad", "karlstadsenergi", "kbab", "karlstadairport", "varmlandstrafik"],
    },
];

/** Render order: defined categories first, then the fallback bucket. */
export const CATEGORY_ORDER: Array<{ id: string; title: string }> = [
    ...CATEGORY_DEFINITIONS.map(({ id, title }) => ({ id, title })),
    { id: FALLBACK_CATEGORY_ID, title: "Övrigt" },
];

/**
 * Resolve the category id for a service slug (longest keyword match wins).
 */
export function categoryIdForSlug(slug: string): string {
    const normalized = slug.toLowerCase();
    let bestId: string | null = null;
    let bestLength = 0;

    for (const category of CATEGORY_DEFINITIONS) {
        for (const keyword of category.keywords) {
            if (keyword.length > bestLength && normalized.includes(keyword)) {
                bestId = category.id;
                bestLength = keyword.length;
            }
        }
    }

    return bestId ?? FALLBACK_CATEGORY_ID;
}
