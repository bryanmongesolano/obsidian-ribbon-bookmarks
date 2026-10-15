import { LangSetting } from "./i18n";

export type BookmarkItemType = "url" | "file" | "folder" | "separator";

export type IconSourceType = "auto" | "lucide" | "custom-svg" | "online";

export interface CustomSavedIcon {
	id: string;
	label: string;
	svg: string;
}

export interface SavedOnlineIcon {
	key: string;
	svg: string;
}

export interface RibbonBookmarkItem {
	id: string;
	type: BookmarkItemType;
	title: string;
	/** Para type === "url" */
	url?: string;
	/** Para type === "file" (ruta relativa al Vault o ruta absoluta) */
	filePath?: string;
	/** Origen del ícono */
	iconSource: IconSourceType;
	/** Nombre del ícono de Lucide / Obsidian (ej. "file", "folder", "video") */
	lucideIcon?: string;
	/** SVG monocromático plano adaptado a la convención de Obsidian */
	customSvg?: string;
	/** Clave de Iconify (ej. "simple-icons:googledrive") cuando el ícono vino de la búsqueda en internet */
	onlineIconKey?: string;
	/** Para type === "folder": elementos hijos (soporta carpetas anidadas) */
	children?: RibbonBookmarkItem[];
}

export interface RibbonBookmarksSettings {
	items: RibbonBookmarkItem[];
	customIcons: CustomSavedIcon[];
	/** Íconos obtenidos de la búsqueda en internet, para reutilizarlos */
	savedOnlineIcons: SavedOnlineIcon[];
	language: LangSetting;
}
