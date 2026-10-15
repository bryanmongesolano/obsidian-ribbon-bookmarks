import {
	App,
	MarkdownView,
	Menu,
	MenuItem,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
	WorkspaceLeaf,
	getLanguage,
	setIcon,
	setTooltip,
} from "obsidian";
import { BrowserAdapter, detectBrowser, normalizeUrl } from "./browser";
import { getLucideIconForFilePath, getOrRegisterItemIconId, resolveAutoIconForUrl } from "./icons";
import { TFn, LangSetting, createTranslator, resolveLang } from "./i18n";
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

export default class RibbonBookmarksPlugin extends Plugin {
	settings: RibbonBookmarksSettings = DEFAULT_SETTINGS;
	public t: TFn = createTranslator("en");

	private renderedEls: Map<string, HTMLElement> = new Map();
	private activeDraggedLeaf: WorkspaceLeaf | null = null;
	private cleanupListeners: Array<() => void> = [];
	private dropBarEl: HTMLElement | null = null;
	private openPopups: OpenFolderPopup[] = [];
	private hoverExpandTimer: number | null = null;
	private hoverExpandTargetId: string | null = null;
	private hasOpenContextMenu = false;
	private suppressClickUntil = 0;
	private bypassNextRibbonContextMenu = false;
	private recordKeyUsed: string[] = [];

	async onload(): Promise<void> {
		await this.loadSettings();
		this.refreshTranslator();
		this.app.workspace.onLayoutReady(() => {
			this.ensureDropBarEl();
			this.renderRibbonItems();
			this.setupRibbonContextMenuAndDragDrop();
			this.setupTabHeaderDragTracking();
			this.setupGlobalPointerWatchers();
		});
		this.addSettingTab(new RibbonBookmarksSettingTab(this.app, this));
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
				// Ignorar
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
		const loaded = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		if (!Array.isArray(this.settings.items)) this.settings.items = [];
		if (!Array.isArray(this.settings.customIcons)) this.settings.customIcons = [];
		if (!Array.isArray(this.settings.savedOnlineIcons)) this.settings.savedOnlineIcons = [];
		if (this.settings.language !== "auto" && this.settings.language !== "es" && this.settings.language !== "en") {
			this.settings.language = "auto";
		}
	}

	async saveSettings(): Promise<void> {
		this.settings.items = this.normalizeFolderTree(this.settings.items);
		await this.saveData(this.settings);
	}

	/**
	 * Normaliza recursivamente las carpetas:
	 * - Carpeta con 0 elementos -> se elimina sola.
	 * - Carpeta con 1 solo elemento -> se deshace y el elemento sube a su posición.
	 */
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

	/** Guarda un ícono obtenido de la búsqueda en internet para poder reutilizarlo. */
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
	   Render del Ribbon
	   ========================================================================== */

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
			this.recordKeyUsed.push(uniqueKey);

			const el = this.addRibbonIcon(iconId, uniqueKey, (evt: MouseEvent) => {
				if (evt.button !== 0 || evt.ctrlKey) return;
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
				setTooltip(el, item.title || item.url || item.filePath || "•", { placement: "right" });
				if (item.type === "folder") el.addClass("rb-ribbon-folder");
			}

			el.addEventListener("auxclick", (evt: MouseEvent) => {
				if (evt.button === 1 && item.type !== "separator" && item.type !== "folder") {
					evt.preventDefault();
					evt.stopPropagation();
					this.openBookmarkItem(item, true);
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

		for (const item of this.settings.items) {
			const el = this.renderedEls.get(item.id);
			if (el) container.appendChild(el);
		}

		const ours = this.settings.items
			.map((i) => this.renderedEls.get(i.id))
			.filter((el): el is HTMLElement => Boolean(el));
		const others = ribbon.items.filter((x) => !x.buttonEl || !ours.includes(x.buttonEl));
		const ourEntries = ours
			.map((el) => ribbon.items!.find((x) => x.buttonEl === el))
			.filter((x): x is NonNullable<typeof x> => Boolean(x));
		ribbon.items.splice(0, ribbon.items.length, ...others, ...ourEntries);
	}

	private isClickSuppressed(): boolean {
		return Date.now() < this.suppressClickUntil;
	}

	private suppressUpcomingClick(): void {
		this.suppressClickUntil = Date.now() + 350;
	}

	private handleRibbonItemClick(item: RibbonBookmarkItem, evt: MouseEvent, anchorEl: HTMLElement): void {
		if (item.type === "folder") {
			if (this.openPopups.length > 0 && this.openPopups[0].folder.id === item.id) {
				this.closeAllFolderPopups();
			} else {
				this.openFolderPopupAtLevel(item, anchorEl, 0);
			}
			return;
		}
		this.closeAllFolderPopups();
		this.openBookmarkItem(item, evt.metaKey);
	}

	/* ==========================================================================
	   Apertura de enlaces y archivos
	   ========================================================================== */

	private focusLeaf(leaf: WorkspaceLeaf): void {
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		this.app.workspace.revealLeaf(leaf);
	}

	public async openBookmarkItem(item: RibbonBookmarkItem, forceNewTab = false): Promise<void> {
		const tabCfg = getTabBehavior(this.app);

		if (item.type === "url" && item.url) {
			let targetUrl = item.url;
			const selectionRegex = /{{\s*selection\s*}}/g;
			if (selectionRegex.test(targetUrl)) {
				const activeMd = this.app.workspace.getActiveViewOfType(MarkdownView);
				const sel = activeMd?.editor?.getSelection()?.trim() || "";
				targetUrl = targetUrl.replace(selectionRegex, encodeURIComponent(sel));
			}

			const browser = this.browser;

			if (!forceNewTab && tabCfg.deduplicateTabs && !browser.isExternal) {
				const existing = browser.findOpenLeaf(this.app, targetUrl);
				if (existing) {
					this.focusLeaf(existing);
					return;
				}
			}

			const openInNew = forceNewTab || tabCfg.openInNewTab;
			await browser.open(this.app, targetUrl, openInNew);
			return;
		}

		if (item.type === "file" && item.filePath) {
			const cleanPath = item.filePath.replace(/^file:\/\//i, "").trim();
			const abstractFile = this.app.vault.getAbstractFileByPath(cleanPath);

			if (abstractFile instanceof TFile) {
				if (!forceNewTab && tabCfg.deduplicateTabs) {
					const existing = this.findExistingFileLeaf(abstractFile.path, tabCfg.deduplicateAcrossTabGroups);
					if (existing) {
						this.focusLeaf(existing);
						return;
					}
				}
				const openInNew = forceNewTab || tabCfg.openInNewTab;
				await this.app.workspace.openLinkText(abstractFile.path, "", openInNew ? "tab" : false, {
					active: true,
				});
				return;
			}

			if (abstractFile instanceof TFolder) {
				const explorerLeaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
				if (explorerLeaf) {
					this.app.workspace.revealLeaf(explorerLeaf);
					const view = explorerLeaf.view as unknown as { revealInFolder?: (f: TFolder) => void };
					view.revealInFolder?.(abstractFile);
				}
				return;
			}

			try {
				// eslint-disable-next-line @typescript-eslint/no-var-requires
				const electron = require("electron");
				if (electron?.shell?.openPath) {
					await electron.shell.openPath(cleanPath);
					return;
				}
			} catch {
				// Ignorar
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
	   Popups de carpetas (soporta anidación, toggle, cascada y zona de hover)
	   ========================================================================== */

	private setupGlobalPointerWatchers(): void {
		const onPointerDown = (evt: MouseEvent) => {
			if (this.openPopups.length === 0) return;
			if (this.hasOpenContextMenu) return;
			const target = evt.target as HTMLElement | null;
			if (!target) return;
			if (target.closest(".rb-folder-popup")) return;
			if (target.closest(".menu")) return;
			if (target.closest(".modal-container")) return;
			const ribbonBtn = target.closest(".rb-ribbon-folder") as HTMLElement | null;
			if (ribbonBtn && evt.button === 0 && ribbonBtn.getAttribute("data-rb-id") === this.openPopups[0]?.folder.id) {
				return;
			}
			this.closeAllFolderPopups();
		};

		const onPointerMove = (evt: MouseEvent) => {
			if (this.openPopups.length === 0) return;
			if (this.hasOpenContextMenu) return;
			if (document.querySelector(".modal-container")) return;
			if (this.isPointerInOpenFolderZone(evt.clientX, evt.clientY)) return;
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
		this.cleanupListeners.push(() => {
			window.removeEventListener("mousedown", onPointerDown, true);
			window.removeEventListener("mousemove", onPointerMove, true);
			window.removeEventListener("keydown", onKeyDown, true);
		});
	}

	/**
	 * Verdadero si el puntero está sobre la carpeta abierta, sobre su contenido o sobre el
	 * espacio intermedio entre ambos (con ~40px de tolerancia). Así la carpeta no se cierra
	 * mientras el usuario intenta seleccionar o arrastrar algo hacia dentro.
	 */
	private isPointerInOpenFolderZone(x: number, y: number): boolean {
		if (this.openPopups.length === 0) return false;

		const rects: DOMRect[] = [];
		for (const popup of this.openPopups) {
			rects.push(popup.el.getBoundingClientRect());
			rects.push(popup.anchorEl.getBoundingClientRect());
		}
		const topLevel = this.openPopups[0];
		const topEl = this.renderedEls.get(topLevel.folder.id);
		if (topEl) rects.push(topEl.getBoundingClientRect());

		let left = Infinity;
		let top = Infinity;
		let right = -Infinity;
		let bottom = -Infinity;
		for (const r of rects) {
			left = Math.min(left, r.left);
			top = Math.min(top, r.top);
			right = Math.max(right, r.right);
			bottom = Math.max(bottom, r.bottom);
		}

		const tol = 40;
		return x >= left - tol && x <= right + tol && y >= top - tol && y <= bottom + tol;
	}

	public closeFolderPopupsFromLevel(level: number): void {
		while (this.openPopups.length > level) {
			const popped = this.openPopups.pop();
			popped?.el.remove();
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
		for (const item of list) {
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

		const popupEl = document.body.createDiv({ cls: "menu rb-folder-popup" });
		const scrollEl = popupEl.createDiv({ cls: "menu-scroll" });
		const rowEls = new Map<string, HTMLElement>();
		const children = folder.children || [];
		folder.children = children;

		for (const child of children) {
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
				if (evt.button !== 0 || evt.ctrlKey) return;
				if (this.isClickSuppressed()) return;
				evt.preventDefault();
				evt.stopPropagation();
				if (child.type === "folder") {
					if (this.openPopups[level + 1]?.folder.id === child.id) {
						this.closeFolderPopupsFromLevel(level + 1);
					} else {
						this.openFolderPopupAtLevel(child, row, level + 1);
					}
					return;
				}
				this.closeAllFolderPopups();
				this.openBookmarkItem(child, evt.metaKey);
			});

			row.addEventListener("auxclick", (evt: MouseEvent) => {
				if (evt.button === 1 && child.type !== "folder") {
					evt.preventDefault();
					evt.stopPropagation();
					this.closeAllFolderPopups();
					this.openBookmarkItem(child, true);
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
		popupEl.style.position = "fixed";
		popupEl.style.left = `${Math.round(rect.right + 6)}px`;
		popupEl.style.top = `${Math.round(rect.top)}px`;
		popupEl.style.zIndex = `${65 + level}`;

		this.openPopups.push({ folder, level, el: popupEl, anchorEl, rowEls });

		const popupRect = popupEl.getBoundingClientRect();
		if (popupRect.bottom > window.innerHeight - 8) {
			popupEl.style.top = `${Math.max(8, Math.round(window.innerHeight - popupRect.height - 8))}px`;
		}
	}

	/* ==========================================================================
	   Menús contextuales
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

		if (item.type === "url" || item.type === "file") {
			menu.addItem((mi) =>
				mi
					.setTitle(this.t("ctxOpenNewTab"))
					.setIcon("external-link")
					.onClick(() => {
						this.closeAllFolderPopups();
						this.openBookmarkItem(item, true);
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

	/**
	 * Captura el menú que genera el componente nativo del Ribbon (leftRibbon.onContextMenu)
	 * sin hardcodear ninguno de sus elementos, para insertarlos en un submenú desplegable.
	 */
	private captureNativeRibbonMenu(evt: MouseEvent): Menu | null {
		const ribbon = this.leftRibbon;
		if (!ribbon?.containerEl || typeof ribbon.onContextMenu !== "function") return null;

		let captured: Menu | null = null;
		const menuProto = Menu.prototype as unknown as { showAtMouseEvent: (e: MouseEvent) => Menu };
		const origShow = menuProto.showAtMouseEvent;
		menuProto.showAtMouseEvent = function (this: Menu) {
			captured = this;
			return this;
		};

		try {
			const proxyEvt = Object.create(evt, { target: { value: ribbon.containerEl } }) as MouseEvent;
			ribbon.onContextMenu(proxyEvt);
		} catch {
			// Ignorar
		} finally {
			menuProto.showAtMouseEvent = origShow;
		}

		return captured;
	}

	private setupRibbonContextMenuAndDragDrop(): void {
		const ribbon = this.leftRibbon;
		const container = ribbon?.containerEl;
		if (!container) return;

		const onRibbonContextMenu = (evt: MouseEvent) => {
			// Cuando el usuario elige "Opciones de barra", dejamos pasar el clic al componente nativo
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
			const nativeItems: MenuItem[] = nativeMenu
				? (((nativeMenu as unknown as { items?: Array<MenuItem | unknown> }).items || []).filter(
						(x) => Boolean((x as unknown as { titleEl?: HTMLElement }).titleEl)
				  ) as MenuItem[])
				: [];

			// Renombrar los ítems nativos que corresponden a nuestros propios marcadores
			for (const natItem of nativeItems) {
				const titleEl = (natItem as unknown as { titleEl?: HTMLElement }).titleEl;
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
				// Submenú con las opciones nativas reales (dinámicas, sin hardcodear)
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
				// Respaldo: reenviar el clic derecho al componente nativo para que muestre sus opciones
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
			for (const popup of this.openPopups) {
				const pRect = popup.el.getBoundingClientRect();
				if (x >= pRect.left - 8 && x <= pRect.right + 8 && y >= pRect.top - 8 && y <= pRect.bottom + 8) {
					return true;
				}
			}
			return false;
		};

		const onGlobalDragOver = (evt: DragEvent) => {
			if (!isPointInDropZone(evt.clientX, evt.clientY)) {
				this.setDraggingMode(false);
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

		window.addEventListener("dragover", onGlobalDragOver, true);
		window.addEventListener("drop", onGlobalDrop, true);
		this.cleanupListeners.push(() => {
			window.removeEventListener("dragover", onGlobalDragOver, true);
			window.removeEventListener("drop", onGlobalDrop, true);
		});
	}

	/* ==========================================================================
	   Arrastre interno (reordenar, agrupar, anidar)
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
		el.style.left = `${Math.round(x)}px`;
		el.style.top = `${Math.round(y - 2)}px`;
		el.style.width = `${Math.round(width)}px`;
		el.show();
	}

	private hidePurpleDropLine(): void {
		if (this.dropBarEl) this.dropBarEl.hide();
	}

	private setDraggingMode(active: boolean): void {
		if (active) {
			document.body.addClass("rb-is-dragging");
		} else {
			document.body.removeClass("rb-is-dragging");
			this.clearHoverExpandTimer();
			this.hidePurpleDropLine();
			this.clearAllDropHighlights();
		}
	}

	private clearAllDropHighlights(): void {
		for (const node of this.renderedEls.values()) node.removeClass("rb-drop-inside");
		for (const popup of this.openPopups) {
			for (const row of popup.rowEls.values()) row.removeClass("rb-drop-inside");
		}
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
				for (const child of children) {
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

		for (const item of this.settings.items) {
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
		this.hidePurpleDropLine();
		this.clearAllDropHighlights();

		if (!hit) {
			this.clearHoverExpandTimer();
			return;
		}

		const canGroup =
			hit.zone === "inside" && hit.targetItem.type !== "separator" && (!sourceItem || sourceItem.type !== "separator");

		if (canGroup) {
			hit.targetEl.addClass("rb-drop-inside");
			if (hit.targetItem.type === "folder") {
				this.scheduleHoverFolderExpand(hit.targetItem, hit.targetEl, hit.popupLevel + 1);
			} else {
				this.clearHoverExpandTimer();
			}
			return;
		}

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
			if (downEvt.button !== 0 || downEvt.ctrlKey) return;
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
					ghostEl.style.left = `${moveEvt.clientX + 12}px`;
					ghostEl.style.top = `${moveEvt.clientY - 12}px`;
				}

				lastHit = this.findDropTargetAtPoint(moveEvt.clientX, moveEvt.clientY, sourceItem.id);
				this.updateDragVisualFeedback(lastHit, sourceItem);
			};

			const onMouseUp = async (upEvt: MouseEvent) => {
				window.removeEventListener("mousemove", onMouseMove, true);
				window.removeEventListener("mouseup", onMouseUp, true);
				el.removeClass("rb-is-dragging-source");
				if (ghostEl) {
					ghostEl.remove();
					ghostEl = null;
				}

				if (!isDragging) return;

				// Evita que el clic de soltar se interprete como clic simple y abra el elemento
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

			window.addEventListener("mousemove", onMouseMove, true);
			window.addEventListener("mouseup", onMouseUp, true);
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
		if (typeof workspace.onDragLeaf !== "function") return;

		const original = workspace.onDragLeaf.bind(workspace);
		workspace.onDragLeaf = (evt: DragEvent, leaf: WorkspaceLeaf) => {
			this.activeDraggedLeaf = leaf;
			const clearLeaf = () => {
				window.setTimeout(() => {
					this.activeDraggedLeaf = null;
					this.setDraggingMode(false);
				}, 50);
			};
			window.addEventListener("dragend", clearLeaf, { once: true, capture: true });
			window.addEventListener("drop", clearLeaf, { once: true, capture: false });
			return original(evt, leaf);
		};
		this.cleanupListeners.push(() => {
			workspace.onDragLeaf = original;
		});
	}

	/* ==========================================================================
	   Extracción de lo que se suelta sobre la barra
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
					((viewState.state as { url?: string } | undefined)?.url as string | undefined) ||
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
				// Ignorar
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
				// Ignorar
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
			});
		}

		return results;
	}

	/* ==========================================================================
	   Modales
	   ========================================================================== */

	public openAddModal(insertIndex?: number): void {
		new BookmarkItemModal({
			app: this.app,
			isNew: true,
			t: this.t,
			customIcons: this.settings.customIcons,
			savedOnlineIcons: this.settings.savedOnlineIcons,
			onSaveCustomIcon: (ic) => this.saveCustomIcon(ic),
			onSaveOnlineIcon: (ic) => this.saveOnlineIcon(ic),
			onSubmit: async (created) => {
				if (typeof insertIndex === "number" && insertIndex >= 0 && insertIndex <= this.settings.items.length) {
					this.settings.items.splice(insertIndex, 0, created);
				} else {
					this.settings.items.push(created);
				}
				await this.saveSettings();
				this.renderRibbonItems();
			},
		}).open();
	}

	public openEditModal(item: RibbonBookmarkItem, containerList: RibbonBookmarkItem[]): void {
		new BookmarkItemModal({
			app: this.app,
			item,
			isNew: false,
			t: this.t,
			customIcons: this.settings.customIcons,
			savedOnlineIcons: this.settings.savedOnlineIcons,
			onSaveCustomIcon: (ic) => this.saveCustomIcon(ic),
			onSaveOnlineIcon: (ic) => this.saveOnlineIcon(ic),
			onSubmit: async (updated) => {
				const idx = containerList.findIndex((x) => x.id === item.id);
				if (idx !== -1) {
					containerList[idx] = updated;
					await this.saveSettings();
					this.renderRibbonItems();
				}
			},
			onDelete: async () => {
				const idx = containerList.findIndex((x) => x.id === item.id);
				if (idx !== -1) {
					containerList.splice(idx, 1);
					await this.saveSettings();
					this.renderRibbonItems();
				}
			},
		}).open();
	}
}

class RibbonBookmarksSettingTab extends PluginSettingTab {
	plugin: RibbonBookmarksPlugin;

	constructor(app: App, plugin: RibbonBookmarksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const t = this.plugin.t;
		containerEl.empty();

		containerEl.createEl("h2", { text: t("settingsTitle") });

		new Setting(containerEl)
			.setName(t("settingsLanguage"))
			.setDesc(t("settingsLanguageDesc"))
			.addDropdown((dd) =>
				dd
					.addOption("auto", t("settingsLangAuto"))
					.addOption("es", t("langEs"))
					.addOption("en", t("langEn"))
					.setValue(this.plugin.settings.language)
					.onChange(async (val) => {
						this.plugin.settings.language = val as LangSetting;
						await this.plugin.saveSettings();
						this.plugin.refreshTranslator();
						this.plugin.renderRibbonItems();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName(t("settingsActions"))
			.addButton((btn) =>
				btn
					.setButtonText(t("settingsAddItem"))
					.setCta()
					.onClick(() => this.plugin.openAddModal())
			)
			.addButton((btn) =>
				btn.setButtonText(t("settingsAddSeparator")).onClick(async () => {
					this.plugin.settings.items.push({
						id: crypto.randomUUID(),
						type: "separator",
						title: t("defaultSeparator"),
						iconSource: "auto",
					});
					await this.plugin.saveSettings();
					this.plugin.renderRibbonItems();
					this.display();
				})
			);
	}
}
