import { App, Modal, Notice, Setting, TFile, addIcon, setIcon, setTooltip } from "obsidian";
import {
	BUILTIN_BRAND_SVGS,
	fetchIconifySvg,
	getAllObsidianLucideIcons,
	getBuiltinBrandSvg,
	getLucideIconForFilePath,
	getOrRegisterItemIconId,
	resolveAutoIconForUrl,
	sanitizeAndMonochromizeSvg,
	searchOnlineMonochromeIcons,
} from "./icons";
import { TFn } from "./i18n";
import { CustomSavedIcon, RibbonBookmarkItem } from "./types";

export interface BookmarkModalOptions {
	app: App;
	item?: RibbonBookmarkItem;
	isNew?: boolean;
	t: TFn;
	customIcons: CustomSavedIcon[];
	onSaveCustomIcon: (icon: CustomSavedIcon) => Promise<void> | void;
	onSubmit: (result: RibbonBookmarkItem) => Promise<void> | void;
	onDelete?: (item: RibbonBookmarkItem) => Promise<void> | void;
}

export class BookmarkItemModal extends Modal {
	private draft: RibbonBookmarkItem;
	private isNew: boolean;
	private t: TFn;
	private customIcons: CustomSavedIcon[];
	private onSaveCustomIconCb: (icon: CustomSavedIcon) => Promise<void> | void;
	private onSubmitCb: (result: RibbonBookmarkItem) => Promise<void> | void;
	private onDeleteCb?: (item: RibbonBookmarkItem) => Promise<void> | void;
	private activeIconTab: "custom" | "lucide" | "internet" = "custom";
	private iconPreviewBoxEl: HTMLElement | null = null;
	private iconPickerWrapperEl: HTMLElement | null = null;
	/** Si el usuario eligió el ícono a mano, se deja de autodetectar por URL o ruta */
	private iconTouchedByUser = false;
	private autoDetectTimer: number | null = null;

	constructor(opts: BookmarkModalOptions) {
		super(opts.app);
		this.isNew = opts.isNew ?? !opts.item;
		this.iconTouchedByUser = !this.isNew;
		this.t = opts.t;
		this.customIcons = opts.customIcons;
		this.onSaveCustomIconCb = opts.onSaveCustomIcon;
		this.onSubmitCb = opts.onSubmit;
		this.onDeleteCb = opts.onDelete;

		if (opts.item) {
			this.draft = JSON.parse(JSON.stringify(opts.item));
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

		if (this.draft.iconSource === "lucide" || this.draft.type === "folder" || this.draft.type === "file") {
			this.activeIconTab = "lucide";
		} else {
			this.activeIconTab = "custom";
		}
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
		this.contentEl.empty();
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

		// Nombre (siempre visible; al modificar es solo un alias)
		const nameSetting = this.createSettingWithHelp(contentEl, this.t("fieldName"), this.t("helpName"));
		nameSetting.addText((text) => {
			text.inputEl.addClass("rb-wide-input");
			text
				.setPlaceholder(isFolder ? this.t("defaultFolderName") : this.t("fieldName"))
				.setValue(this.draft.title || "")
				.onChange((val) => {
					this.draft.title = val;
				});
		});

		// Tipo de elemento: solo al crear. El campo de valor se muestra siempre
		if (!isFolder) {
			if (this.isNew) {
				this.createSettingWithHelp(contentEl, this.t("fieldType"), this.t("helpType")).addDropdown((dd) => {
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
				// La URL siempre es editable, tanto al crear como al modificar
				this.renderUrlFields(contentEl);
			} else if (this.isNew && this.draft.type === "file") {
				this.renderFileFields(contentEl);
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

	/**
	 * Al escribir o pegar una URL, se detecta su ícono y queda marcado visualmente
	 * en la sección de íconos (igual que los íconos predefinidos y cargados).
	 */
	private scheduleAutoIconDetection(): void {
		if (this.iconTouchedByUser) return;
		if (this.autoDetectTimer !== null) {
			window.clearTimeout(this.autoDetectTimer);
		}
		this.autoDetectTimer = window.setTimeout(async () => {
			this.autoDetectTimer = null;
			const url = (this.draft.url || "").trim();
			if (!url || !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return;

			const resolved = await resolveAutoIconForUrl(url);
			this.draft.iconSource = resolved.iconSource;
			this.draft.customSvg = resolved.customSvg;
			this.draft.lucideIcon = resolved.lucideIcon;

			const newTab = resolved.iconSource === "lucide" ? "lucide" : "custom";
			const sameTab =
				this.activeIconTab === newTab &&
				this.iconPickerWrapperEl?.getAttribute("data-rb-tab") === newTab;
			this.activeIconTab = newTab;

			this.updateIconPreview();
			if (sameTab) {
				this.markDetectedIconInPlace();
			} else {
				this.rebuildIconSection();
			}
		}, 400);
	}

	/** Reconstruye únicamente la sección de íconos, conservando el resto del modal y el foco. */
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

	/** Marca y trae al frente el ícono detectado sin reconstruir toda la grilla. */
	private markDetectedIconInPlace(): void {
		const wrapper = this.iconPickerWrapperEl;
		if (!wrapper) return;
		const grid = wrapper.querySelector(".rb-icon-grid") as HTMLElement | null;
		if (!grid) return;

		grid.querySelectorAll(".rb-icon-cell.is-selected").forEach((c) => c.removeClass("is-selected"));

		let label = "";
		if (this.draft.iconSource === "custom-svg" && this.draft.customSvg) {
			const saved = this.customIcons.find((s) => s.svg === this.draft.customSvg);
			if (saved) {
				label = saved.label;
			} else {
				for (const key of Object.keys(BUILTIN_BRAND_SVGS)) {
					if (getBuiltinBrandSvg(key) === this.draft.customSvg) {
						label = BUILTIN_BRAND_SVGS[key].label;
						break;
					}
				}
			}
		} else if (this.draft.lucideIcon) {
			label = this.draft.lucideIcon;
		}
		if (!label) return;

		const cells = Array.from(grid.querySelectorAll(".rb-icon-cell")) as HTMLElement[];
		const target = cells.find((c) => c.getAttribute("aria-label") === label);
		if (!target) return;
		target.addClass("is-selected");
		if (grid.firstElementChild !== target) {
			grid.prepend(target);
		}
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

		// Resultados del Vault: se muestran unicamente mientras se escribe (nunca al pegar una ruta)
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
						// Al pegar una ruta no se abre el listado; solo se guarda la ruta y se precarga el ícono
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
					const fileInput = document.createElement("input");
					fileInput.type = "file";
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
		const q = query.toLowerCase().trim();
		const matches = this.app.vault
			.getFiles()
			.filter((f) => f.path.toLowerCase().includes(q))
			.slice(0, 25);

		resultsEl.empty();
		if (matches.length === 0) {
			resultsEl.hide();
			return;
		}
		resultsEl.show();

		for (const f of matches) {
			const row = resultsEl.createDiv({ cls: "rb-vault-file-row" });
			const iconSpan = row.createSpan({ cls: "rb-vault-file-row-icon" });
			setIcon(iconSpan, getLucideIconForFilePath(f.path));
			row.createSpan({ text: f.path, cls: "rb-vault-file-row-path" });
			row.onclick = () => onChoose(f);
		}
	}

	private renderIconPickerSection(container: HTMLElement): void {
		const wrapper = container.createDiv({ cls: "rb-icon-picker-wrapper" });
		wrapper.setAttribute("data-rb-tab", this.activeIconTab);
		this.iconPickerWrapperEl = wrapper;

		const topBar = wrapper.createDiv({ cls: "rb-icon-picker-topbar" });
		this.iconPreviewBoxEl = topBar.createDiv({ cls: "rb-icon-preview-box" });
		this.updateIconPreview();

		const tabsBar = topBar.createDiv({ cls: "rb-icon-tabs-bar" });
		const tabs: Array<{ id: "custom" | "lucide" | "internet"; label: string }> = [
			{ id: "custom", label: this.t("tabCustom") },
			{ id: "lucide", label: this.t("tabLucide") },
			{ id: "internet", label: this.t("tabOnline") },
		];

		for (const tab of tabs) {
			const btn = tabsBar.createEl("button", {
				text: tab.label,
				cls: "rb-icon-tab-btn" + (this.activeIconTab === tab.id ? " is-active" : ""),
			});
			btn.onclick = () => {
				this.activeIconTab = tab.id;
				this.render();
			};
		}

		const tabBody = wrapper.createDiv({ cls: "rb-icon-tab-body" });

		if (this.activeIconTab === "custom") {
			this.renderCustomIconsTab(tabBody);
		} else if (this.activeIconTab === "lucide") {
			this.renderLucideIconsTab(tabBody);
		} else {
			this.renderInternetSearchTab(tabBody);
		}
	}

	private renderCustomIconsTab(container: HTMLElement): void {
		const grid = container.createDiv({ cls: "rb-icon-grid" });

		// Primer cuadro: "+" para cargar un SVG desde el dispositivo
		const addCell = grid.createDiv({
			cls: "rb-icon-cell rb-icon-cell-add",
			attr: { "aria-label": this.t("addSvg") },
		});
		const plusBox = addCell.createDiv({ cls: "rb-icon-cell-svg" });
		setIcon(plusBox, "plus");
		addCell.onclick = () => {
			const input = document.createElement("input");
			input.type = "file";
			input.accept = ".svg,image/svg+xml";
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
				this.draft.iconSource = "custom-svg";
				this.draft.customSvg = finalSvg;
				this.updateIconPreview();
				this.render();
			};
			input.click();
		};

		for (const saved of this.customIcons) {
			const iconId = `rb-saved-custom-${saved.id}`;
			addIcon(iconId, saved.svg);
			const cell = grid.createDiv({
				cls:
					"rb-icon-cell" +
					(this.draft.iconSource === "custom-svg" && this.draft.customSvg === saved.svg ? " is-selected" : ""),
				attr: { "aria-label": saved.label },
			});
			const iconBox = cell.createDiv({ cls: "rb-icon-cell-svg" });
			setIcon(iconBox, iconId);
			cell.onclick = () => {
				this.iconTouchedByUser = true;
				this.draft.iconSource = "custom-svg";
				this.draft.customSvg = saved.svg;
				this.updateIconPreview();
				this.render();
			};
		}

		for (const [key, item] of Object.entries(BUILTIN_BRAND_SVGS)) {
			const svg = getBuiltinBrandSvg(key);
			if (!svg) continue;
			const iconId = `rb-brand-${key}`;
			addIcon(iconId, svg);
			const cell = grid.createDiv({
				cls:
					"rb-icon-cell" +
					(this.draft.iconSource === "custom-svg" && this.draft.customSvg === svg ? " is-selected" : ""),
				attr: { "aria-label": item.label },
			});
			const preview = cell.createDiv({ cls: "rb-icon-cell-svg" });
			setIcon(preview, iconId);
			cell.onclick = () => {
				this.iconTouchedByUser = true;
				this.draft.iconSource = "custom-svg";
				this.draft.customSvg = svg;
				this.updateIconPreview();
				this.render();
			};
		}
	}

	private renderLucideIconsTab(container: HTMLElement): void {
		// Misma estructura y espaciado que la barra de "Buscar en internet"
		const bar = container.createDiv({ cls: "rb-internet-search-bar" });
		const searchInput = bar.createEl("input", {
			type: "text",
			placeholder: this.t("iconSearchPlaceholder"),
			cls: "rb-icon-search-input",
		});

		const grid = container.createDiv({ cls: "rb-icon-grid" });
		const allIcons = getAllObsidianLucideIcons();

		// Ícono de Lucide que el ítem está usando actualmente (si lo hay)
		const getCurrentIcon = (): string =>
			this.draft.iconSource !== "custom-svg" && this.draft.lucideIcon ? this.draft.lucideIcon : "";

		const renderGrid = (query: string) => {
			grid.empty();
			const q = query.toLowerCase().trim();
			const filtered = q ? allIcons.filter((id) => id.toLowerCase().includes(q)) : allIcons;
			const current = getCurrentIcon();

			// El ícono en uso va siempre primero y queda marcado
			let ordered = filtered;
			if (current) {
				const rest = filtered.filter((id) => id !== current);
				if (!q || filtered.includes(current)) {
					ordered = [current, ...rest];
				}
			}

			for (const iconName of ordered) {
				const cell = grid.createDiv({
					cls: "rb-icon-cell" + (iconName === current ? " is-selected" : ""),
					attr: { "aria-label": iconName },
				});
				const iconSpan = cell.createDiv({ cls: "rb-icon-cell-svg" });
				setIcon(iconSpan, iconName);
				cell.onclick = () => {
					this.iconTouchedByUser = true;
					this.draft.iconSource = "lucide";
					this.draft.lucideIcon = iconName;
					this.draft.customSvg = undefined;
					this.updateIconPreview();
					renderGrid(searchInput.value);
				};
			}
		};

		searchInput.addEventListener("input", () => renderGrid(searchInput.value));
		renderGrid(searchInput.value);
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

		const runSearch = async () => {
			const q = input.value.trim();
			if (!q) return;
			grid.empty();
			const icons = await searchOnlineMonochromeIcons(q, 96);
			for (const iconKey of icons) {
				const cell = grid.createDiv({ cls: "rb-icon-cell", attr: { "aria-label": iconKey } });
				const svgBox = cell.createDiv({ cls: "rb-icon-cell-svg" });
				setIcon(svgBox, "loader");

				fetchIconifySvg(iconKey).then((svg) => {
					svgBox.empty();
					if (svg) {
						const tempId = `rb-net-${iconKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
						addIcon(tempId, svg);
						setIcon(svgBox, tempId);
						cell.onclick = () => {
							this.iconTouchedByUser = true;
							this.draft.iconSource = "custom-svg";
							this.draft.customSvg = svg;
							this.updateIconPreview();
							grid.querySelectorAll(".rb-icon-cell").forEach((c) => c.removeClass("is-selected"));
							cell.addClass("is-selected");
						};
					} else {
						cell.remove();
					}
				});
			}
		};

		searchBtn.onclick = runSearch;
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				runSearch();
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
