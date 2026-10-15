import { App, WorkspaceLeaf } from "obsidian";

/**
 * Browser adapter. The plugin never hardcodes which browser to use: it detects in a
 * cascade which one is actually active in the vault and delegates to it. When none is
 * available it falls back to the system browser.
 */
export type BrowserKind = "surfing" | "webviewer" | "external";

export interface BrowserAdapter {
	kind: BrowserKind;
	isExternal: boolean;
	/** Opens the URL using the detected browser engine. */
	open: (app: App, url: string, newLeaf: boolean) => Promise<void>;
	/** Looks for an already open tab with the same URL so it can be focused. */
	findOpenLeaf: (app: App, url: string) => WorkspaceLeaf | null;
}

type AnyApp = App & {
	plugins?: { getPlugin?: (id: string) => unknown; enabledPlugins?: Set<string> };
	internalPlugins?: {
		getPluginById?: (id: string) => { enabled?: boolean; instance?: unknown } | undefined;
		getEnabledPluginById?: (id: string) => unknown;
	};
};

export function normalizeUrl(raw: string): string {
	try {
		const u = new URL(raw.trim());
		const host = u.hostname.replace(/^www\./i, "").toLowerCase();
		const path = u.pathname.replace(/\/+$/, "");
		return `${host}${path}${u.search}`;
	} catch {
		return raw.trim().replace(/\/+$/, "").toLowerCase();
	}
}

function isPluginEnabled(app: App, id: string): boolean {
	const anyApp = app as AnyApp;
	if (anyApp.plugins?.getPlugin?.(id)) return true;
	if (anyApp.plugins?.enabledPlugins?.has?.(id)) return true;
	const internal = anyApp.internalPlugins?.getPluginById?.(id);
	return Boolean(internal?.enabled);
}

const SURFING_VIEW_TYPE = "surfing-view";
const WEBVIEWER_VIEW_TYPE = "webviewer";

function findLeafByUrl(app: App, viewType: string, url: string): WorkspaceLeaf | null {
	const target = normalizeUrl(url);
	for (const leaf of app.workspace.getLeavesOfType(viewType)) {
		const viewAny = leaf.view as unknown as { currentUrl?: string };
		const stateUrl = (leaf.getViewState()?.state as { url?: string } | undefined)?.url || "";
		const current = viewAny?.currentUrl || stateUrl;
		if (current && normalizeUrl(current) === target) {
			return leaf;
		}
	}
	return null;
}

const surfingAdapter: BrowserAdapter = {
	kind: "surfing",
	isExternal: false,
	findOpenLeaf: (app, url) => findLeafByUrl(app, SURFING_VIEW_TYPE, url),
	open: async (app, url, newLeaf) => {
		const leaf = newLeaf
			? app.workspace.getLeaf("tab")
			: app.workspace.getMostRecentLeaf() || app.workspace.getLeaf(false);
		await leaf.setViewState({
			type: SURFING_VIEW_TYPE,
			active: true,
			state: { url },
		});
		void app.workspace.revealLeaf(leaf);
	},
};

const webviewerAdapter: BrowserAdapter = {
	kind: "webviewer",
	isExternal: false,
	findOpenLeaf: (app, url) => findLeafByUrl(app, WEBVIEWER_VIEW_TYPE, url),
	open: async (app, url, newLeaf) => {
		const anyApp = app as AnyApp;
		const plugin = anyApp.internalPlugins?.getEnabledPluginById?.("webviewer") as
			| { openUrl?: (url: string, newLeaf?: boolean) => void }
			| undefined;
		if (plugin?.openUrl) {
			plugin.openUrl(url, newLeaf);
			return;
		}
		window.open(url, "_blank", "external");
	},
};

const externalAdapter: BrowserAdapter = {
	kind: "external",
	isExternal: true,
	findOpenLeaf: () => null,
	open: async (_app, url) => {
		window.open(url, "_blank", "external");
	},
};

/**
 * Detects the available browser following a cascade order:
 * 1) Surfing (community plugin with a Chromium engine and persistent session)
 * 2) Web viewer (Obsidian core plugin)
 * 3) System default browser
 */
export function detectBrowser(app: App): BrowserAdapter {
	if (isPluginEnabled(app, "surfing")) return surfingAdapter;
	if (isPluginEnabled(app, "webviewer")) return webviewerAdapter;
	return externalAdapter;
}

export function getBrowserAdapterByKind(app: App, kind: BrowserKind): BrowserAdapter {
	switch (kind) {
		case "surfing":
			return surfingAdapter;
		case "webviewer":
			return webviewerAdapter;
		default:
			return externalAdapter;
	}
}
