import {
	App,
	Keymap,
	MarkdownView,
	Menu,
	MenuItem,
	Notice,
	PaneType,
	Plugin,
	PluginSettingTab,
	SettingDefinitionItem,
	TAbstractFile,
	TFile,
	TFolder,
	WorkspaceLeaf,
	getLanguage,
	setIcon,
	setTooltip,
} from "obsidian";
import { BrowserAdapter, detectBrowser } from "./browser";
import { getLucideIconForFilePath, getOrRegisterItemIconId, resolveAutoIconForUrl } from "./icons";
import { TFn, createTranslator, resolveLang } from "./i18n";
import { BookmarkItemModal } from "./modals";
import { getTabBehavior } from "./tabs";
import { CustomSavedIcon, RibbonBookmarkItem, RibbonBookmarksSettings, SavedOnlineIcon } from "./types";

const DEFAULT_SETTINGS: RibbonBookmarksSettings = {
	items: [],
	customIcons: [],
	savedOnlineIcons: [],
	language: "auto",
};

type DropZonePosition = "above" | "below" | "inside";

interface DropHitTarget {
	containerList: RibbonBookmarkItem[];
	parentFolder: RibbonBookmarkItem | null;
	targetItem: RibbonBookmarkItem;
	targetEl: HTMLElement;
	zone: DropZonePosition;
	popupLevel: number;
}

interface OpenFolderPopup {
	folder: RibbonBookmarkItem;
	level: number;
	el: HTMLElement;
	anchorEl: HTMLElement;
	rowEls: Map<string, HTMLElement>;
}

interface RibbonLike {
	containerEl?: HTMLElement;
	ribbonItemsEl?: HTMLElement;
	items?: Array<{ id: string; title: string; icon: string; hidden: boolean; buttonEl?: HTMLElement }>;
	onContextMenu?: (evt: MouseEvent) => void;
}

interface ElectronShell {
	openPath?: (path: string) => Promise<string>;
}

/**
 * Returns the Electron shell when the plugin runs inside the desktop app. The renderer
 * exposes `window.require`; on mobile it is undefined, so the caller falls back to
 * notifying the user instead of opening the file.
 */
function getElectronShell(): ElectronShell | null {
	const requireFn = (window as unknown as { require?: (moduleName: string) => unknown }).require;
	if (typeof requireFn !== "function") return null;
	try {
		const electron = requireFn("electron") as { shell?: ElectronShell } | undefined;
		return electron?.shell ?? null;
	} catch {
		return null;
	}
}

/** Menu captured from Obsidian's own ribbon context menu while it is being built. */
let pendingNativeRibbonMenu: Menu | null = null;

function rememberNativeRibbonMenu(menu: Menu): void {
	pendingNativeRibbonMenu = menu;
}

function getMenuItemTitleEl(item: unknown): HTMLElement | undefined {
	return (item as { titleEl?: HTMLElement }).titleEl;
}

export default class RibbonBookmarksPlugin extends Plugin {
	settings: RibbonBookmarksSettings = DEFAULT_SETTINGS;
	public t: TFn = createTranslator("en");

	private renderedEls: Map<string, HTMLElement> = new Map();
	private activeDraggedLeaf: WorkspaceLeaf | null = null;
	private cleanupListeners: Array<() => void> = [];
	private dropBarEl: HTMLElement | null = null;
	private highlightedDropEl: HTMLElement | null = null;
	private openPopups: OpenFolderPopup[] = [];
	private openFolderZoneBounds: { left: number; top: number; right: number; bottom: number } | null = null;
	private detachPopupWatchers: (() => void) | null = null;
	private hoverExpandTimer: number | null = null;
	private hoverExpandTargetId: string | null = null;
	private hasOpenContextMenu = false;
	private suppressClickUntil = 0;
	private bypassNextRibbonContextMenu = false;
	private pluginSettingTab: RibbonBookmarksSettingTab | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.refreshTranslator();
		this.app.workspace.onLayoutReady(() => {
			this.ensureDropBarEl();
			this.renderRibbonItems();
			this.setupRibbonContextMenuAndDragDrop();
			this.setupMobileRibbonMenuSupport();
			this.setupTabHeaderDragTracking();
		});
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (this.updatePathsOnVaultRename(this.settings.items, file, oldPath)) {
					void this.saveSettings(false).then(() => {
						this.renderRibbonItems();
					});
				}
			})
		);
		this.addCommand({
			id: "add-bookmark-item",
			name: this.t("cmdAddBookmark"),
			icon: "bookmark-plus",
			callback: () => {
				this.openAddModal();
			},
		});
		this.addCommand({
			id: "bookmark-current-tab",
			name: this.t("cmdBookmarkCurrentTab"),
			icon: "bookmark",
			callback: () => {
				void this.bookmarkActiveLeaf();
			},
		});
		this.pluginSettingTab = new RibbonBookmarksSettingTab(this.app, this);
		this.addSettingTab(this.pluginSettingTab);
	}

	onunload(): void {
		this.closeAllFolderPopups();
		this.clearRibbonElements();
		this.clearHoverExpandTimer();
		document.body.removeClass("rb-is-dragging");
		if (this.dropBarEl) {
			this.dropBarEl.remove();
			this.dropBarEl = null;
		}
		for (const fn of this.cleanupListeners) {
			try {
				fn();
			} catch {
				// Ignore
			}
		}
		this.cleanupListeners = [];
	}

	public refreshTranslator(): void {
		const lang = resolveLang(this.settings.language ?? "auto", getLanguage());
		this.t = createTranslator(lang);
	}

	private get leftRibbon(): RibbonLike | undefined {
		return (this.app.workspace as unknown as { leftRibbon?: RibbonLike }).leftRibbon;
	}

	private get browser(): BrowserAdapter {
		return detectBrowser(this.app);
	}

	async loadSettings(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<RibbonBookmarksSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
		if (!Array.isArray(this.settings.items)) this.settings.items = [];
		if (!Array.isArray(this.settings.customIcons)) this.settings.customIcons = [];
		if (!Array.isArray(this.settings.savedOnlineIcons)) this.settings.savedOnlineIcons = [];
		if (this.settings.language !== "auto" && this.settings.language !== "es" && this.settings.language !== "en") {
			this.settings.language = "auto";
		}
	}

	async saveSettings(collapseFolders = true): Promise<void> {
		if (collapseFolders) {
			this.settings.items = this.normalizeFolderTree(this.settings.items);
		}
		await this.saveData(this.settings);
		this.notifySettingsChanged();
	}

	public notifySettingsChanged(): void {
		this.pluginSettingTab?.update();
	}

	private normalizeFolderTree(list: RibbonBookmarkItem[]): RibbonBookmarkItem[] {
		const result: RibbonBookmarkItem[] = [];
		for (const item of list) {
			if (item.type === "folder") {
				const children = this.normalizeFolderTree(
					(item.children || []).filter((c) => c.type !== "separator")
				);
				if (children.length === 0) continue;
				if (children.length === 1) {
					result.push(children[0]);
					continue;
				}
				item.children = children;
			}
			result.push(item);
		}
		return result;
	}

	private async saveCustomIcon(icon: CustomSavedIcon): Promise<void> {
		this.settings.customIcons.unshift(icon);
		await this.saveData(this.settings);
	}

	private async saveOnlineIcon(icon: SavedOnlineIcon): Promise<void> {
		const idx = this.settings.savedOnlineIcons.findIndex((s) => s.key === icon.key);
		if (idx !== -1) {
			this.settings.savedOnlineIcons[idx] = icon;
		} else {
			this.settings.savedOnlineIcons.unshift(icon);
		}
		await this.saveData(this.settings);
	}

	/* ==========================================================================
	   Ribbon rendering
	   ========================================================================== */

	public getItemDisplayTitle(item: RibbonBookmarkItem): string {
		if (item.type === "separator") {
			return this.t("defaultSeparator");
		}
		return item.title || item.url || item.filePath || "•";
	}

	private clearRibbonElements(): void {
		const ribbon = this.leftRibbon;
		const items = ribbon?.items;
		for (const el of this.renderedEls.values()) {
			if (items) {
				const idx = items.findIndex((x) => x.buttonEl === el);
				if (idx !== -1) items.splice(idx, 1);
			}
			el.remove();
		}
		this.renderedEls.clear();
	}

	public renderRibbonItems(): void {
		this.clearRibbonElements();

		for (const item of this.settings.items) {
			const iconId = getOrRegisterItemIconId(item);
			const uniqueKey = `rb-item-${item.id}`;
			const displayTitle = this.getItemDisplayTitle(item);

			const el = this.addRibbonIcon(iconId, uniqueKey, (evt: MouseEvent) => {
				if (typeof evt.button === "number" && evt.button !== 0) return;
				if (this.isClickSuppressed()) return;
				if (item.type === "separator") return;
				this.handleRibbonItemClick(item, evt, el);
			});

			el.setAttribute("data-rb-id", item.id);
			el.setAttribute("data-rb-type", item.type);
			el.addClass("rb-ribbon-item");

			if (item.type === "separator") {
				el.addClass("rb-ribbon-separator");
				el.removeAttribute("aria-label");
				el.empty();
			} else {
				setTooltip(el, displayTitle, { placement: "right" });
				if (item.type === "folder") el.addClass("rb-ribbon-folder");
			}

			el.addEventListener("auxclick", (evt: MouseEvent) => {
				if (evt.button === 1 && item.type !== "separator") {
					evt.preventDefault();
					evt.stopPropagation();
					if (item.type === "folder") {
						this.closeAllFolderPopups();
						this.openFolderChildren(item);
					} else {
						void this.openBookmarkItem(item, "tab");
					}
				}
			});

			el.addEventListener("contextmenu", (evt: MouseEvent) => {
				evt.preventDefault();
				evt.stopPropagation();
				this.showItemContextMenu(item, this.settings.items, evt);
			});

			this.attachInternalPointerDrag(el, item, this.settings.items);
			this.renderedEls.set(item.id, el);
		}

		this.syncRibbonDomOrder();
		this.refreshOpenFolderPopups();
	}

	private syncRibbonDomOrder(): void {
		const ribbon = this.leftRibbon;
		const container = ribbon?.ribbonItemsEl;
		if (!container || !ribbon?.items) return;

		const ourSet = new Set<HTMLElement>();
		for (const item of this.settings.items) {
			const el = this.renderedEls.get(item.id);
			if (el) {
				container.appendChild(el);
				ourSet.add(el);
			}
		}

		const byButtonEl = new Map<HTMLElement, (typeof ribbon.items)[number]>();
		const others: typeof ribbon.items = [];
		for (let i = 0; i < ribbon.items.length; i++) {
			const entry = ribbon.items[i];
			if (entry.buttonEl && ourSet.has(entry.buttonEl)) {
				byButtonEl.set(entry.buttonEl, entry);
			} else {
				others.push(entry);
			}
		}

		const ourEntries: typeof ribbon.items = [];
		for (const item of this.settings.items) {
			const el = this.renderedEls.get(item.id);
			const found = el ? byButtonEl.get(el) : undefined;
			if (found) {
				found.title = this.getItemDisplayTitle(item);
				if (item.type === "separator") {
					found.icon = "minus";
				}
				ourEntries.push(found);
			}
		}
		ribbon.items.splice(0, ribbon.items.length, ...others, ...ourEntries);
	}

	private isClickSuppressed(): boolean {
		return Date.now() < this.suppressClickUntil;
	}

	private suppressUpcomingClick(): void {
		this.suppressClickUntil = Date.now() + 350;
	}

	private handleRibbonItemClick(item: RibbonBookmarkItem, evt: MouseEvent, anchorEl: HTMLElement): void {
		const pane = Keymap.isModEvent(evt);
		if (item.type === "folder") {
			if (pane) {
				this.closeAllFolderPopups();
				this.openFolderChildren(item);
				return;
			}
			const rect = anchorEl.getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0) {
				this.openMobileFolderMenu(item, evt);
				return;
			}
			if (this.openPopups.length > 0 && this.openPopups[0].folder.id === item.id) {
				this.closeAllFolderPopups();
			} else {
				this.openFolderPopupAtLevel(item, anchorEl, 0);
			}
			return;
		}
		this.closeAllFolderPopups();
		void this.openBookmarkItem(item, pane);
	}

	private openableChildren(folder: RibbonBookmarkItem): RibbonBookmarkItem[] {
		return (folder.children ?? []).filter((child) => child.type !== "folder" && child.type !== "separator");
	}

	private openFolderChildren(folder: RibbonBookmarkItem): void {
		for (const child of this.openableChildren(folder)) {
			void this.openBookmarkItem(child, "tab", false);
		}
	}

	/* ==========================================================================
	   Opening links and files
	   ========================================================================== */

	private async focusLeaf(leaf: WorkspaceLeaf): Promise<void> {
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	public async openBookmarkItem(
		item: RibbonBookmarkItem,
		newLeaf: PaneType | boolean = false,
		activate = true
	): Promise<void> {
		const tabCfg = getTabBehavior(this.app);
		const explicitPane = newLeaf !== false;

		if (item.type === "url" && item.url) {
			let targetUrl = item.url;
			if (targetUrl.includes("{{")) {
				const selectionRegex = /{{\s*selection\s*}}/g;
				if (selectionRegex.test(targetUrl)) {
					const activeMd = this.app.workspace.getActiveViewOfType(MarkdownView);
					const sel = activeMd?.editor?.getSelection()?.trim() || "";
					targetUrl = targetUrl.replace(selectionRegex, encodeURIComponent(sel));
				}
			}

			const browser = this.browser;

			if (!explicitPane && tabCfg.deduplicateTabs && !browser.isExternal) {
				const existing = browser.findOpenLeaf(this.app, targetUrl);
				if (existing) {
					void this.focusLeaf(existing);
					return;
				}
			}

			const target: PaneType | boolean = explicitPane ? newLeaf : tabCfg.openInNewTab ? "tab" : false;
			await browser.open(this.app, targetUrl, target, activate);
			return;
		}

		if (item.type === "file" && item.filePath) {
			const cleanPath = item.filePath.replace(/^file:\/\//i, "").trim();
			const abstractFile = this.app.vault.getAbstractFileByPath(cleanPath);

			if (abstractFile instanceof TFile) {
				if (!explicitPane && tabCfg.deduplicateTabs) {
					const existing = this.findExistingFileLeaf(abstractFile.path, tabCfg.deduplicateAcrossTabGroups);
					if (existing) {
						void this.focusLeaf(existing);
						return;
					}
				}
				const target: PaneType | boolean = explicitPane ? newLeaf : tabCfg.openInNewTab ? "tab" : false;
				await this.app.workspace.openLinkText(abstractFile.path, "", target, {
					active: activate,
				});
				return;
			}

			if (abstractFile instanceof TFolder) {
				const explorerLeaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
				if (explorerLeaf) {
					void this.app.workspace.revealLeaf(explorerLeaf);
					const view = explorerLeaf.view as unknown as { revealInFolder?: (f: TFolder) => void };
					view.revealInFolder?.(abstractFile);
				}
				return;
			}

			const shell = getElectronShell();
			if (shell?.openPath) {
				await shell.openPath(cleanPath);
				return;
			}
			new Notice(this.t("noticeFileNotFound", { path: cleanPath }));
		}
	}

	private findExistingFileLeaf(vaultFilePath: string, acrossGroups: boolean): WorkspaceLeaf | null {
		let found: WorkspaceLeaf | null = null;
		const activeParent = this.app.workspace.getMostRecentLeaf()?.parent;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (found) return;
			if (!acrossGroups && activeParent && leaf.parent !== activeParent) return;
			const viewFile = (leaf.view as unknown as { file?: TFile })?.file;
			const stateFile = (leaf.getViewState()?.state as { file?: string } | undefined)?.file;
			if ((viewFile && viewFile.path === vaultFilePath) || stateFile === vaultFilePath) {
				found = leaf;
			}
		});
		return found;
	}

	/* ==========================================================================
	   Folder popups (on-demand listeners and cached bounds)
	   ========================================================================== */

	private ensurePopupWatchersAttached(): void {
		if (this.detachPopupWatchers) return;

		const onPointerDown = (evt: MouseEvent) => {
			if (this.openPopups.length === 0 || this.hasOpenContextMenu) return;
			const target = evt.target as HTMLElement | null;
			if (!target) return;
			if (target.closest(".rb-folder-popup") || target.closest(".menu") || target.closest(".modal-container")) {
				return;
			}
			const ribbonBtn = target.closest(".rb-ribbon-folder");
			if (ribbonBtn && evt.button === 0 && ribbonBtn.getAttribute("data-rb-id") === this.openPopups[0]?.folder.id) {
				return;
			}
			this.closeAllFolderPopups();
		};

		const onPointerMove = (evt: MouseEvent) => {
			if (this.openPopups.length === 0 || this.hasOpenContextMenu) return;
			if (this.isPointerInOpenFolderZone(evt.clientX, evt.clientY)) return;
			if (document.querySelector(".modal-container")) return;
			this.closeAllFolderPopups();
		};

		const onKeyDown = (evt: KeyboardEvent) => {
			if (evt.key === "Escape" && this.openPopups.length > 0 && !this.hasOpenContextMenu) {
				this.closeAllFolderPopups();
			}
		};

		window.addEventListener("mousedown", onPointerDown, true);
		window.addEventListener("mousemove", onPointerMove, true);
		window.addEventListener("keydown", onKeyDown, true);

		this.detachPopupWatchers = () => {
			window.removeEventListener("mousedown", onPointerDown, true);
			window.removeEventListener("mousemove", onPointerMove, true);
			window.removeEventListener("keydown", onKeyDown, true);
			this.detachPopupWatchers = null;
		};
	}

	private recomputeOpenFolderZoneBounds(): void {
		if (this.openPopups.length === 0) {
			this.openFolderZoneBounds = null;
			return;
		}
		let left = Infinity;
		let top = Infinity;
		let right = -Infinity;
		let bottom = -Infinity;

		const includeRect = (r: DOMRect) => {
			if (r.left < left) left = r.left;
			if (r.top < top) top = r.top;
			if (r.right > right) right = r.right;
			if (r.bottom > bottom) bottom = r.bottom;
		};

		for (let i = 0; i < this.openPopups.length; i++) {
			const popup = this.openPopups[i];
			includeRect(popup.el.getBoundingClientRect());
			includeRect(popup.anchorEl.getBoundingClientRect());
		}
		const topEl = this.renderedEls.get(this.openPopups[0].folder.id);
		if (topEl) includeRect(topEl.getBoundingClientRect());

		const tol = 40;
		this.openFolderZoneBounds = {
			left: left - tol,
			top: top - tol,
			right: right + tol,
			bottom: bottom + tol,
		};
	}

	private isPointerInOpenFolderZone(x: number, y: number): boolean {
		const b = this.openFolderZoneBounds;
		if (!b) return false;
		return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
	}

	public closeFolderPopupsFromLevel(level: number): void {
		while (this.openPopups.length > level) {
			const popped = this.openPopups.pop();
			popped?.el.remove();
		}
		if (this.openPopups.length === 0) {
			this.openFolderZoneBounds = null;
			this.detachPopupWatchers?.();
		} else {
			this.recomputeOpenFolderZoneBounds();
		}
	}

	public closeAllFolderPopups(): void {
		this.closeFolderPopupsFromLevel(0);
		this.clearHoverExpandTimer();
	}

	private clearHoverExpandTimer(): void {
		if (this.hoverExpandTimer !== null) {
			window.clearTimeout(this.hoverExpandTimer);
			this.hoverExpandTimer = null;
		}
		this.hoverExpandTargetId = null;
	}

	private scheduleHoverFolderExpand(folder: RibbonBookmarkItem, anchorEl: HTMLElement, level: number): void {
		if (folder.type !== "folder") {
			this.clearHoverExpandTimer();
			return;
		}
		if (this.openPopups[level]?.folder.id === folder.id) return;
		if (this.hoverExpandTargetId === folder.id) return;
		this.clearHoverExpandTimer();
		this.hoverExpandTargetId = folder.id;
		this.hoverExpandTimer = window.setTimeout(() => {
			this.hoverExpandTimer = null;
			this.hoverExpandTargetId = null;
			this.openFolderPopupAtLevel(folder, anchorEl, level);
		}, 350);
	}

	private refreshOpenFolderPopups(): void {
		if (this.openPopups.length === 0) return;
		const snapshot = [...this.openPopups];
		this.closeAllFolderPopups();

		for (const entry of snapshot) {
			const stillExists = this.findItemByIdRecursive(this.settings.items, entry.folder.id);
			if (!stillExists || stillExists.type !== "folder") break;
			let anchor: HTMLElement | undefined;
			if (entry.level === 0) {
				anchor = this.renderedEls.get(stillExists.id);
			} else {
				anchor = this.openPopups[entry.level - 1]?.rowEls.get(stillExists.id);
			}
			if (!anchor) break;
			this.openFolderPopupAtLevel(stillExists, anchor, entry.level);
		}
	}

	private findItemByIdRecursive(list: RibbonBookmarkItem[], id: string): RibbonBookmarkItem | null {
		for (let i = 0; i < list.length; i++) {
			const item = list[i];
			if (item.id === id) return item;
			if (item.children) {
				const found = this.findItemByIdRecursive(item.children, id);
				if (found) return found;
			}
		}
		return null;
	}

	private openFolderPopupAtLevel(folder: RibbonBookmarkItem, anchorEl: HTMLElement, level: number): void {
		this.closeFolderPopupsFromLevel(level);
		this.ensurePopupWatchersAttached();

		const popupEl = document.body.createDiv({ cls: "menu rb-folder-popup" });
		const scrollEl = popupEl.createDiv({ cls: "menu-scroll" });
		const rowEls = new Map<string, HTMLElement>();
		const children = folder.children || [];
		folder.children = children;

		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			if (child.type === "separator") {
				scrollEl.createDiv({ cls: "menu-separator" });
				continue;
			}

			const row = scrollEl.createDiv({ cls: "menu-item tappable rb-folder-popup-item" });
			row.setAttribute("data-rb-id", child.id);

			const iconEl = row.createDiv({ cls: "menu-item-icon" });
			const iconId = getOrRegisterItemIconId(child);
			if (iconId) setIcon(iconEl, iconId);

			row.createDiv({ cls: "menu-item-title", text: child.title || child.url || child.filePath || "•" });

			if (child.type === "folder") {
				row.addClass("has-submenu");
				const chevronEl = row.createDiv({ cls: "menu-item-icon mod-submenu" });
				setIcon(chevronEl, "chevron-right");
			}

			row.addEventListener("mouseenter", () => {
				if (child.type === "folder") {
					this.openFolderPopupAtLevel(child, row, level + 1);
				} else {
					this.closeFolderPopupsFromLevel(level + 1);
				}
			});

			row.addEventListener("click", (evt: MouseEvent) => {
				if (evt.button !== 0) return;
				if (this.isClickSuppressed()) return;
				evt.preventDefault();
				evt.stopPropagation();
				if (child.type === "folder") {
					if (Keymap.isModEvent(evt)) {
						this.closeAllFolderPopups();
						this.openFolderChildren(child);
					} else if (this.openPopups[level + 1]?.folder.id === child.id) {
						this.closeFolderPopupsFromLevel(level + 1);
					} else {
						this.openFolderPopupAtLevel(child, row, level + 1);
					}
					return;
				}
				this.closeAllFolderPopups();
				void this.openBookmarkItem(child, Keymap.isModEvent(evt));
			});

			row.addEventListener("auxclick", (evt: MouseEvent) => {
				if (evt.button === 1 && child.type !== "separator") {
					evt.preventDefault();
					evt.stopPropagation();
					this.closeAllFolderPopups();
					if (child.type === "folder") {
						this.openFolderChildren(child);
					} else {
						void this.openBookmarkItem(child, "tab");
					}
				}
			});

			row.addEventListener("contextmenu", (evt: MouseEvent) => {
				evt.preventDefault();
				evt.stopPropagation();
				this.showItemContextMenu(child, children, evt);
			});

			this.attachInternalPointerDrag(row, child, children);
			rowEls.set(child.id, row);
		}

		const rect = anchorEl.getBoundingClientRect();
		popupEl.setCssStyles({
			position: "fixed",
			left: `${Math.round(rect.right + 6)}px`,
			top: `${Math.round(rect.top)}px`,
			zIndex: `${65 + level}`,
		});

		this.openPopups.push({ folder, level, el: popupEl, anchorEl, rowEls });

		const popupRect = popupEl.getBoundingClientRect();
		if (popupRect.bottom > window.innerHeight - 8) {
			popupEl.setCssStyles({
				top: `${Math.max(8, Math.round(window.innerHeight - popupRect.height - 8))}px`,
			});
		}

		this.recomputeOpenFolderZoneBounds();
	}

	/* ==========================================================================
	   Context menus
	   ========================================================================== */

	private showItemContextMenu(item: RibbonBookmarkItem, containerList: RibbonBookmarkItem[], evt: MouseEvent): void {
		const menu = new Menu();
		menu.setUseNativeMenu(false);
		this.hasOpenContextMenu = true;
		menu.onHide(() => {
			window.setTimeout(() => {
				this.hasOpenContextMenu = false;
			}, 60);
		});

		if (item.type === "folder" && this.openableChildren(item).length > 0) {
			menu.addItem((mi) =>
				mi
					.setTitle(this.t("ctxOpenAll"))
					.setIcon("files")
					.onClick(() => {
						this.closeAllFolderPopups();
						this.openFolderChildren(item);
					})
			);
			menu.addSeparator();
		}

		if (item.type === "url" || item.type === "file") {
			menu.addItem((mi) =>
				mi
					.setTitle(this.t("ctxOpenNewTab"))
					.setIcon("external-link")
					.onClick(() => {
						this.closeAllFolderPopups();
						void this.openBookmarkItem(item, "tab");
					})
			);
			if (item.type === "url" && item.url) {
				menu.addItem((mi) =>
					mi
						.setTitle(this.t("ctxOpenExternal"))
						.setIcon("globe")
						.onClick(() => {
							this.closeAllFolderPopups();
							window.open(item.url, "_blank", "external");
						})
				);
			}
			menu.addSeparator();
		}

		if (item.type !== "separator") {
			menu.addItem((mi) =>
				mi
					.setTitle(this.t("ctxModify"))
					.setIcon("pencil")
					.onClick(() => this.openEditModal(item, containerList))
			);
		}

		menu.addItem((mi) =>
			mi
				.setTitle(this.t("ctxDelete"))
				.setIcon("trash-2")
				.setWarning(true)
				.onClick(async () => {
					const idx = containerList.findIndex((x) => x.id === item.id);
					if (idx !== -1) {
						containerList.splice(idx, 1);
						await this.saveSettings();
						this.renderRibbonItems();
					}
				})
		);

		menu.showAtMouseEvent(evt);
	}

	private captureNativeRibbonMenu(evt: MouseEvent): Menu | null {
		const ribbon = this.leftRibbon;
		if (!ribbon?.containerEl || typeof ribbon.onContextMenu !== "function") return null;

		const menuProto = Menu.prototype as unknown as { showAtMouseEvent: (e: MouseEvent) => Menu };
		const origShow = menuProto.showAtMouseEvent;
		menuProto.showAtMouseEvent = function (this: Menu) {
			rememberNativeRibbonMenu(this);
			return this;
		};

		pendingNativeRibbonMenu = null;
		try {
			const proxyEvt = Object.create(evt, { target: { value: ribbon.containerEl } }) as MouseEvent;
			ribbon.onContextMenu(proxyEvt);
		} catch {
			// Ignore
		} finally {
			menuProto.showAtMouseEvent = origShow;
		}

		const captured = pendingNativeRibbonMenu;
		pendingNativeRibbonMenu = null;
		return captured;
	}

	private openMobileFolderMenu(folder: RibbonBookmarkItem, evt: MouseEvent): void {
		const menu = new Menu();
		menu.setUseNativeMenu(false);
		this.populateMobileFolderSubmenu(menu, folder);
		menu.showAtMouseEvent(evt);
	}

	private populateMobileFolderSubmenu(menu: Menu, folder: RibbonBookmarkItem): void {
		menu.setUseNativeMenu(false);
		const children = folder.children || [];

		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			if (child.type === "separator") {
				menu.addSeparator();
				continue;
			}

			menu.addItem((mi) => {
				mi.setTitle(this.getItemDisplayTitle(child)).setIcon(getOrRegisterItemIconId(child));
				if (child.type === "folder") {
					const sub = (mi as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
					if (sub) {
						this.populateMobileFolderSubmenu(sub, child);
					} else {
						mi.onClick((evt) => {
							if (evt instanceof MouseEvent) {
								this.openMobileFolderMenu(child, evt);
							}
						});
					}
					return;
				}
				mi.onClick((evt) => {
					void this.openBookmarkItem(child, Keymap.isModEvent(evt));
				});
			});
		}
	}

	private setupMobileRibbonMenuSupport(): void {
		const menuProto = Menu.prototype as unknown as {
			showAtPosition: (pos: unknown, doc?: Document) => Menu;
		};
		const origShowAtPosition = menuProto.showAtPosition;
		if (typeof origShowAtPosition !== "function") return;

		const transformMenu = (menu: Menu): void => {
			this.transformMobileRibbonMenuIfNeeded(menu);
		};

		menuProto.showAtPosition = function (this: Menu, pos: unknown, doc?: Document): Menu {
			transformMenu(this);
			origShowAtPosition.call(this, pos, doc);
			return this;
		};

		this.cleanupListeners.push(() => {
			menuProto.showAtPosition = origShowAtPosition;
		});
	}

	private transformMobileRibbonMenuIfNeeded(menu: Menu): void {
		const menuAny = menu as unknown as {
			parentEl?: HTMLElement | null;
			items?: unknown[];
			_rbTransformed?: boolean;
		};
		if (menuAny._rbTransformed) return;
		const parentEl = menuAny.parentEl;
		if (!parentEl) return;

		const mobileNavbar = (
			this.app as unknown as {
				mobileNavbar?: { ribbonMenuItemEl?: HTMLElement };
			}
		).mobileNavbar;

		const isMobileRibbonMenu =
			parentEl === mobileNavbar?.ribbonMenuItemEl || Boolean(parentEl.closest(".mobile-navbar-action-menu"));
		if (!isMobileRibbonMenu) return;

		menuAny._rbTransformed = true;

		const menuItems = menuAny.items;
		const ribbonItems = this.leftRibbon?.items;
		if (!Array.isArray(menuItems) || !Array.isArray(ribbonItems)) return;

		const visibleRibbonItems = ribbonItems.filter((entry) => !entry.hidden);
		if (menuItems.length !== visibleRibbonItems.length) return;

		const marker = ":rb-item-";
		const rebuiltItems: unknown[] = [];

		const createMenuSeparator = (): unknown => {
			menu.addSeparator();
			return menuItems.pop();
		};

		let prevKind: "other" | "ours" | null = null;
		let prevWasSeparator = false;

		for (let i = 0; i < visibleRibbonItems.length; i++) {
			const ribbonEntry = visibleRibbonItems[i];
			const origMenuItem = menuItems[i];
			const markerIdx = ribbonEntry.id.indexOf(marker);

			if (markerIdx === -1) {
				if (prevKind === "ours" && !prevWasSeparator) {
					const sep = createMenuSeparator();
					if (sep) rebuiltItems.push(sep);
				}
				rebuiltItems.push(origMenuItem);
				prevKind = "other";
				prevWasSeparator = false;
				continue;
			}

			const rbId = ribbonEntry.id.slice(markerIdx + marker.length);
			const bookmarkItem = this.findItemByIdRecursive(this.settings.items, rbId);
			if (!bookmarkItem) {
				rebuiltItems.push(origMenuItem);
				continue;
			}

			if (prevKind === "other" && !prevWasSeparator && bookmarkItem.type !== "separator") {
				const sep = createMenuSeparator();
				if (sep) rebuiltItems.push(sep);
			}

			if (bookmarkItem.type === "separator") {
				const sep = createMenuSeparator();
				if (sep) rebuiltItems.push(sep);
				prevKind = "ours";
				prevWasSeparator = true;
				continue;
			}

			const natItem = origMenuItem as MenuItem | undefined;
			if (natItem) {
				natItem.setTitle(this.getItemDisplayTitle(bookmarkItem));
				if (bookmarkItem.type === "folder") {
					const sub = (natItem as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
					if (sub) {
						this.populateMobileFolderSubmenu(sub, bookmarkItem);
					}
				}
				rebuiltItems.push(natItem);
			}
			prevKind = "ours";
			prevWasSeparator = false;
		}

		menuItems.splice(0, menuItems.length, ...rebuiltItems);
	}

	private setupRibbonContextMenuAndDragDrop(): void {
		const ribbon = this.leftRibbon;
		const container = ribbon?.containerEl;
		if (!container) return;

		const onRibbonContextMenu = (evt: MouseEvent) => {
			if (this.bypassNextRibbonContextMenu) {
				this.bypassNextRibbonContextMenu = false;
				this.closeAllFolderPopups();
				return;
			}

			const target = evt.target as HTMLElement | null;
			if (!target) return;
			if (target.closest(".rb-ribbon-item")) return;

			evt.preventDefault();
			evt.stopPropagation();
			this.closeAllFolderPopups();

			const nativeMenu = this.captureNativeRibbonMenu(evt);
			const nativeMenuItems = nativeMenu ? (nativeMenu as unknown as { items?: unknown[] }).items ?? [] : [];
			const nativeItems = nativeMenuItems.filter((item) => Boolean(getMenuItemTitleEl(item))) as MenuItem[];

			for (const natItem of nativeItems) {
				const titleEl = getMenuItemTitleEl(natItem);
				const text = titleEl?.getText?.() || "";
				if (text.startsWith("rb-item-")) {
					const found = this.findItemByIdRecursive(this.settings.items, text.slice("rb-item-".length));
					if (found) {
						natItem.setTitle(found.title || found.url || found.filePath || text);
					}
				}
			}

			const menu = new Menu();
			menu.setUseNativeMenu(false);

			menu.addItem((mi) =>
				mi
					.setTitle(this.t("ribbonAddItem"))
					.setIcon("plus")
					.onClick(() => this.openAddModal())
			);
			menu.addItem((mi) =>
				mi
					.setTitle(this.t("ribbonAddSeparator"))
					.setIcon("minus")
					.onClick(async () => {
						this.settings.items.push({
							id: crypto.randomUUID(),
							type: "separator",
							title: this.t("defaultSeparator"),
							iconSource: "auto",
						});
						await this.saveSettings();
						this.renderRibbonItems();
					})
			);

			menu.addSeparator();

			if (nativeItems.length > 0) {
				menu.addItem((mi) => {
					mi.setTitle(this.t("ribbonBarOptions")).setIcon("sliders-horizontal");
					const sub = (mi as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
					if (!sub) return;
					sub.setUseNativeMenu(false);
					const subAny = sub as unknown as {
						items: unknown[];
						sections: string[];
						scrollEl?: HTMLElement;
					};
					const natAny = nativeMenu as unknown as { sections?: string[] };
					if (Array.isArray(natAny.sections)) {
						subAny.sections = natAny.sections.slice();
					}
					for (const natItem of nativeItems) {
						(sub as unknown as { items: unknown[] }).items.push(natItem);
						(natItem as unknown as { menu?: Menu }).menu = sub;
						const dom = (natItem as unknown as { dom?: HTMLElement }).dom;
						if (dom && subAny.scrollEl && !subAny.scrollEl.contains(dom)) {
							subAny.scrollEl.appendChild(dom);
						}
					}
				});
			} else {
				menu.addItem((mi) =>
					mi
						.setTitle(this.t("ribbonBarOptions"))
						.setIcon("sliders-horizontal")
						.onClick(() => {
							this.bypassNextRibbonContextMenu = true;
							const synth = new MouseEvent("contextmenu", {
								bubbles: true,
								cancelable: true,
								button: 2,
								clientX: evt.clientX,
								clientY: evt.clientY,
							});
							container.dispatchEvent(synth);
						})
				);
			}

			menu.showAtMouseEvent(evt);
		};

		container.addEventListener("contextmenu", onRibbonContextMenu, true);
		this.cleanupListeners.push(() => container.removeEventListener("contextmenu", onRibbonContextMenu, true));

		const isPointInDropZone = (x: number, y: number): boolean => {
			const rRect = container.getBoundingClientRect();
			if (x >= rRect.left - 8 && x <= rRect.right + 8 && y >= rRect.top && y <= rRect.bottom) return true;
			for (let i = 0; i < this.openPopups.length; i++) {
				const pRect = this.openPopups[i].el.getBoundingClientRect();
				if (x >= pRect.left - 8 && x <= pRect.right + 8 && y >= pRect.top - 8 && y <= pRect.bottom + 8) {
					return true;
				}
			}
			return false;
		};

		const onGlobalDragOver = (evt: DragEvent) => {
			if (!isPointInDropZone(evt.clientX, evt.clientY)) {
				if (document.body.hasClass("rb-is-dragging")) {
					this.setDraggingMode(false);
				}
				return;
			}
			evt.preventDefault();
			evt.stopPropagation();
			if (evt.dataTransfer) evt.dataTransfer.dropEffect = "copy";
			this.setDraggingMode(true);
			this.updateDragVisualFeedback(this.findDropTargetAtPoint(evt.clientX, evt.clientY));
		};

		const onGlobalDrop = async (evt: DragEvent) => {
			if (!isPointInDropZone(evt.clientX, evt.clientY)) {
				this.setDraggingMode(false);
				return;
			}
			evt.preventDefault();
			evt.stopPropagation();

			const hit = this.findDropTargetAtPoint(evt.clientX, evt.clientY);
			this.setDraggingMode(false);

			const newItems = await this.extractDroppedBookmarkItems(evt);
			this.activeDraggedLeaf = null;
			if (newItems.length === 0) return;

			if (!hit) {
				this.settings.items.push(...newItems);
				await this.saveSettings();
				this.renderRibbonItems();
				return;
			}

			const tgtIdx = hit.containerList.findIndex((i) => i.id === hit.targetItem.id);
			if (tgtIdx === -1) {
				hit.containerList.push(...newItems);
			} else if (hit.zone === "above") {
				hit.containerList.splice(tgtIdx, 0, ...newItems);
			} else if (hit.zone === "below") {
				hit.containerList.splice(tgtIdx + 1, 0, ...newItems);
			} else if (hit.targetItem.type === "folder") {
				hit.targetItem.children = hit.targetItem.children || [];
				hit.targetItem.children.push(...newItems);
			} else {
				const created: RibbonBookmarkItem = {
					id: crypto.randomUUID(),
					type: "folder",
					title: this.t("defaultFolderName"),
					iconSource: "auto",
					lucideIcon: "folder",
					children: [hit.targetItem, ...newItems],
				};
				hit.containerList.splice(tgtIdx, 1, created);
			}

			await this.saveSettings();
			this.renderRibbonItems();
		};

		const onGlobalDropHandler = (evt: DragEvent): void => {
			void onGlobalDrop(evt);
		};
		window.addEventListener("dragover", onGlobalDragOver, true);
		window.addEventListener("drop", onGlobalDropHandler, true);
		this.cleanupListeners.push(() => {
			window.removeEventListener("dragover", onGlobalDragOver, true);
			window.removeEventListener("drop", onGlobalDropHandler, true);
		});
	}

	/* ==========================================================================
	   Internal drag and drop (reorder, group, nest)
	   ========================================================================== */

	private ensureDropBarEl(): HTMLElement {
		if (!this.dropBarEl || !document.body.contains(this.dropBarEl)) {
			this.dropBarEl = document.body.createDiv({ cls: "rb-drop-indicator-bar" });
			this.dropBarEl.hide();
		}
		return this.dropBarEl;
	}

	private showPurpleDropLine(x: number, y: number, width: number): void {
		const el = this.ensureDropBarEl();
		el.setCssStyles({
			left: `${Math.round(x)}px`,
			top: `${Math.round(y - 2)}px`,
			width: `${Math.round(width)}px`,
		});
		el.show();
	}

	private hidePurpleDropLine(): void {
		if (this.dropBarEl) this.dropBarEl.hide();
	}

	private setDraggingMode(active: boolean): void {
		if (active) {
			if (!document.body.hasClass("rb-is-dragging")) {
				document.body.addClass("rb-is-dragging");
				document.querySelectorAll(".tooltip").forEach((t) => t.remove());
			}
		} else {
			document.body.removeClass("rb-is-dragging");
			this.clearHoverExpandTimer();
			this.hidePurpleDropLine();
			this.clearDropHighlight();
		}
	}

	private clearDropHighlight(): void {
		if (this.highlightedDropEl) {
			this.highlightedDropEl.removeClass("rb-drop-inside");
			this.highlightedDropEl = null;
		}
	}

	private setDropHighlight(el: HTMLElement): void {
		if (this.highlightedDropEl === el) return;
		this.clearDropHighlight();
		el.addClass("rb-drop-inside");
		this.highlightedDropEl = el;
	}

	private computeDropLineY(targetEl: HTMLElement, side: "above" | "below"): number {
		const rect = targetEl.getBoundingClientRect();
		if (side === "above") {
			const prev = targetEl.previousElementSibling as HTMLElement | null;
			if (prev) return (prev.getBoundingClientRect().bottom + rect.top) / 2;
			return rect.top - 2;
		}
		const next = targetEl.nextElementSibling as HTMLElement | null;
		if (next) return (rect.bottom + next.getBoundingClientRect().top) / 2;
		return rect.bottom + 2;
	}

	private findDropTargetAtPoint(clientX: number, clientY: number, excludeId?: string): DropHitTarget | null {
		for (let l = this.openPopups.length - 1; l >= 0; l--) {
			const popup = this.openPopups[l];
			const pRect = popup.el.getBoundingClientRect();
			if (
				clientX >= pRect.left - 8 &&
				clientX <= pRect.right + 8 &&
				clientY >= pRect.top - 8 &&
				clientY <= pRect.bottom + 8
			) {
				const children = popup.folder.children || [];
				for (let i = 0; i < children.length; i++) {
					const child = children[i];
					if (excludeId && child.id === excludeId) continue;
					const rowEl = popup.rowEls.get(child.id);
					if (!rowEl) continue;
					const rRect = rowEl.getBoundingClientRect();
					if (clientY >= rRect.top - 4 && clientY <= rRect.bottom + 4) {
						const relY = (clientY - rRect.top) / Math.max(1, rRect.height);
						let zone: DropZonePosition;
						if (child.type === "separator") zone = relY < 0.5 ? "above" : "below";
						else if (relY < 0.28) zone = "above";
						else if (relY > 0.72) zone = "below";
						else zone = "inside";
						return {
							containerList: children,
							parentFolder: popup.folder,
							targetItem: child,
							targetEl: rowEl,
							zone,
							popupLevel: l,
						};
					}
				}
			}
		}

		for (let i = 0; i < this.settings.items.length; i++) {
			const item = this.settings.items[i];
			if (excludeId && item.id === excludeId) continue;
			const el = this.renderedEls.get(item.id);
			if (!el) continue;
			const rect = el.getBoundingClientRect();
			if (
				clientX >= rect.left - 18 &&
				clientX <= rect.right + 18 &&
				clientY >= rect.top - 5 &&
				clientY <= rect.bottom + 5
			) {
				const relY = (clientY - rect.top) / Math.max(1, rect.height);
				let zone: DropZonePosition;
				if (item.type === "separator") zone = relY < 0.5 ? "above" : "below";
				else if (relY < 0.28) zone = "above";
				else if (relY > 0.72) zone = "below";
				else zone = "inside";
				return {
					containerList: this.settings.items,
					parentFolder: null,
					targetItem: item,
					targetEl: el,
					zone,
					popupLevel: -1,
				};
			}
		}

		return null;
	}

	private updateDragVisualFeedback(hit: DropHitTarget | null, sourceItem?: RibbonBookmarkItem): void {
		if (!hit) {
			this.hidePurpleDropLine();
			this.clearDropHighlight();
			this.clearHoverExpandTimer();
			return;
		}

		const canGroup =
			hit.zone === "inside" && hit.targetItem.type !== "separator" && (!sourceItem || sourceItem.type !== "separator");

		if (canGroup) {
			this.hidePurpleDropLine();
			this.setDropHighlight(hit.targetEl);
			if (hit.targetItem.type === "folder") {
				this.scheduleHoverFolderExpand(hit.targetItem, hit.targetEl, hit.popupLevel + 1);
			} else {
				this.clearHoverExpandTimer();
			}
			return;
		}

		this.clearDropHighlight();
		this.clearHoverExpandTimer();
		const side = hit.zone === "above" ? "above" : "below";
		const lineY = this.computeDropLineY(hit.targetEl, side);
		const rect = hit.targetEl.getBoundingClientRect();
		if (hit.popupLevel >= 0) {
			this.showPurpleDropLine(rect.left + 6, lineY, rect.width - 12);
		} else {
			this.showPurpleDropLine(rect.left - 2, lineY, rect.width + 4);
		}
	}

	private attachInternalPointerDrag(
		el: HTMLElement,
		sourceItem: RibbonBookmarkItem,
		sourceContainerList: RibbonBookmarkItem[]
	): void {
		const onMouseDown = (downEvt: MouseEvent) => {
			if (downEvt.button !== 0 || Keymap.isModEvent(downEvt)) return;
			downEvt.stopImmediatePropagation();

			const startX = downEvt.clientX;
			const startY = downEvt.clientY;
			let isDragging = false;
			let ghostEl: HTMLElement | null = null;
			let lastHit: DropHitTarget | null = null;

			const onMouseMove = (moveEvt: MouseEvent) => {
				const dx = moveEvt.clientX - startX;
				const dy = moveEvt.clientY - startY;
				if (!isDragging) {
					if (dx * dx + dy * dy < 36) return;
					isDragging = true;
					this.setDraggingMode(true);
					el.addClass("rb-is-dragging-source");
					ghostEl = document.body.createDiv({ cls: "drag-ghost rb-drag-ghost" });
					ghostEl.createSpan({
						text:
							sourceItem.type === "separator"
								? this.t("defaultSeparator")
								: sourceItem.title || sourceItem.url || sourceItem.filePath || "•",
						cls: "rb-drag-ghost-label",
					});
				}

				moveEvt.preventDefault();
				if (ghostEl) {
					ghostEl.setCssStyles({
						left: `${moveEvt.clientX + 12}px`,
						top: `${moveEvt.clientY - 12}px`,
					});
				}

				lastHit = this.findDropTargetAtPoint(moveEvt.clientX, moveEvt.clientY, sourceItem.id);
				this.updateDragVisualFeedback(lastHit, sourceItem);
			};

			const onMouseUp = async (upEvt: MouseEvent) => {
				window.removeEventListener("mousemove", onMouseMove, true);
				window.removeEventListener("mouseup", onMouseUpHandler, true);
				el.removeClass("rb-is-dragging-source");
				if (ghostEl) {
					ghostEl.remove();
					ghostEl = null;
				}

				if (!isDragging) return;

				this.suppressUpcomingClick();
				this.setDraggingMode(false);
				upEvt.preventDefault();
				upEvt.stopPropagation();

				if (!lastHit || lastHit.targetItem.id === sourceItem.id) return;

				if (
					sourceItem.type === "folder" &&
					sourceItem.children &&
					(lastHit.parentFolder?.id === sourceItem.id ||
						this.findItemByIdRecursive(sourceItem.children, lastHit.targetItem.id))
				) {
					return;
				}

				await this.executeMoveOrGroup(sourceItem, sourceContainerList, lastHit);
			};

			const onMouseUpHandler = (evt: MouseEvent): void => {
				void onMouseUp(evt);
			};
			window.addEventListener("mousemove", onMouseMove, true);
			window.addEventListener("mouseup", onMouseUpHandler, true);
		};

		el.addEventListener("mousedown", onMouseDown, true);
	}

	private async executeMoveOrGroup(
		sourceItem: RibbonBookmarkItem,
		sourceContainerList: RibbonBookmarkItem[],
		hit: DropHitTarget
	): Promise<void> {
		const srcIdx = sourceContainerList.findIndex((i) => i.id === sourceItem.id);
		if (srcIdx === -1) return;
		sourceContainerList.splice(srcIdx, 1);

		const tgtIdx = hit.containerList.findIndex((i) => i.id === hit.targetItem.id);
		if (tgtIdx === -1) {
			hit.containerList.push(sourceItem);
			await this.saveSettings();
			this.renderRibbonItems();
			return;
		}

		const targetItem = hit.containerList[tgtIdx];
		const canGroup = hit.zone === "inside" && targetItem.type !== "separator" && sourceItem.type !== "separator";

		if (canGroup) {
			if (targetItem.type === "folder") {
				targetItem.children = targetItem.children || [];
				targetItem.children.push(sourceItem);
			} else {
				const newFolder: RibbonBookmarkItem = {
					id: crypto.randomUUID(),
					type: "folder",
					title: this.t("defaultFolderName"),
					iconSource: "auto",
					lucideIcon: "folder",
					children: [targetItem, sourceItem],
				};
				hit.containerList.splice(tgtIdx, 1, newFolder);
			}
		} else if (hit.zone === "above") {
			hit.containerList.splice(tgtIdx, 0, sourceItem);
		} else {
			hit.containerList.splice(tgtIdx + 1, 0, sourceItem);
		}

		await this.saveSettings();
		this.renderRibbonItems();
	}

	private setupTabHeaderDragTracking(): void {
		const workspace = this.app.workspace as unknown as {
			onDragLeaf?: (evt: DragEvent, leaf: WorkspaceLeaf) => void;
		};
		const originalOnDragLeaf = workspace.onDragLeaf;
		if (typeof originalOnDragLeaf !== "function") return;

		workspace.onDragLeaf = (evt: DragEvent, leaf: WorkspaceLeaf): void => {
			this.activeDraggedLeaf = leaf;
			const clearLeaf = (): void => {
				window.setTimeout(() => {
					this.activeDraggedLeaf = null;
					this.setDraggingMode(false);
				}, 50);
			};
			window.addEventListener("dragend", clearLeaf, { once: true, capture: true });
			window.addEventListener("drop", clearLeaf, { once: true, capture: false });
			originalOnDragLeaf.call(workspace, evt, leaf);
		};
		this.cleanupListeners.push(() => {
			workspace.onDragLeaf = originalOnDragLeaf;
		});
	}

	/* ==========================================================================
	   Extracting whatever is dropped onto the ribbon
	   ========================================================================== */

	private async extractDroppedBookmarkItems(evt: DragEvent): Promise<RibbonBookmarkItem[]> {
		const results: RibbonBookmarkItem[] = [];

		if (this.activeDraggedLeaf) {
			const leaf = this.activeDraggedLeaf;
			const viewType = leaf.view?.getViewType?.() || "";
			const viewState = leaf.getViewState();
			const viewAny = leaf.view as unknown as {
				currentUrl?: string;
				currentTitle?: string;
				file?: TFile;
				getDisplayText?: () => string;
			};

			if (viewType === "surfing-view" || viewType === "webviewer") {
				const url =
					viewAny.currentUrl ||
					(viewState.state as { url?: string } | undefined)?.url ||
					"";
				if (url) {
					const title = viewAny.currentTitle || viewAny.getDisplayText?.() || url;
					const resolved = await resolveAutoIconForUrl(url);
					results.push({
						id: crypto.randomUUID(),
						type: "url",
						title,
						url,
						iconSource: resolved.iconSource,
						customSvg: resolved.customSvg,
						lucideIcon: resolved.lucideIcon,
						onlineIconKey: resolved.onlineKey,
					});
					return results;
				}
			}

			const file =
				viewAny.file ||
				(typeof (viewState.state as { file?: string } | undefined)?.file === "string"
					? this.app.vault.getAbstractFileByPath((viewState.state as { file: string }).file)
					: null);

			if (file instanceof TFile) {
				results.push({
					id: crypto.randomUUID(),
					type: "file",
					title: file.name,
					filePath: file.path,
					iconSource: "auto",
					lucideIcon: getLucideIconForFilePath(file.path),
				});
				return results;
			}
		}

		const dragManager = (
			this.app as unknown as {
				dragManager?: {
					draggable?: {
						type?: string;
						file?: TFile | TFolder;
						files?: Array<TFile | TFolder>;
						linktext?: string;
						title?: string;
					};
				};
			}
		).dragManager;

		const draggable = dragManager?.draggable;
		if (draggable) {
			if (draggable.type === "file" && draggable.file instanceof TFile) {
				results.push({
					id: crypto.randomUUID(),
					type: "file",
					title: draggable.file.name,
					filePath: draggable.file.path,
					iconSource: "auto",
					lucideIcon: getLucideIconForFilePath(draggable.file.path),
				});
				return results;
			}
			if (draggable.type === "folder" && draggable.file instanceof TFolder) {
				const children: RibbonBookmarkItem[] = [];
				for (const child of draggable.file.children) {
					if (child instanceof TFile) {
						children.push({
							id: crypto.randomUUID(),
							type: "file",
							title: child.name,
							filePath: child.path,
							iconSource: "auto",
							lucideIcon: getLucideIconForFilePath(child.path),
						});
					}
				}
				if (children.length > 0) {
					results.push({
						id: crypto.randomUUID(),
						type: "folder",
						title: draggable.file.name,
						iconSource: "auto",
						lucideIcon: "folder",
						children,
					});
				}
				return results;
			}
			if (draggable.type === "files" && Array.isArray(draggable.files)) {
				for (const f of draggable.files) {
					if (f instanceof TFile) {
						results.push({
							id: crypto.randomUUID(),
							type: "file",
							title: f.name,
							filePath: f.path,
							iconSource: "auto",
							lucideIcon: getLucideIconForFilePath(f.path),
						});
					}
				}
				if (results.length > 0) return results;
			}
			if (draggable.type === "link" && draggable.linktext) {
				if (/^https?:\/\//i.test(draggable.linktext)) {
					const resolved = await resolveAutoIconForUrl(draggable.linktext);
					results.push({
						id: crypto.randomUUID(),
						type: "url",
						title: draggable.title || draggable.linktext,
						url: draggable.linktext,
						iconSource: resolved.iconSource,
						customSvg: resolved.customSvg,
						lucideIcon: resolved.lucideIcon,
						onlineIconKey: resolved.onlineKey,
					});
					return results;
				}
				if (draggable.file instanceof TFile) {
					results.push({
						id: crypto.randomUUID(),
						type: "file",
						title: draggable.file.name,
						filePath: draggable.file.path,
						iconSource: "auto",
						lucideIcon: getLucideIconForFilePath(draggable.file.path),
					});
					return results;
				}
			}
		}

		const dt = evt.dataTransfer;
		if (!dt) return results;

		if (dt.files && dt.files.length > 0) {
			const vaultBase = (this.app.vault.adapter as unknown as { getBasePath?: () => string }).getBasePath?.();
			for (const file of Array.from(dt.files)) {
				const rawPath = (file as unknown as { path?: string }).path || file.name;
				let finalPath = rawPath;
				if (vaultBase && rawPath.startsWith(vaultBase)) {
					finalPath = rawPath.slice(vaultBase.length).replace(/^\/+/, "");
				}
				results.push({
					id: crypto.randomUUID(),
					type: "file",
					title: file.name,
					filePath: finalPath,
					iconSource: "auto",
					lucideIcon: getLucideIconForFilePath(finalPath),
				});
			}
			if (results.length > 0) return results;
		}

		const uriList = dt.getData("text/uri-list")?.trim();
		const plainText = dt.getData("text/plain")?.trim();
		const htmlText = dt.getData("text/html")?.trim();

		let candidateUrl = "";
		let candidateTitle = "";

		if (htmlText) {
			try {
				const doc = new DOMParser().parseFromString(htmlText, "text/html");
				const a = doc.querySelector("a[href]");
				if (a) {
					candidateUrl = a.getAttribute("href") || "";
					candidateTitle = (a.textContent || "").trim();
				}
			} catch {
				// Ignore
			}
		}

		if (!candidateUrl && uriList) {
			const firstLine = uriList.split(/\r?\n/).find((l) => l && !l.startsWith("#"));
			if (firstLine) candidateUrl = firstLine.trim();
		}
		if (!candidateUrl && plainText) candidateUrl = plainText;

		if (!candidateUrl) return results;

		if (candidateUrl.startsWith("obsidian://open")) {
			try {
				const u = new URL(candidateUrl);
				const fileParam = u.searchParams.get("file");
				if (fileParam) {
					const decoded = decodeURIComponent(fileParam);
					const af =
						this.app.vault.getAbstractFileByPath(decoded) ||
						this.app.metadataCache.getFirstLinkpathDest(decoded, "");
					if (af instanceof TFile) {
						results.push({
							id: crypto.randomUUID(),
							type: "file",
							title: af.name,
							filePath: af.path,
							iconSource: "auto",
							lucideIcon: getLucideIconForFilePath(af.path),
						});
						return results;
					}
				}
			} catch {
				// Ignore
			}
		}

		if (/^https?:\/\//i.test(candidateUrl)) {
			const resolved = await resolveAutoIconForUrl(candidateUrl);
			if (!candidateTitle) {
				try {
					candidateTitle = new URL(candidateUrl).hostname.replace(/^www\./, "");
				} catch {
					candidateTitle = candidateUrl;
				}
			}
			results.push({
				id: crypto.randomUUID(),
				type: "url",
				title: candidateTitle,
				url: candidateUrl,
				iconSource: resolved.iconSource,
				customSvg: resolved.customSvg,
				lucideIcon: resolved.lucideIcon,
				onlineIconKey: resolved.onlineKey,
			});
		}

		return results;
	}

	private updatePathsOnVaultRename(
		list: RibbonBookmarkItem[],
		file: TAbstractFile,
		oldPath: string
	): boolean {
		let changed = false;
		const oldName = oldPath.split("/").pop() || oldPath;
		for (const item of list) {
			if (item.type === "folder" && item.children) {
				if (this.updatePathsOnVaultRename(item.children, file, oldPath)) {
					changed = true;
				}
			} else if (item.type === "file" && item.filePath) {
				if (item.filePath === oldPath) {
					if (!item.title || item.title === oldName || item.title === oldPath) {
						item.title = file.name;
					}
					item.filePath = file.path;
					if (item.iconSource === "auto") {
						item.lucideIcon = getLucideIconForFilePath(file.path);
					}
					changed = true;
				} else if (item.filePath.startsWith(oldPath + "/")) {
					item.filePath = file.path + item.filePath.slice(oldPath.length);
					changed = true;
				}
			}
		}
		return changed;
	}

	private async bookmarkActiveLeaf(): Promise<void> {
		const leaf = this.app.workspace.getMostRecentLeaf();
		if (!leaf) {
			this.openAddModal();
			return;
		}
		const viewType = leaf.view?.getViewType?.() || "";
		const viewState = leaf.getViewState();
		const viewAny = leaf.view as unknown as {
			currentUrl?: string;
			currentTitle?: string;
			file?: TFile;
			getDisplayText?: () => string;
		};

		if (viewType === "surfing-view" || viewType === "webviewer") {
			const url =
				viewAny.currentUrl ||
				(viewState.state as { url?: string } | undefined)?.url ||
				"";
			if (url) {
				const title = viewAny.currentTitle || viewAny.getDisplayText?.() || url;
				const resolved = await resolveAutoIconForUrl(url);
				this.settings.items.push({
					id: crypto.randomUUID(),
					type: "url",
					title,
					url,
					iconSource: resolved.iconSource,
					customSvg: resolved.customSvg,
					lucideIcon: resolved.lucideIcon,
					onlineIconKey: resolved.onlineKey,
				});
				await this.saveSettings(false);
				this.renderRibbonItems();
				new Notice(this.t("noticeBookmarkAdded", { title }));
				return;
			}
		}

		const file =
			viewAny.file ||
			(typeof (viewState.state as { file?: string } | undefined)?.file === "string"
				? this.app.vault.getAbstractFileByPath((viewState.state as { file: string }).file)
				: null);

		if (file instanceof TFile) {
			this.settings.items.push({
				id: crypto.randomUUID(),
				type: "file",
				title: file.name,
				filePath: file.path,
				iconSource: "auto",
				lucideIcon: getLucideIconForFilePath(file.path),
			});
			await this.saveSettings(false);
			this.renderRibbonItems();
			new Notice(this.t("noticeBookmarkAdded", { title: file.name }));
			return;
		}

		this.openAddModal();
	}

	private buildFolderOptions(excludeFolderId?: string): Array<{ id: string; label: string }> {
		const opts: Array<{ id: string; label: string }> = [
			{ id: "", label: this.t("locationRoot") },
		];
		const walk = (list: RibbonBookmarkItem[], depth: number) => {
			for (const item of list) {
				if (item.type === "folder") {
					if (excludeFolderId && item.id === excludeFolderId) continue;
					const prefix = depth > 0 ? "\u00A0".repeat(depth * 4) + "↳ " : "";
					opts.push({
						id: item.id,
						label: prefix + this.getItemDisplayTitle(item),
					});
					if (item.children && item.children.length > 0) {
						walk(item.children, depth + 1);
					}
				}
			}
		};
		walk(this.settings.items, 0);
		return opts;
	}

	private findFolderIdForContainerList(targetList: RibbonBookmarkItem[]): string {
		if (targetList === this.settings.items) return "";
		const walk = (list: RibbonBookmarkItem[]): string | null => {
			for (const item of list) {
				if (item.type === "folder") {
					if (item.children === targetList) return item.id;
					if (item.children) {
						const found = walk(item.children);
						if (found !== null) return found;
					}
				}
			}
			return null;
		};
		return walk(this.settings.items) ?? "";
	}

	private getContainerListByFolderId(folderId: string): RibbonBookmarkItem[] {
		if (!folderId) return this.settings.items;
		const folder = this.findItemByIdRecursive(this.settings.items, folderId);
		if (folder && folder.type === "folder") {
			folder.children = folder.children || [];
			return folder.children;
		}
		return this.settings.items;
	}

	/* ==========================================================================
	   Modals
	   ========================================================================== */

	public openAddModal(insertIndex?: number, containerList: RibbonBookmarkItem[] = this.settings.items): void {
		const initialFolderId = this.findFolderIdForContainerList(containerList);
		new BookmarkItemModal({
			app: this.app,
			isNew: true,
			t: this.t,
			customIcons: this.settings.customIcons,
			savedOnlineIcons: this.settings.savedOnlineIcons,
			folderOptions: this.buildFolderOptions(),
			initialFolderId,
			onSaveCustomIcon: (ic) => this.saveCustomIcon(ic),
			onSaveOnlineIcon: (ic) => this.saveOnlineIcon(ic),
			onSubmit: async (created, targetFolderId) => {
				if (targetFolderId !== undefined && targetFolderId !== initialFolderId) {
					const destList = this.getContainerListByFolderId(targetFolderId);
					destList.push(created);
				} else if (
					typeof insertIndex === "number" &&
					insertIndex >= 0 &&
					insertIndex <= containerList.length
				) {
					containerList.splice(insertIndex, 0, created);
				} else {
					containerList.push(created);
				}
				await this.saveSettings(false);
				this.renderRibbonItems();
			},
		}).open();
	}

	public openAddFolderModal(containerList: RibbonBookmarkItem[] = this.settings.items): void {
		const initialFolderId = this.findFolderIdForContainerList(containerList);
		const initialFolder: RibbonBookmarkItem = {
			id: crypto.randomUUID(),
			type: "folder",
			title: "",
			iconSource: "auto",
			lucideIcon: "folder",
			children: [],
		};
		new BookmarkItemModal({
			app: this.app,
			item: initialFolder,
			isNew: true,
			t: this.t,
			customIcons: this.settings.customIcons,
			savedOnlineIcons: this.settings.savedOnlineIcons,
			folderOptions: this.buildFolderOptions(),
			initialFolderId,
			onSaveCustomIcon: (ic) => this.saveCustomIcon(ic),
			onSaveOnlineIcon: (ic) => this.saveOnlineIcon(ic),
			onSubmit: async (created, targetFolderId) => {
				created.children = created.children || [];
				const destList =
					targetFolderId !== undefined && targetFolderId !== initialFolderId
						? this.getContainerListByFolderId(targetFolderId)
						: containerList;
				destList.push(created);
				await this.saveSettings(false);
				this.renderRibbonItems();
			},
		}).open();
	}

	public openEditModal(item: RibbonBookmarkItem, containerList: RibbonBookmarkItem[]): void {
		const initialFolderId = this.findFolderIdForContainerList(containerList);
		new BookmarkItemModal({
			app: this.app,
			item,
			isNew: false,
			t: this.t,
			customIcons: this.settings.customIcons,
			savedOnlineIcons: this.settings.savedOnlineIcons,
			folderOptions: this.buildFolderOptions(item.type === "folder" ? item.id : undefined),
			initialFolderId,
			onSaveCustomIcon: (ic) => this.saveCustomIcon(ic),
			onSaveOnlineIcon: (ic) => this.saveOnlineIcon(ic),
			onSubmit: async (updated, targetFolderId) => {
				const idx = containerList.findIndex((x) => x.id === item.id);
				if (targetFolderId !== undefined && targetFolderId !== initialFolderId) {
					if (idx !== -1) {
						containerList.splice(idx, 1);
					}
					const destList = this.getContainerListByFolderId(targetFolderId);
					destList.push(updated);
					await this.saveSettings(false);
					this.renderRibbonItems();
				} else if (idx !== -1) {
					containerList[idx] = updated;
					await this.saveSettings(false);
					this.renderRibbonItems();
				}
			},
			onDelete: async () => {
				const idx = containerList.findIndex((x) => x.id === item.id);
				if (idx !== -1) {
					containerList.splice(idx, 1);
					await this.saveSettings(false);
					this.renderRibbonItems();
				}
			},
		}).open();
	}
}

/** Settings use Obsidian's declarative API so they also show up in the settings search. */
class RibbonBookmarksSettingTab extends PluginSettingTab {
	plugin: RibbonBookmarksPlugin;
	icon = "bookmark";

	constructor(app: App, plugin: RibbonBookmarksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private attachAddSelectButton(
		extraBtnEl: HTMLElement,
		getContainerList: () => RibbonBookmarkItem[],
		allowSeparator: boolean
	): void {
		extraBtnEl.addClass("rb-settings-add-btn");
		extraBtnEl.querySelectorAll("select.rb-native-add-select").forEach((el) => el.remove());

		const selectEl = extraBtnEl.createEl("select", {
			cls: "rb-native-add-select",
			attr: { "aria-label": this.plugin.t("ribbonAddItem") },
		});

		const buildOptions = () => {
			const t = this.plugin.t;
			selectEl.setAttr("aria-label", t("ribbonAddItem"));
			selectEl.empty();
			const placeholder = selectEl.createEl("option", {
				text: "",
				value: "",
			});
			placeholder.disabled = true;
			placeholder.selected = true;
			placeholder.hidden = true;

			selectEl.createEl("option", {
				text: t("ribbonAddItem"),
				value: "item",
			});
			selectEl.createEl("option", {
				text: t("settingsAddFolder"),
				value: "folder",
			});
			if (allowSeparator) {
				selectEl.createEl("option", {
					text: t("ribbonAddSeparator"),
					value: "separator",
				});
			}
			selectEl.value = "";
		};

		buildOptions();

		selectEl.addEventListener("mousedown", () => {
			buildOptions();
		});
		selectEl.addEventListener(
			"touchstart",
			() => {
				buildOptions();
			},
			{ passive: true }
		);

		selectEl.addEventListener("change", () => {
			const val = selectEl.value;
			selectEl.value = "";
			const containerList = getContainerList();
			const t = this.plugin.t;
			if (val === "item") {
				this.plugin.openAddModal(undefined, containerList);
			} else if (val === "folder") {
				this.plugin.openAddFolderModal(containerList);
			} else if (val === "separator") {
				containerList.push({
					id: crypto.randomUUID(),
					type: "separator",
					title: t("defaultSeparator"),
					iconSource: "auto",
				});
				void this.plugin.saveSettings(false).then(() => {
					this.plugin.renderRibbonItems();
					this.update();
				});
			}
		});
	}

	private buildBookmarkListDef(
		getContainerList: () => RibbonBookmarkItem[],
		options: { heading: string; emptyState: string; allowSeparator: boolean }
	): SettingDefinitionItem {
		const containerList = getContainerList();
		return {
			type: "list",
			cls: "rb-bookmarks-list",
			heading: options.heading,
			emptyState: options.emptyState,
			extraButtons: [
				(btn) => {
					btn.setIcon("plus").setTooltip(this.plugin.t("ribbonAddItem"));
					this.attachAddSelectButton(
						btn.extraSettingsEl,
						getContainerList,
						options.allowSeparator
					);
				},
			],
			onReorder: (oldIndex, newIndex) => {
				const list = getContainerList();
				if (oldIndex < 0 || oldIndex >= list.length) return;
				if (newIndex < 0 || newIndex >= list.length) return;
				const [moved] = list.splice(oldIndex, 1);
				if (!moved) return;
				list.splice(newIndex, 0, moved);
				void this.plugin.saveSettings(false).then(() => {
					this.plugin.renderRibbonItems();
					this.update();
				});
			},
			onDelete: (index) => {
				const list = getContainerList();
				if (index < 0 || index >= list.length) return;
				list.splice(index, 1);
				void this.plugin.saveSettings(false).then(() => {
					this.plugin.renderRibbonItems();
					this.update();
				});
			},
			items: containerList.map((item) => this.buildBookmarkRowDef(item, containerList)),
		};
	}

	private buildBookmarkRowDef(
		item: RibbonBookmarkItem,
		containerList: RibbonBookmarkItem[]
	): NonNullable<Extract<SettingDefinitionItem, { type: "list" }>["items"]>[number] {
		const t = this.plugin.t;
		const title = this.plugin.getItemDisplayTitle(item);
		const iconId = item.type === "separator" ? "minus" : getOrRegisterItemIconId(item);

		if (item.type === "folder") {
			item.children = item.children || [];
			const count = item.children.length;
			const countLabel =
				count === 1 ? t("settingsItemCountOne") : t("settingsItemCountMany", { count });
			const rowDef: NonNullable<Extract<SettingDefinitionItem, { type: "list" }>["items"]>[number] & {
				id?: string;
				icon?: string;
			} = {
				id: item.id,
				type: "page",
				name: title,
				icon: iconId,
				displayValue: countLabel,
				searchable: false,
				items: [
					{
						name: t("ctxModify"),
						desc: title,
						searchable: false,
						render: (setting) => {
							(setting as unknown as { setIcon?: (ic: string) => void }).setIcon?.(iconId);
							setting.addButton((btn) =>
								btn
									.setIcon("pencil")
									.setButtonText(t("ctxModify"))
									.onClick(() => this.plugin.openEditModal(item, containerList))
							);
						},
					},
					this.buildBookmarkListDef(
						() => {
							item.children = item.children || [];
							return item.children;
						},
						{
							heading: t("settingsBookmarksHeading"),
							emptyState: t("settingsEmptyFolder"),
							allowSeparator: false,
						}
					),
				],
			};
			return rowDef;
		}

		if (item.type === "separator") {
			const sepDef: NonNullable<Extract<SettingDefinitionItem, { type: "list" }>["items"]>[number] & {
				id?: string;
				icon?: string;
			} = {
				id: item.id,
				name: title,
				icon: iconId,
				searchable: false,
			};
			return sepDef;
		}

		const rowDef: NonNullable<Extract<SettingDefinitionItem, { type: "list" }>["items"]>[number] & {
			id?: string;
			icon?: string;
		} = {
			id: item.id,
			name: title,
			icon: iconId,
			searchable: false,
			action: () => {
				this.plugin.openEditModal(item, containerList);
			},
		};
		return rowDef;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const t = this.plugin.t;
		return [
			{
				name: t("settingsLanguage"),
				desc: t("settingsLanguageDesc"),
				control: {
					type: "dropdown",
					key: "language",
					defaultValue: "auto",
					options: {
						auto: t("settingsLangAuto"),
						es: t("langEs"),
						en: t("langEn"),
					},
				},
			},
			this.buildBookmarkListDef(() => this.plugin.settings.items, {
				heading: t("settingsBookmarksHeading"),
				emptyState: t("settingsEmptyBookmarks"),
				allowSeparator: true,
			}),
		];
	}

	getControlValue(key: string): unknown {
		if (key === "language") return this.plugin.settings.language;
		return undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key !== "language") return;
		if (value !== "auto" && value !== "es" && value !== "en") return;
		this.plugin.settings.language = value;
		await this.plugin.saveSettings(false);
		this.plugin.refreshTranslator();
		this.plugin.renderRibbonItems();
		this.update();
	}
}
