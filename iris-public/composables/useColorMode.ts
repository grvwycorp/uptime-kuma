/**
 * Color mode composable — manages light/dark theme preference.
 * Persists to localStorage, defaults to system preference.
 * SSR-safe: applies data-theme attribute only on client.
 */

type Mode = "light" | "dark" | "system";

const STORAGE_KEY = "iris-color-mode";

const mode = ref<Mode>("system");

/**
 * Resolve the effective theme ("light" or "dark") from the current mode
 */
function resolve(m: Mode): "light" | "dark" {
    if (m === "light" || m === "dark") return m;
    if (import.meta.client && window.matchMedia("(prefers-color-scheme: light)").matches) {
        return "light";
    }
    return "dark";
}

/**
 * Apply data-theme attribute to <html>
 */
function apply(theme: "light" | "dark") {
    if (import.meta.client) {
        document.documentElement.setAttribute("data-theme", theme);
    }
}

export function useColorMode() {
    const resolved = computed(() => resolve(mode.value));

    function toggle() {
        const order: Mode[] = ["dark", "light", "system"];
        const idx = order.indexOf(mode.value);
        mode.value = order[(idx + 1) % order.length];
        if (import.meta.client) {
            localStorage.setItem(STORAGE_KEY, mode.value);
        }
        apply(resolved.value);
    }

    function init() {
        if (!import.meta.client) return;
        const stored = localStorage.getItem(STORAGE_KEY) as Mode | null;
        if (stored && ["light", "dark", "system"].includes(stored)) {
            mode.value = stored;
        }
        apply(resolved.value);

        // Listen for OS theme changes when in system mode
        window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
            if (mode.value === "system") {
                apply(resolve("system"));
            }
        });
    }

    const modeLabel = computed(() => {
        if (mode.value === "light") return "Light mode (click for dark)";
        if (mode.value === "dark") return "Dark mode (click for system)";
        return "System theme (click for dark)";
    });

    const modeIcon = computed(() => {
        if (resolved.value === "light") return "\u2600"; // ☀
        return "\u263E"; // ☾
    });

    return { mode, resolved, toggle, init, modeLabel, modeIcon };
}
