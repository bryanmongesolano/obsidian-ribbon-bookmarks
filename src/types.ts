import { LangSetting } from "./i18n";

export type BookmarkItemType = "url" | "file" | "folder" | "separator";

export type IconSourceType = "auto" | "lucide" | "custom-svg";

export interface CustomSavedIcon {
	id: string;
	label: string;
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
	/** Para type === "folder": elementos hijos (soporta carpetas anidadas) */
	children?: RibbonBookmarkItem[];
}

export interface RibbonBookmarksSettings {
	items: RibbonBookmarkItem[];
	customIcons: CustomSavedIcon[];
	language: LangSetting;
}
