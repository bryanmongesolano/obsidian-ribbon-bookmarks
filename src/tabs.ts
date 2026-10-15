import { App } from "obsidian";

/**
 * Tab opening behavior.
 *
 * The plugin does not impose its own policy: it reads whatever the user already has
 * configured in Obsidian. When the community plugin "Open Tab Settings" is installed and
 * enabled it is respected as is. When it is not installed, Obsidian's native behavior is
 * kept (open in the active tab, replacing whatever is being shown).
 */
export interface TabBehavior {
	/** When true, open in a new tab; when false, in the active tab. */
	openInNewTab: boolean;
	/** When true, focus an existing tab for the same file or URL instead of duplicating it. */
	deduplicateTabs: boolean;
	/** When true, deduplication also applies across split panes. */
	deduplicateAcrossTabGroups: boolean;
	/** Whether the configuration came from Open Tab Settings or from native behavior. */
	source: "open-tab-settings" | "obsidian-default";
}

type AnyApp = App & {
	plugins?: {
		getPlugin?: (id: string) => unknown;
	};
};

interface OpenTabSettingsShape {
	settings?: {
		openInNewTab?: boolean;
		deduplicateTabs?: boolean;
		deduplicateAcrossTabGroups?: boolean;
	};
}

export function getTabBehavior(app: App): TabBehavior {
	const ots = (app as AnyApp).plugins?.getPlugin?.("open-tab-settings") as
		| OpenTabSettingsShape
		| undefined;

	if (ots?.settings) {
		return {
			openInNewTab: Boolean(ots.settings.openInNewTab),
			deduplicateTabs: Boolean(ots.settings.deduplicateTabs),
			deduplicateAcrossTabGroups: Boolean(ots.settings.deduplicateAcrossTabGroups),
			source: "open-tab-settings",
		};
	}

	return {
		openInNewTab: false,
		deduplicateTabs: false,
		deduplicateAcrossTabGroups: false,
		source: "obsidian-default",
	};
}
