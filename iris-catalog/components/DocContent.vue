<template>
    <div class="doc-content">
        <div v-if="!monitor" class="empty-state">
            <h2>Iris Catalog</h2>
            <p>Select a service or monitor from the tree to view documentation.</p>
        </div>

        <template v-else>
            <div class="doc-header">
                <nav v-if="breadcrumbs.length > 1" class="breadcrumbs">
                    <template v-for="(crumb, i) in breadcrumbs" :key="crumb.id">
                        <span v-if="i > 0" class="breadcrumb-sep">/</span>
                        <NuxtLink
                            v-if="i < breadcrumbs.length - 1"
                            :to="`/catalog/${crumb.id}`"
                            class="breadcrumb-link"
                        >{{ crumb.name }}</NuxtLink>
                        <span v-else class="breadcrumb-current">{{ crumb.name }}</span>
                    </template>
                </nav>
                <h1>{{ monitor.name }}</h1>
                <div class="doc-meta">
                    <span class="meta-type">{{ monitor.type }}</span>
                    <span v-if="monitor.pathName" class="meta-path">{{ monitor.pathName }}</span>
                </div>
                <div v-if="monitor.tags && monitor.tags.length > 0" class="doc-tags">
                    <span
                        v-for="tag in monitor.tags"
                        :key="tag.tag_id"
                        class="tag"
                        :style="{ background: tag.color + '20', color: tag.color, borderColor: tag.color + '40' }"
                    >
                        {{ tag.name }}<template v-if="tag.value">: {{ tag.value }}</template>
                    </span>
                </div>
            </div>

            <!-- Monitor description (Markdown from description field) -->
            <div
                v-if="monitor.description"
                class="doc-body"
                v-html="renderedDescription"
            ></div>

            <!-- Fallback: auto-generated summary -->
            <div v-else class="doc-body doc-fallback">
                <p class="no-docs">No documentation yet for this monitor.</p>
                <h3>Monitor Configuration</h3>
                <table class="config-table">
                    <tr v-if="monitor.url"><td>URL</td><td>{{ monitor.url }}</td></tr>
                    <tr v-if="monitor.hostname"><td>Hostname</td><td>{{ monitor.hostname }}</td></tr>
                    <tr v-if="monitor.port"><td>Port</td><td>{{ monitor.port }}</td></tr>
                    <tr><td>Type</td><td>{{ monitor.type }}</td></tr>
                    <tr><td>Active</td><td>{{ monitor.active ? 'Yes' : 'No' }}</td></tr>
                </table>
            </div>

            <!-- Extended docs from Nuxt Content (if available) -->
            <ContentDoc
                v-if="contentPath"
                :path="contentPath"
                class="doc-extended"
            >
                <template #not-found>
                    <!-- No extended docs, that's fine -->
                </template>
                <template #empty>
                    <!-- Empty doc, that's fine -->
                </template>
            </ContentDoc>
        </template>
    </div>
</template>

<script setup lang="ts">
import { marked } from "marked";
import type { MonitorData } from "~/server/utils/kuma-state";

const props = defineProps<{
    monitor: MonitorData | null;
    monitors?: Record<string, MonitorData>;
}>();

const renderedDescription = computed(() => {
    if (!props.monitor?.description) {
        return "";
    }
    return marked.parse(props.monitor.description);
});

/**
 * Build breadcrumb chain from current monitor up to the root
 * @returns array of { id, name } from root to current
 */
const breadcrumbs = computed(() => {
    if (!props.monitor || !props.monitors) {
        return [];
    }
    const chain: Array<{ id: number; name: string }> = [];
    let current: MonitorData | undefined = props.monitor;
    while (current) {
        chain.unshift({ id: current.id, name: current.name });
        current = current.parent ? props.monitors[String(current.parent)] : undefined;
    }
    return chain;
});

// Try to find matching Nuxt Content page by monitor name (slugified)
const contentPath = computed(() => {
    if (!props.monitor) {
        return null;
    }
    const slug = props.monitor.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    return `/services/${slug}`;
});
</script>

<style scoped>
.doc-content {
    height: 100%;
    overflow-y: auto;
    padding: 24px;
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--grey1);
    text-align: center;
}

.empty-state h2 {
    font-size: 20px;
    margin-bottom: 8px;
    color: var(--grey0);
}

.breadcrumbs {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    margin-bottom: 8px;
    flex-wrap: wrap;
}

.breadcrumb-sep {
    color: var(--grey0);
}

.breadcrumb-link {
    color: var(--grey1);
    text-decoration: none;
}

.breadcrumb-link:hover {
    color: var(--green);
}

.breadcrumb-current {
    color: var(--grey0);
}

.doc-header {
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--bg2);
}

.doc-header h1 {
    font-size: 24px;
    font-weight: 700;
    margin: 0 0 8px;
    color: var(--fg);
}

.doc-meta {
    display: flex;
    gap: 12px;
    font-size: 13px;
    color: var(--grey1);
}

.meta-type {
    background: var(--bg2);
    color: var(--aqua);
    padding: 2px 8px;
    border-radius: 4px;
    font-family: monospace;
    font-size: 12px;
}

.meta-path {
    font-style: italic;
}

.doc-tags {
    display: flex;
    gap: 6px;
    margin-top: 10px;
    flex-wrap: wrap;
}

.tag {
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid;
}

.doc-body {
    line-height: 1.7;
    font-size: 15px;
    color: var(--fg);
}

.doc-body :deep(h1),
.doc-body :deep(h2),
.doc-body :deep(h3) {
    margin-top: 1.5em;
    margin-bottom: 0.5em;
    color: var(--fg);
}

.doc-body :deep(code) {
    background: var(--bg2);
    color: var(--orange);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 13px;
}

.doc-body :deep(pre) {
    background: var(--bg0);
    color: var(--fg);
    padding: 16px;
    border-radius: 8px;
    overflow-x: auto;
}

.doc-body :deep(pre) :deep(code) {
    background: transparent;
    color: inherit;
    padding: 0;
}

.no-docs {
    color: var(--grey1);
    font-style: italic;
    margin-bottom: 16px;
}

.config-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
}

.config-table td {
    padding: 6px 12px;
    border-bottom: 1px solid var(--bg2);
}

.config-table td:first-child {
    font-weight: 600;
    width: 120px;
    color: var(--grey1);
}

.doc-extended {
    margin-top: 32px;
    padding-top: 24px;
    border-top: 1px solid var(--bg2);
}
</style>
