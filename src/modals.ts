import { App, Modal, Notice, Setting, TFile, setIcon, setTooltip } from "obsidian";
import {
	BUILTIN_BRAND_SVGS,
	detectKnownUrlIcon,
	fetchIconifySvg,
	getAllObsidianLucideIcons,
	getBuiltinBrandSvg,
	getLucideIconForFilePath,
	getOrRegisterItemIconId,
	parseUrlLoose,
	registerIconOnce,
	resolveAutoIconForUrl,
	sanitizeAndMonochromizeSvg,
	searchOnlineMonochromeIcons,
} from "./icons";
import { TFn } from "./i18n";
import { CustomSavedIcon, RibbonBookmarkItem, SavedOnlineIcon } from "./types";

export interface BookmarkModalOptions {
	app: App;
	item?: RibbonBookmarkItem;
	isNew?: boolean;
	t: TFn;
	customIcons: CustomSavedIcon[];
	savedOnlineIcons: SavedOnlineIcon[];
	onSaveCustomIcon: (icon: CustomSavedIcon) => Promise<void> | void;
	onSaveOnlineIcon: (icon: SavedOnlineIcon) => Promise<void> | void;
	onSubmit: (result: RibbonBookmarkItem) => Promise<void> | void;
	onDelete?: (item: RibbonBookmarkItem) => Promise<void> | void;
}

export class BookmarkItemModal extends Modal {
	private draft: RibbonBookmarkItem;
	private isNew: boolean;
	private t: TFn;
	private customIcons: CustomSavedIcon[];
	private savedOnlineIcons: SavedOnlineIcon[];
	private onSaveCustomIconCb: (icon: CustomSavedIcon) => Promise<void> | void;
	private onSaveOnlineIconCb: (icon: SavedOnlineIcon) => Promise<void> | void;
	private onSubmitCb: (result: RibbonBookmarkItem) => Promise<void> | void;
	private onDeleteCb?: (item: RibbonBookmarkItem) => Promise<void> | void;
	private activeIconTab: "icons" | "internet" = "icons";
	private iconPreviewBoxEl: HTMLElement | null = null;
	private iconPickerWrapperEl: HTMLElement | null = null;
	/** Once the user picks an icon manually, auto detection from URL or path stops */
	private iconTouchedByUser = false;
	private autoDetectTimer: number | null = null;
	private gridObserver: IntersectionObserver | null = null;
	private cellByLabel: Map<string, HTMLElement> = new Map();
	private selectedCellEl: HTMLElement | null = null;
	private cachedVaultFiles: Array<{ file: TFile; lowerPath: string }> | null = null;

	constructor(opts: BookmarkModalOptions) {
		super(opts.app);
		this.isNew = opts.isNew ?? !opts.item;
		this.iconTouchedByUser = !this.isNew;
		this.t = opts.t;
		this.customIcons = opts.customIcons;
		this.savedOnlineIcons = opts.savedOnlineIcons ?? [];
		this.onSaveCustomIconCb = opts.onSaveCustomIcon;
		this.onSaveOnlineIconCb = opts.onSaveOnlineIcon;
		this.onSubmitCb = opts.onSubmit;
		this.onDeleteCb = opts.onDelete;

		if (opts.item) {
			this.draft = JSON.parse(JSON.stringify(opts.item)) as RibbonBookmarkItem;
		} else {
			this.draft = {
				id: crypto.randomUUID(),
				type: "url",
				title: "",
				url: "",
				iconSource: "auto",
				lucideIcon: "globe",
			};
		}

		this.activeIconTab = this.draft.iconSource === "online" ? "internet" : "icons";
	}

	onOpen(): void {
		this.modalEl.addClass("rb-bookmark-modal");
		this.render();
	}

	onClose(): void {
		if (this.autoDetectTimer !== null) {
			window.clearTimeout(this.autoDetectTimer);
			this.autoDetectTimer = null;
		}
		this.disconnectGridObserver();
		this.cellByLabel.clear();
		this.selectedCellEl = null;
		this.cachedVaultFiles = null;
		this.contentEl.empty();
	}

	private disconnectGridObserver(): void {
		if (this.gridObserver) {
			this.gridObserver.disconnect();
			this.gridObserver = null;
		}
	}

	private createSettingWithHelp(container: HTMLElement, nameText: string, helpTooltip: string): Setting {
		const setting = new Setting(container);
		setting.nameEl.empty();
		const labelRow = setting.nameEl.createDiv({ cls: "rb-setting-label-row" });
		labelRow.createSpan({ text: nameText });
		const helpIcon = labelRow.createSpan({ cls: "rb-help-icon" });
		setIcon(helpIcon, "help-circle");
		setTooltip(helpIcon, helpTooltip, { placement: "top" });
		return setting;
	}

	private updateIconPreview(): void {
		if (!this.iconPreviewBoxEl) return;
		this.iconPreviewBoxEl.empty();
		const iconId = getOrRegisterItemIconId(this.draft);
		if (iconId) {
			setIcon(this.iconPreviewBoxEl, iconId);
		}
	}

	private render(): void {
		const { contentEl } = this;
		this.disconnectGridObserver();
		contentEl.empty();

		const isFolder = this.draft.type === "folder";
		const title = isFolder
			? this.isNew
				? this.t("modalNewFolder")
				: this.t("modalEditFolder")
			: this.isNew
			? this.t("modalNewItem")
			: this.t("modalEditItem");

		this.setTitle(title);

		const formEl = contentEl.createDiv({ cls: "rb-form" });

		const nameSetting = this.createSettingWithHelp(formEl, this.t("fieldName"), this.t("helpName"));
		nameSetting.addText((text) => {
			text.inputEl.addClass("rb-wide-input");
			text
				.setPlaceholder(isFolder ? this.t("defaultFolderName") : this.t("fieldName"))
				.setValue(this.draft.title || "")
				.onChange((val) => {
					this.draft.title = val;
				});
		});

		if (!isFolder) {
			if (this.isNew) {
				this.createSettingWithHelp(formEl, this.t("fieldType"), this.t("helpType")).addDropdown((dd) => {
					dd.addOption("url", this.t("optionUrl"))
						.addOption("file", this.t("optionFile"))
						.setValue(this.draft.type === "file" ? "file" : "url")
						.onChange((val: "url" | "file") => {
							this.draft.type = val;
							if (val === "file" && this.draft.iconSource === "auto") {
								this.draft.lucideIcon = getLucideIconForFilePath(this.draft.filePath || "");
							}
							this.render();
						});
				});
			}

			if (this.draft.type === "url") {
				this.renderUrlFields(formEl);
			} else if (this.isNew && this.draft.type === "file") {
				this.renderFileFields(formEl);
			}
		}

		this.renderIconPickerSection(contentEl);
		this.renderFooterButtons(contentEl);
	}

	private renderUrlFields(container: HTMLElement): void {
		const urlSetting = this.createSettingWithHelp(container, this.t("fieldUrl"), this.t("helpUrl"));
		urlSetting.addText((text) => {
			text.inputEl.addClass("rb-wide-input");
			text
				.setPlaceholder(this.t("urlPlaceholder"))
				.setValue(this.draft.url || "")
				.onChange((val) => {
					this.draft.url = val.trim();
					this.scheduleAutoIconDetection();
				});
		});
	}

	private scheduleAutoIconDetection(): void {
		if (this.iconTouchedByUser) return;
		const url = (this.draft.url || "").trim();

		// 1. Immediate local recognition
		const known = detectKnownUrlIcon(url);
		if (known.customSvg) {
			this.applyDetectedIcon("custom-svg", known.customSvg, known.lucideIcon, undefined);
		} else {
			this.applyDetectedIcon("lucide", undefined, known.lucideIcon || "globe", undefined);
		}

		// 2. Site logo from the internet (only when it was not recognized locally)
		if (this.autoDetectTimer !== null) {
			window.clearTimeout(this.autoDetectTimer);
			this.autoDetectTimer = null;
		}
		if (known.customSvg || !this.looksLikeCompleteDomain(url)) return;

		this.autoDetectTimer = window.setTimeout(() => {
			void this.lookupOnlineIcon();
		}, 500);
	}

	/** Looks up the site logo online. Only runs when the domain is not in the local catalog. */
	private async lookupOnlineIcon(): Promise<void> {
		this.autoDetectTimer = null;
		if (this.iconTouchedByUser) return;
		const resolved = await resolveAutoIconForUrl((this.draft.url || "").trim());
		if (resolved.iconSource !== "online" || !resolved.customSvg) return;
		if (this.iconTouchedByUser) return;
		this.applyDetectedIcon("online", resolved.customSvg, resolved.lucideIcon, resolved.onlineKey);
		if (resolved.onlineKey) {
			void this.onSaveOnlineIconCb({ key: resolved.onlineKey, svg: resolved.customSvg });
		}
	}

	private looksLikeCompleteDomain(raw: string): boolean {
		const parsed = parseUrlLoose(raw);
		if (!parsed) return false;
		return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(parsed.hostname) && parsed.hostname.includes(".");
	}

	private applyDetectedIcon(
		source: "custom-svg" | "lucide" | "online",
		customSvg: string | undefined,
		lucideIcon: string | undefined,
		onlineKey: string | undefined
	): void {
		this.draft.iconSource = source;
		this.draft.customSvg = customSvg;
		this.draft.lucideIcon = lucideIcon;
		this.draft.onlineIconKey = onlineKey;

		const newTab = source === "online" ? "internet" : "icons";
		const sameTab =
			this.activeIconTab === newTab && this.iconPickerWrapperEl?.getAttribute("data-rb-tab") === newTab;
		this.activeIconTab = newTab;

		this.updateIconPreview();
		if (sameTab) {
			this.markDetectedIconInPlace();
		} else {
			this.rebuildIconSection();
		}
	}

	private rebuildIconSection(): void {
		const wrapper = this.iconPickerWrapperEl;
		const parent = wrapper?.parentElement;
		if (!wrapper || !parent) return;
		const anchor = wrapper.nextSibling;
		wrapper.remove();
		this.renderIconPickerSection(parent);
		const rebuilt = this.iconPickerWrapperEl;
		if (rebuilt && rebuilt.parentElement === parent) {
			parent.insertBefore(rebuilt, anchor);
		}
	}

	private getCurrentTargetLabel(): string {
		if (this.draft.iconSource === "custom-svg" && this.draft.customSvg) {
			const saved = this.customIcons.find((s) => s.svg === this.draft.customSvg);
			if (saved) return saved.label;
			for (const key of Object.keys(BUILTIN_BRAND_SVGS)) {
				if (getBuiltinBrandSvg(key) === this.draft.customSvg) {
					return BUILTIN_BRAND_SVGS[key].label;
				}
			}
			return "";
		}
		if (this.draft.iconSource === "online" && this.draft.onlineIconKey) {
			return this.draft.onlineIconKey;
		}
		if ((this.draft.iconSource === "lucide" || this.draft.iconSource === "auto") && this.draft.lucideIcon) {
			return this.draft.lucideIcon;
		}
		return "";
	}

	private selectAndPositionCell(target: HTMLElement | undefined, grid: HTMLElement): void {
		if (this.selectedCellEl && this.selectedCellEl !== target) {
			this.selectedCellEl.removeClass("is-selected");
		}
		this.selectedCellEl = target ?? null;
		if (!target) return;

		this.ensureCellIconRendered(target);
		target.addClass("is-selected");

		const addCell = grid.querySelector<HTMLElement>(".rb-icon-cell-add");
		if (addCell && addCell.parentElement === grid) {
			if (addCell.nextElementSibling !== target) {
				addCell.insertAdjacentElement("afterend", target);
			}
		} else if (grid.firstElementChild !== target) {
			grid.prepend(target);
		}
	}

	private ensureCellIconRendered(cell: HTMLElement): void {
		if (cell.getAttribute("data-rb-rendered") === "1") return;
		const iconId = cell.getAttribute("data-rb-icon-id");
		if (!iconId) return;
		cell.setAttribute("data-rb-rendered", "1");
		const iconSpan = cell.createDiv({ cls: "rb-icon-cell-svg" });
		setIcon(iconSpan, iconId);
	}

	/** Marks and positions the detected icon in O(1) using the cellByLabel index. */
	private markDetectedIconInPlace(): void {
		const wrapper = this.iconPickerWrapperEl;
		if (!wrapper) return;
		const grid = wrapper.querySelector<HTMLElement>(".rb-icon-grid");
		if (!grid) return;

		const label = this.getCurrentTargetLabel();
		const target = label ? this.cellByLabel.get(label) : undefined;
		this.selectAndPositionCell(target, grid);
	}

	private renderFileFields(container: HTMLElement): void {
		const fileSetting = this.createSettingWithHelp(container, this.t("fieldFile"), this.t("helpFile"));

		let inputEl: HTMLInputElement | null = null;
		let justPasted = false;

		const applyPath = (rawPath: string) => {
			this.draft.filePath = rawPath;
			if (!this.draft.title) {
				const parts = rawPath.split("/");
				this.draft.title = parts[parts.length - 1] || rawPath;
			}
			if (!this.iconTouchedByUser) {
				this.draft.lucideIcon = getLucideIconForFilePath(rawPath);
				this.updateIconPreview();
				this.markDetectedIconInPlace();
			}
		};

		const resultsEl = container.createDiv({ cls: "rb-vault-file-results" });
		resultsEl.hide();

		fileSetting.addText((text) => {
			inputEl = text.inputEl;
			text.inputEl.addClass("rb-wide-input");
			text
				.setPlaceholder(this.t("filePlaceholder"))
				.setValue(this.draft.filePath || "")
				.onChange((val) => {
					if (justPasted) {
						justPasted = false;
						resultsEl.hide();
						resultsEl.empty();
						applyPath(val.trim());
						return;
					}
					applyPath(val.trim());
					if (val.trim().length > 0) {
						this.renderVaultMatches(resultsEl, val.trim(), (chosen) => {
							applyPath(chosen.path);
							if (inputEl) inputEl.value = chosen.path;
							if (!this.draft.title) this.draft.title = chosen.name;
							resultsEl.hide();
							resultsEl.empty();
						});
					} else {
						resultsEl.hide();
						resultsEl.empty();
					}
				});
			text.inputEl.addEventListener("paste", () => {
				justPasted = true;
			});
		});

		fileSetting.addButton((btn) => {
			btn
				.setIcon("folder-open")
				.setTooltip(this.t("browseMac"))
				.onClick(() => {
					const fileInput = createEl("input", { type: "file" });
					fileInput.onchange = () => {
						const file = fileInput.files?.[0];
						if (!file) return;
						const electronPath = (file as unknown as { path?: string }).path;
						const vaultBasePath = (
							this.app.vault.adapter as unknown as { getBasePath?: () => string }
						).getBasePath?.();
						let finalPath = file.name;
						if (electronPath && vaultBasePath && electronPath.startsWith(vaultBasePath)) {
							finalPath = electronPath.slice(vaultBasePath.length).replace(/^\/+/, "");
						} else if (electronPath) {
							finalPath = electronPath;
						} else {
							const match = this.app.vault.getFiles().find((f) => f.name === file.name);
							finalPath = match ? match.path : file.name;
						}
						applyPath(finalPath);
						if (!this.draft.title) this.draft.title = file.name;
						if (inputEl) inputEl.value = finalPath;
						resultsEl.hide();
						resultsEl.empty();
						this.render();
					};
					fileInput.click();
				});
		});
	}

	private renderVaultMatches(
		resultsEl: HTMLElement,
		query: string,
		onChoose: (file: TFile) => void
	): void {
		if (!this.cachedVaultFiles) {
			this.cachedVaultFiles = this.app.vault
				.getFiles()
				.map((file) => ({ file, lowerPath: file.path.toLowerCase() }));
		}

		const q = query.toLowerCase().trim();
		const matches: TFile[] = [];
		for (let i = 0; i < this.cachedVaultFiles.length; i++) {
			const entry = this.cachedVaultFiles[i];
			if (entry.lowerPath.includes(q)) {
				matches.push(entry.file);
				if (matches.length >= 25) break;
			}
		}

		resultsEl.empty();
		if (matches.length === 0) {
			resultsEl.hide();
			return;
		}
		resultsEl.show();

		for (let i = 0; i < matches.length; i++) {
			const f = matches[i];
			const row = resultsEl.createDiv({ cls: "rb-vault-file-row" });
			const iconSpan = row.createSpan({ cls: "rb-vault-file-row-icon" });
			setIcon(iconSpan, getLucideIconForFilePath(f.path));
			row.createSpan({ text: f.path, cls: "rb-vault-file-row-path" });
			row.onclick = () => onChoose(f);
		}
	}

	private renderIconPickerSection(container: HTMLElement): void {
		this.disconnectGridObserver();
		this.cellByLabel.clear();
		this.selectedCellEl = null;

		const wrapper = container.createDiv({ cls: "rb-icon-picker-wrapper" });
		wrapper.setAttribute("data-rb-tab", this.activeIconTab);
		this.iconPickerWrapperEl = wrapper;

		const topBar = wrapper.createDiv({ cls: "rb-icon-picker-topbar" });
		this.iconPreviewBoxEl = topBar.createDiv({ cls: "rb-icon-preview-box" });
		this.updateIconPreview();

		const tabsBar = topBar.createDiv({ cls: "rb-icon-tabs-bar" });
		const tabs: Array<{ id: "icons" | "internet"; label: string }> = [
			{ id: "icons", label: this.t("tabIcons") },
			{ id: "internet", label: this.t("tabOnline") },
		];

		for (const tab of tabs) {
			const btn = tabsBar.createEl("button", {
				text: tab.label,
				cls: "rb-icon-tab-btn" + (this.activeIconTab === tab.id ? " is-active" : ""),
			});
			btn.onclick = () => {
				this.activeIconTab = tab.id;
				this.rebuildIconSection();
			};
		}

		const tabBody = wrapper.createDiv({ cls: "rb-icon-tab-body" });

		if (this.activeIconTab === "internet") {
			this.renderInternetSearchTab(tabBody);
		} else {
			this.renderIconsTab(tabBody);
		}
	}

	/**
	 * Unified icon tab:
	 * - Uses IntersectionObserver to render Lucide SVGs on demand while scrolling.
	 * - Filters by toggling existing nodes (cell.hidden) without destroying or recreating the DOM.
	 * - Uses event delegation (a single listener on the grid).
	 */
	private renderIconsTab(container: HTMLElement): void {
		const bar = container.createDiv({ cls: "rb-internet-search-bar" });
		const searchInput = bar.createEl("input", {
			type: "text",
			placeholder: this.t("iconSearchPlaceholder"),
			cls: "rb-icon-search-input",
		});

		const grid = container.createDiv({ cls: "rb-icon-grid" });

		this.gridObserver = new IntersectionObserver(
			(entries) => {
				for (let i = 0; i < entries.length; i++) {
					const entry = entries[i];
					if (entry.isIntersecting) {
						const cell = entry.target as HTMLElement;
						this.ensureCellIconRendered(cell);
						this.gridObserver?.unobserve(cell);
					}
				}
			},
			{ root: grid, rootMargin: "120px" }
		);

		// 1. First cell: "+" to load an SVG from the device
		const addCell = grid.createDiv({
			cls: "rb-icon-cell rb-icon-cell-add",
			attr: { "aria-label": this.t("addSvg") },
		});
		const plusBox = addCell.createDiv({ cls: "rb-icon-cell-svg" });
		setIcon(plusBox, "plus");
		addCell.onclick = (evt) => {
			evt.stopPropagation();
			const input = createEl("input", { type: "file", attr: { accept: ".svg,image/svg+xml" } });
			input.onchange = async () => {
				const file = input.files?.[0];
				if (!file) return;
				const text = await file.text();
				const finalSvg = sanitizeAndMonochromizeSvg(text);
				if (!finalSvg) {
					new Notice(this.t("noticeSvgInvalid"));
					return;
				}
				const newSaved: CustomSavedIcon = {
					id: crypto.randomUUID(),
					label: file.name.replace(/\.svg$/i, ""),
					svg: finalSvg,
				};
				await this.onSaveCustomIconCb(newSaved);
				this.iconTouchedByUser = true;
				this.draft.iconSource = "custom-svg";
				this.draft.customSvg = finalSvg;
				this.draft.onlineIconKey = undefined;
				this.updateIconPreview();
				this.rebuildIconSection();
			};
			input.click();
		};

		// Map of custom SVGs by label, used for click delegation
		const customSvgByLabel = new Map<string, string>();

		// 2. Icons uploaded by the user
		for (let i = 0; i < this.customIcons.length; i++) {
			const saved = this.customIcons[i];
			const iconId = `rb-saved-custom-${saved.id}`;
			registerIconOnce(iconId, saved.svg);
			customSvgByLabel.set(saved.label, saved.svg);

			const cell = grid.createDiv({
				cls: "rb-icon-cell",
				attr: {
					"aria-label": saved.label,
					"data-rb-kind": "custom",
					"data-rb-icon-id": iconId,
				},
			});
			this.ensureCellIconRendered(cell);
			this.cellByLabel.set(saved.label, cell);
		}

		// 3. Built-in vector logos
		for (const [key, item] of Object.entries(BUILTIN_BRAND_SVGS)) {
			const svg = getBuiltinBrandSvg(key);
			if (!svg) continue;
			const iconId = `rb-brand-${key}`;
			registerIconOnce(iconId, svg);
			customSvgByLabel.set(item.label, svg);

			const cell = grid.createDiv({
				cls: "rb-icon-cell",
				attr: {
					"aria-label": item.label,
					"data-rb-kind": "custom",
					"data-rb-icon-id": iconId,
				},
			});
			this.ensureCellIconRendered(cell);
			this.cellByLabel.set(item.label, cell);
		}

		// 4. The whole Lucide library (lazily rendered as it enters the viewport)
		const allIcons = getAllObsidianLucideIcons();
		const lucideCells: Array<{ cell: HTMLElement; lowerName: string }> = [];
		const fragment = createFragment();

		for (let i = 0; i < allIcons.length; i++) {
			const iconName = allIcons[i];
			const cell = createDiv({ cls: "rb-icon-cell" });
			cell.setAttribute("aria-label", iconName);
			cell.setAttribute("data-rb-kind", "lucide");
			cell.setAttribute("data-rb-icon-id", iconName);
			fragment.appendChild(cell);
			this.cellByLabel.set(iconName, cell);
			lucideCells.push({ cell, lowerName: iconName.toLowerCase() });
			this.gridObserver.observe(cell);
		}
		grid.appendChild(fragment);

		// Event delegation on the grid (a single listener for the ~1600 cells)
		grid.addEventListener("click", (evt: MouseEvent) => {
			const target = (evt.target as HTMLElement | null)?.closest<HTMLElement>(".rb-icon-cell") ?? null;
			if (!target || target === addCell) return;
			const kind = target.getAttribute("data-rb-kind");
			const label = target.getAttribute("aria-label") || "";
			if (!label) return;

			this.iconTouchedByUser = true;
			if (kind === "custom") {
				const svg = customSvgByLabel.get(label);
				if (!svg) return;
				this.draft.iconSource = "custom-svg";
				this.draft.customSvg = svg;
				this.draft.onlineIconKey = undefined;
			} else if (kind === "lucide") {
				this.draft.iconSource = "lucide";
				this.draft.lucideIcon = label;
				this.draft.customSvg = undefined;
				this.draft.onlineIconKey = undefined;
			}
			this.updateIconPreview();
			this.selectAndPositionCell(target, grid);
		});

		// Instant filtering without recreating DOM nodes
		searchInput.addEventListener("input", () => {
			const q = searchInput.value.toLowerCase().trim();
			for (let i = 0; i < lucideCells.length; i++) {
				const entry = lucideCells[i];
				entry.cell.hidden = q.length > 0 && !entry.lowerName.includes(q);
			}
		});

		// Mark the icon currently in use and place it second (right after the "+")
		const initialLabel = this.getCurrentTargetLabel();
		if (initialLabel) {
			const initialCell = this.cellByLabel.get(initialLabel);
			this.selectAndPositionCell(initialCell, grid);
		}
	}

	private renderInternetSearchTab(container: HTMLElement): void {
		const bar = container.createDiv({ cls: "rb-internet-search-bar" });
		const input = bar.createEl("input", {
			type: "text",
			placeholder: this.t("iconSearchPlaceholder"),
			cls: "rb-icon-search-input",
		});
		const searchBtn = bar.createEl("button", {
			cls: "mod-cta rb-search-icon-btn",
			attr: { "aria-label": this.t("iconSearch") },
		});
		setIcon(searchBtn, "search");

		const grid = container.createDiv({ cls: "rb-icon-grid" });

		const isCurrentOnline = (key: string, svg: string): boolean =>
			this.draft.iconSource === "online" &&
			(this.draft.onlineIconKey === key || this.draft.customSvg === svg);

		const applyOnlineIcon = (key: string, svg: string, cell: HTMLElement) => {
			this.iconTouchedByUser = true;
			this.draft.iconSource = "online";
			this.draft.onlineIconKey = key;
			this.draft.customSvg = svg;
			this.updateIconPreview();
			void this.onSaveOnlineIconCb({ key, svg });
			this.selectAndPositionCell(cell, grid);
		};

		const renderSaved = () => {
			grid.empty();
			this.cellByLabel.clear();
			this.selectedCellEl = null;

			const saved = [...this.savedOnlineIcons];
			const currentKey = this.draft.onlineIconKey;
			const currentSvg = this.draft.customSvg;
			if (this.draft.iconSource === "online" && currentKey && currentSvg && !saved.some((s) => s.key === currentKey)) {
				saved.unshift({ key: currentKey, svg: currentSvg });
			}
			for (let i = 0; i < saved.length; i++) {
				const entry = saved[i];
				const selected = isCurrentOnline(entry.key, entry.svg);
				const cell = grid.createDiv({
					cls: "rb-icon-cell" + (selected ? " is-selected" : ""),
					attr: { "aria-label": entry.key },
				});
				if (selected) this.selectedCellEl = cell;
				this.cellByLabel.set(entry.key, cell);

				const svgBox = cell.createDiv({ cls: "rb-icon-cell-svg" });
				const tempId = `rb-net-${entry.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
				registerIconOnce(tempId, entry.svg);
				setIcon(svgBox, tempId);
				cell.onclick = () => applyOnlineIcon(entry.key, entry.svg, cell);
			}
		};

		const runSearch = async () => {
			const q = input.value.trim();
			if (!q) {
				renderSaved();
				return;
			}
			grid.empty();
			this.cellByLabel.clear();
			this.selectedCellEl = null;

			const icons = await searchOnlineMonochromeIcons(q, 96);
			for (let i = 0; i < icons.length; i++) {
				const iconKey = icons[i];
				const cell = grid.createDiv({ cls: "rb-icon-cell", attr: { "aria-label": iconKey } });
				this.cellByLabel.set(iconKey, cell);
				const svgBox = cell.createDiv({ cls: "rb-icon-cell-svg" });
				setIcon(svgBox, "loader");

				void fetchIconifySvg(iconKey).then((svg) => {
					svgBox.empty();
					if (svg) {
						const tempId = `rb-net-${iconKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
						registerIconOnce(tempId, svg);
						setIcon(svgBox, tempId);
						if (isCurrentOnline(iconKey, svg)) {
							cell.addClass("is-selected");
							this.selectedCellEl = cell;
						}
						cell.onclick = () => applyOnlineIcon(iconKey, svg, cell);
					} else {
						cell.remove();
						this.cellByLabel.delete(iconKey);
					}
				});
			}
		};

		renderSaved();

		searchBtn.onclick = (): void => {
			void runSearch();
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				void runSearch();
			}
		});
		input.addEventListener("input", () => {
			if (input.value.trim() === "") {
				renderSaved();
			}
		});
	}

	private renderFooterButtons(container: HTMLElement): void {
		const footer = container.createDiv({ cls: "rb-modal-footer" });

		if (!this.isNew && this.onDeleteCb) {
			const delBtn = footer.createEl("button", {
				text: this.t("delete"),
				cls: "mod-warning",
			});
			delBtn.onclick = async () => {
				if (this.onDeleteCb) {
					await this.onDeleteCb(this.draft);
				}
				this.close();
			};
		}

		const rightBtns = footer.createDiv({ cls: "rb-modal-footer-right" });
		const cancelBtn = rightBtns.createEl("button", { text: this.t("cancel") });
		cancelBtn.onclick = () => this.close();

		const saveBtn = rightBtns.createEl("button", {
			text: this.isNew ? this.t("add") : this.t("save"),
			cls: "mod-cta",
		});
		saveBtn.onclick = async () => {
			if (this.draft.type === "url") {
				let u = (this.draft.url || "").trim();
				if (!u) {
					new Notice(this.t("noticeUrlRequired"));
					return;
				}
				if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) {
					u = "https://" + u;
				}
				this.draft.url = u;
				if (!this.draft.title) {
					try {
						this.draft.title = new URL(u).hostname.replace(/^www\./, "");
					} catch {
						this.draft.title = u;
					}
				}
				if (this.draft.iconSource === "auto" && !this.draft.customSvg) {
					const resolved = await resolveAutoIconForUrl(u);
					this.draft.iconSource = resolved.iconSource;
					this.draft.customSvg = resolved.customSvg;
					this.draft.lucideIcon = resolved.lucideIcon;
					this.draft.onlineIconKey = resolved.onlineKey;
					if (resolved.iconSource === "online" && resolved.onlineKey && resolved.customSvg) {
						void this.onSaveOnlineIconCb({ key: resolved.onlineKey, svg: resolved.customSvg });
					}
				}
			} else if (this.draft.type === "file") {
				if (!this.draft.filePath?.trim()) {
					new Notice(this.t("noticeFileRequired"));
					return;
				}
				if (!this.draft.title) {
					const parts = this.draft.filePath.split("/");
					this.draft.title = parts[parts.length - 1];
				}
			} else if (this.draft.type === "folder") {
				if (!this.draft.title?.trim()) {
					this.draft.title = this.t("defaultFolderName");
				}
			}

			await this.onSubmitCb(this.draft);
			this.close();
		};
	}
}
