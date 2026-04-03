import type { MonitorData } from "./kuma-state";
import type { PublicCatalogMonitor } from "~/types/public";

function toSingleLine(text: string): string {
    return text
        .replace(/\r/g, "")
        .replace(/\n+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function stripMarkdown(text: string): string {
    return toSingleLine(
        text
            .replace(/```[\s\S]*?```/g, " ")
            .replace(/`([^`]*)`/g, "$1")
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
            .replace(/^[#>\-\*\s]+/gm, "")
            .replace(/[_*~]/g, "")
    );
}

export function getDescriptionExcerpt(description: string | null | undefined): string | null {
    if (!description) {
        return null;
    }
    const firstParagraph = description
        .split(/\n\s*\n/)
        .map((part) => stripMarkdown(part))
        .find(Boolean);

    return firstParagraph || null;
}

export function getWhyMonitored(description: string | null | undefined): string | null {
    const excerpt = getDescriptionExcerpt(description);
    if (!excerpt) {
        return null;
    }

    const sentenceMatch = excerpt.match(/.+?[.!?](?:\s|$)/);
    if (sentenceMatch) {
        return sentenceMatch[0].trim();
    }

    return excerpt;
}

export function getMonitorEndpoint(monitor: Pick<MonitorData, "url" | "hostname" | "port">): string | null {
    if (typeof monitor.url === "string" && monitor.url.length > 0) {
        return monitor.url;
    }
    if (typeof monitor.hostname === "string" && monitor.hostname.length > 0) {
        return typeof monitor.port === "number"
            ? `${monitor.hostname}:${monitor.port}`
            : monitor.hostname;
    }
    return null;
}

export function sanitizePublicMonitor(monitor: MonitorData): PublicCatalogMonitor {
    return {
        id: monitor.id,
        name: monitor.name,
        description: monitor.description || null,
        type: monitor.type,
        parent: monitor.parent,
        active: monitor.active,
        tags: monitor.tags || [],
        url: typeof monitor.url === "string" ? monitor.url : undefined,
        hostname: typeof monitor.hostname === "string" ? monitor.hostname : undefined,
        port: typeof monitor.port === "number" ? monitor.port : undefined,
        weight: monitor.weight,
        pathName: monitor.pathName,
        childrenIDs: Array.isArray(monitor.childrenIDs) ? monitor.childrenIDs : [],
    };
}

export function sanitizePublicMonitors(monitors: Record<string, MonitorData>): Record<string, PublicCatalogMonitor> {
    return Object.fromEntries(
        Object.entries(monitors).map(([id, monitor]) => [id, sanitizePublicMonitor(monitor)])
    );
}
