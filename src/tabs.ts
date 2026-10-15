import { App } from "obsidian";

/**
 * Comportamiento de apertura de pestañas.
 *
 * El plugin NO impone su propia política: lee dinámicamente la configuración que el usuario
 * ya tiene en Obsidian. Si el plugin comunitario "Open Tab Settings" está instalado y activo,
 * se respeta tal cual. Si no está instalado, se deja el comportamiento nativo de Obsidian
 * (abrir en la pestaña activa, reemplazando lo que se esté viendo).
 */
export interface TabBehavior {
	/** Si true, abrir en una pestaña nueva; si false, en la pestaña activa. */
	openInNewTab: boolean;
	/** Si true, cuando ya existe una pestaña con ese archivo/URL, enfocarla en vez de duplicar. */
	deduplicateTabs: boolean;
	/** Si true, la deduplicación también aplica entre paneles divididos. */
	deduplicateAcrossTabGroups: boolean;
	/** Indica si la configuración provino de Open Tab Settings o del comportamiento nativo. */
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
