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
	/** For type === "url" */
	url?: string;
	/** For type === "file" (vault-relative or absolute path) */
	filePath?: string;
	/** Icon source */
	iconSource: IconSourceType;
	/** Lucide / Obsidian icon name (e.g. "file", "folder", "video") */
	lucideIcon?: string;
	/** Flat monochrome SVG adapted to Obsidian's icon convention */
	customSvg?: string;
	/** Iconify key (e.g. "simple-icons:googledrive") when the icon came from the online search */
	onlineIconKey?: string;
	/** For type === "folder": child items (nested folders are supported) */
	children?: RibbonBookmarkItem[];
}

export interface RibbonBookmarksSettings {
	items: RibbonBookmarkItem[];
	customIcons: CustomSavedIcon[];
	/** Icons obtained from the online search, kept for reuse */
	savedOnlineIcons: SavedOnlineIcon[];
	language: LangSetting;
}
