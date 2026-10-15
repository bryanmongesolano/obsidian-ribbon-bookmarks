import { addIcon, getIconIds, requestUrl } from "obsidian";
import { RibbonBookmarkItem } from "./types";

export const BUILTIN_BRAND_SVGS: Record<string, { label: string; viewBox: string; body: string }> = {
	"google-drive": {
		label: "Google Drive",
		viewBox: "0 0 24 24",
		body: '<path fill="currentColor" stroke="none" d="M12.01 1.485c-2.082 0-3.754.02-3.743.047c.01.02 1.708 3.001 3.774 6.62l3.76 6.574h3.76c2.081 0 3.753-.02 3.742-.047c-.005-.02-1.708-3.001-3.775-6.62l-3.76-6.574zm-4.76 1.73a789.828 789.861 0 0 0-3.63 6.319L0 15.868l1.89 3.298l1.885 3.297l3.62-6.335l3.618-6.33l-1.88-3.287C8.1 4.704 7.255 3.22 7.25 3.214zm2.259 12.653l-.203.348c-.114.198-.96 1.672-1.88 3.287a423.93 423.948 0 0 1-1.698 2.97c-.01.026 3.24.042 7.222.042h7.244l1.796-3.157c.992-1.734 1.85-3.23 1.906-3.323l.104-.167h-7.249z"/>',
	},
	"google-docs": {
		label: "Google Docs",
		viewBox: "0 0 24 24",
		body: '<path fill="currentColor" stroke="none" d="M14.727 6.727H14V0H4.91c-.905 0-1.637.732-1.637 1.636v20.728c0 .904.732 1.636 1.636 1.636h14.182c.904 0 1.636-.732 1.636-1.636V6.727zm-.545 10.455H7.09v-1.364h7.09v1.364zm2.727-3.273H7.091v-1.364h9.818zm0-3.273H7.091V9.273h9.818zM14.727 6h6l-6-6z"/>',
	},
	"google-sheets": {
		label: "Google Sheets",
		viewBox: "0 0 24 24",
		body: '<path fill="currentColor" stroke="none" d="M11.318 12.545H7.91v-1.909h3.41v1.91zM14.728 0v6h6zm1.363 10.636h-3.41v1.91h3.41zm0 3.273h-3.41v1.91h3.41zM20.727 6.5v15.864c0 .904-.732 1.636-1.636 1.636H4.909a1.636 1.636 0 0 1-1.636-1.636V1.636C3.273.732 4.005 0 4.909 0h9.318v6.5zm-3.273 2.773H6.545v7.909h10.91v-7.91zm-6.136 4.636H7.91v1.91h3.41v-1.91z"/>',
	},
	"google-slides": {
		label: "Google Slides",
		viewBox: "0 0 24 24",
		body: '<path fill="currentColor" stroke="none" d="M16.09 15.273H7.91v-4.637h8.18zm1.728-8.523h2.91v15.614c0 .904-.733 1.636-1.637 1.636H4.909a1.636 1.636 0 0 1-1.636-1.636V1.636C3.273.732 4.005 0 4.909 0h9.068v6.75zm-.363 2.523H6.545v7.363h10.91zm-2.728-5.979V6h6.001l-6-6v3.294z"/>',
	},
	"google-gemini": {
		label: "Gemini",
		viewBox: "0 0 24 24",
		body: '<path fill="currentColor" stroke="none" d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68q.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58a12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68q-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96q2.19.93 3.81 2.55t2.55 3.81"/>',
	},
	"notebooklm": {
		label: "NotebookLM",
		viewBox: "0 0 24 24",
		body: '<path fill="currentColor" stroke="none" d="M11.999 3.201C5.372 3.201 0 8.528 0 15.101V20.8h2.212v-.568c0-2.666 2.178-4.827 4.866-4.827s4.866 2.16 4.866 4.827v.568h2.212v-.568c0-3.877-3.17-7.019-7.078-7.019A7.1 7.1 0 0 0 2.992 14.5a7.36 7.36 0 0 1 6.568-4.016c4.057 0 7.347 3.264 7.347 7.287V20.8h2.212v-3.03c0-5.235-4.28-9.481-9.56-9.481a9.56 9.56 0 0 0-6.217 2.28A9.8 9.8 0 0 1 12 5.393c5.406 0 9.788 4.346 9.788 9.707v5.7H24v-5.7c-.001-6.573-5.373-11.9-12.001-11.9Z"/>',
	},
	"moodle": {
		label: "Moodle",
		viewBox: "0 0 24 24",
		body: '<path fill="currentColor" stroke="none" d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12s12-5.373 12-12S18.627 0 12 0m1.135 5.74l.035.123l-2.736 1.99c.369.261.796.61 1.007.844l.077.104C10.23 11.058 7.78 11.857 5.2 10.982l.02-.16h-.002A6.5 6.5 0 0 1 5.16 9.36c-.75-.003-1.53-.04-2.283-.066l-.516.018c-.1.844-.035 2.135-.025 2.322c.35 1.282.298 2.29.295 3.53c-.413-1.004-.9-2.098-.416-3.468l-.01-.318c0-.014-.068-1.153.037-2.062l-.408.013l-.037-.119c3.995-2.37 6.706-2.992 11.338-3.47m1.623 2.514q1.83 0 2.904.807q1.22.9 1.22 2.658v5.685h-2.734v-5.369q0-1.683-1.39-1.683q-1.391 0-1.39 1.683v5.37h-2.735v-5.37q-.001-.776-.293-1.193a5.5 5.5 0 0 0 1.572-1.725q.046.044.088.088q.756-.952 2.758-.951m-9.61 3.234c.932.3 1.862.393 2.737.287a4 4 0 0 0-.01.26v5.37H5.143v-5.686q0-.118.005-.23"/>',
	},
	"google": {
		label: "Google",
		viewBox: "0 0 24 24",
		body: '<path fill="currentColor" stroke="none" d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133c-1.147 1.147-2.933 2.4-6.053 2.4c-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0C5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36c2.16-2.16 2.84-5.213 2.84-7.667c0-.76-.053-1.467-.173-2.053z"/>',
	},
	"github": {
		label: "GitHub",
		viewBox: "0 0 24 24",
		body: '<path fill="currentColor" stroke="none" d="M12 .297c-6.63 0-12 5.373-12 12c0 5.303 3.438 9.8 8.205 11.385c.6.113.82-.258.82-.577c0-.285-.01-1.04-.015-2.04c-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729c1.205.084 1.838 1.236 1.838 1.236c1.07 1.835 2.809 1.305 3.495.998c.108-.776.417-1.305.76-1.605c-2.665-.3-5.466-1.332-5.466-5.93c0-1.31.465-2.38 1.235-3.22c-.135-.303-.54-1.523.105-3.176c0 0 1.005-.322 3.3 1.23c.96-.267 1.98-.399 3-.405c1.02.006 2.04.138 3 .405c2.28-1.552 3.285-1.23 3.285-1.23c.645 1.653.24 2.873.12 3.176c.765.84 1.23 1.91 1.23 3.22c0 4.61-2.805 5.625-5.475 5.92c.42.36.81 1.096.81 2.22c0 1.606-.015 2.896-.015 3.286c0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>',
	},
	"youtube": {
		label: "YouTube",
		viewBox: "0 0 24 24",
		body: '<path fill="currentColor" stroke="none" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814M9.545 15.568V8.432L15.818 12z"/>',
	},
};

const BUILTIN_WRAPPED_CACHE: Record<string, string> = {};
for (const [k, v] of Object.entries(BUILTIN_BRAND_SVGS)) {
	BUILTIN_WRAPPED_CACHE[k] = `<svg viewBox="${v.viewBox}" width="100" height="100">${v.body}</svg>`;
}

/** Caché en memoria de íconos ya registrados en Obsidian para evitar llamadas redundantes a addIcon. */
const registeredIconCache = new Map<string, string>();

/** Caché en memoria de SVGs descargados desde Iconify. */
const iconifySvgCache = new Map<string, string>();

let cachedLucideIcons: string[] | null = null;
let lastRawIconCount = -1;

export function registerIconOnce(iconId: string, svgContent: string): void {
	if (registeredIconCache.get(iconId) === svgContent) return;
	addIcon(iconId, svgContent);
	registeredIconCache.set(iconId, svgContent);
}

export function wrapSvgForObsidian(viewBox: string, innerBody: string): string {
	return `<svg viewBox="${viewBox}" width="100" height="100">${innerBody}</svg>`;
}

export function getBuiltinBrandSvg(key: string): string | null {
	return BUILTIN_WRAPPED_CACHE[key] ?? null;
}

/**
 * Interpreta una URL escrita a medias: si no tiene esquema se le agrega https://
 * y al comparar se ignoran mayúsculas, "www." y el esquema.
 */
export function parseUrlLoose(raw: string): URL | null {
	const trimmed = (raw || "").trim();
	if (!trimmed) return null;
	let candidate = trimmed;
	if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
		candidate = "https://" + candidate.replace(/^\/+/, "");
	}
	try {
		return new URL(candidate);
	} catch {
		return null;
	}
}

export function detectKnownUrlIcon(urlStr: string): { customSvg?: string; lucideIcon?: string } {
	const u = parseUrlLoose(urlStr);
	if (!u) return {};

	const host = u.hostname.toLowerCase();
	const full = (host + u.pathname).toLowerCase();

	if (host === "docs.new" || full.includes("docs.google.com/document")) {
		return { customSvg: BUILTIN_WRAPPED_CACHE["google-docs"], lucideIcon: "file" };
	}
	if (host === "sheets.new" || full.includes("docs.google.com/spreadsheets")) {
		return { customSvg: BUILTIN_WRAPPED_CACHE["google-sheets"], lucideIcon: "sheet" };
	}
	if (host === "slides.new" || full.includes("docs.google.com/presentation")) {
		return { customSvg: BUILTIN_WRAPPED_CACHE["google-slides"], lucideIcon: "presentation" };
	}
	if (host.includes("drive.google.com")) {
		return { customSvg: BUILTIN_WRAPPED_CACHE["google-drive"], lucideIcon: "cloud" };
	}
	if (host.includes("gemini.google.com")) {
		return { customSvg: BUILTIN_WRAPPED_CACHE["google-gemini"], lucideIcon: "sparkle" };
	}
	if (host.includes("notebooklm.google.com")) {
		return { customSvg: BUILTIN_WRAPPED_CACHE["notebooklm"], lucideIcon: "book-a" };
	}
	if (host.includes("moodle")) {
		return { customSvg: BUILTIN_WRAPPED_CACHE["moodle"], lucideIcon: "school" };
	}
	if (host.includes("github.com")) {
		return { customSvg: BUILTIN_WRAPPED_CACHE["github"], lucideIcon: "github" };
	}
	if (host.includes("youtube.com") || host.includes("youtu.be")) {
		return { customSvg: BUILTIN_WRAPPED_CACHE["youtube"], lucideIcon: "video" };
	}
	if (host === "www.google.com" || host === "google.com") {
		return { customSvg: BUILTIN_WRAPPED_CACHE["google"], lucideIcon: "globe" };
	}

	return {};
}

export function getLucideIconForFilePath(filePath: string): string {
	const lower = (filePath || "").toLowerCase().trim();
	if (lower.endsWith(".excalidraw.md") || lower.endsWith(".excalidraw")) return "pen-tool";
	const dotIdx = lower.lastIndexOf(".");
	const ext = dotIdx !== -1 ? lower.slice(dotIdx + 1) : "";

	switch (ext) {
		case "md":
		case "txt":
		case "doc":
		case "docx":
		case "rtf":
		case "odt":
		case "pages":
		case "gdoc":
			return "file";
		case "pdf":
			return "file-text";
		case "epub":
		case "mobi":
			return "book";
		case "mp4":
		case "mov":
		case "webm":
		case "mkv":
		case "avi":
		case "m4v":
			return "video";
		case "mp3":
		case "wav":
		case "m4a":
		case "ogg":
		case "flac":
		case "aac":
			return "music";
		case "xlsx":
		case "xls":
		case "csv":
		case "tsv":
		case "gsheet":
		case "numbers":
			return "sheet";
		case "pptx":
		case "ppt":
		case "gslides":
		case "key":
			return "presentation";
		case "png":
		case "jpg":
		case "jpeg":
		case "gif":
		case "webp":
		case "svg":
		case "bmp":
		case "ico":
			return "image";
		case "zip":
		case "rar":
		case "7z":
		case "tar":
		case "gz":
		case "tgz":
			return "file-archive";
		case "py":
		case "js":
		case "ts":
		case "tsx":
		case "jsx":
		case "html":
		case "htm":
		case "css":
		case "json":
		case "yaml":
		case "yml":
		case "sh":
		case "sql":
		case "java":
		case "c":
		case "cpp":
		case "rs":
		case "go":
		case "ipynb":
			return "file-code";
		case "canvas":
			return "layout-dashboard";
		case "base":
			return "database";
		default:
			return "file";
	}
}

export function sanitizeAndMonochromizeSvg(rawSvg: string): string | null {
	if (!rawSvg || !rawSvg.includes("<")) return null;
	try {
		const parser = new DOMParser();
		const doc = parser.parseFromString(rawSvg.trim(), "image/svg+xml");
		const svgEl = doc.querySelector("svg");
		if (!svgEl) return null;

		let viewBox = svgEl.getAttribute("viewBox");
		if (!viewBox) {
			const w = parseFloat(svgEl.getAttribute("width") || "24") || 24;
			const h = parseFloat(svgEl.getAttribute("height") || "24") || 24;
			viewBox = `0 0 ${w} ${h}`;
		}

		svgEl.querySelectorAll("script, style").forEach((el) => el.remove());

		let usesStroke = false;
		const checkStroke = (el: Element) => {
			const st = el.getAttribute("stroke");
			if (st && st.toLowerCase() !== "none" && st.toLowerCase() !== "transparent") {
				usesStroke = true;
			}
			for (let i = 0; i < el.children.length; i++) {
				checkStroke(el.children[i]);
			}
		};
		checkStroke(svgEl);

		const processElement = (el: Element, isRoot = false) => {
			const fill = el.getAttribute("fill");
			const stroke = el.getAttribute("stroke");

			if (fill) {
				if (fill.toLowerCase() !== "none" && fill.toLowerCase() !== "transparent") {
					el.setAttribute("fill", "currentColor");
				}
			} else if (!isRoot && !usesStroke) {
				el.setAttribute("fill", "currentColor");
			}

			if (stroke) {
				if (stroke.toLowerCase() !== "none" && stroke.toLowerCase() !== "transparent") {
					el.setAttribute("stroke", "currentColor");
				}
			} else if (!isRoot && !usesStroke) {
				el.setAttribute("stroke", "none");
			}

			if (el.hasAttribute("style")) {
				const style = el.getAttribute("style") || "";
				const cleaned = style
					.replace(/fill\s*:\s*(?!none|transparent)[^;]+/gi, "fill:currentColor")
					.replace(/stroke\s*:\s*(?!none|transparent)[^;]+/gi, "stroke:currentColor");
				el.setAttribute("style", cleaned);
			}
			for (let i = 0; i < el.children.length; i++) {
				processElement(el.children[i], false);
			}
		};

		processElement(svgEl, true);

		const innerHtml = svgEl.innerHTML.trim();
		if (usesStroke) {
			const sw = svgEl.getAttribute("stroke-width") || "2";
			const slc = svgEl.getAttribute("stroke-linecap") || "round";
			const slj = svgEl.getAttribute("stroke-linejoin") || "round";
			return `<svg viewBox="${viewBox}" width="100" height="100" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="${slc}" stroke-linejoin="${slj}">${innerHtml}</svg>`;
		}

		return `<svg viewBox="${viewBox}" width="100" height="100" fill="currentColor" stroke="none">${innerHtml}</svg>`;
	} catch {
		return null;
	}
}

export async function searchOnlineMonochromeIcons(query: string, limit = 96): Promise<string[]> {
	const q = query.trim();
	if (!q) return [];
	try {
		const url = `https://api.iconify.design/search?query=${encodeURIComponent(q)}&limit=${limit}&palette=false`;
		const res = await requestUrl({ url, method: "GET" });
		if (res.status === 200 && res.json && Array.isArray(res.json.icons)) {
			return res.json.icons as string[];
		}
	} catch {
		// Ignorar errores de red
	}
	return [];
}

export async function fetchIconifySvg(iconId: string): Promise<string | null> {
	const cached = iconifySvgCache.get(iconId);
	if (cached) return cached;
	try {
		const colonIdx = iconId.indexOf(":");
		if (colonIdx <= 0) return null;
		const prefix = iconId.slice(0, colonIdx);
		const name = iconId.slice(colonIdx + 1);
		if (!prefix || !name) return null;
		const url = `https://api.iconify.design/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg`;
		const res = await requestUrl({ url, method: "GET" });
		if (res.status === 200 && res.text) {
			const clean = sanitizeAndMonochromizeSvg(res.text);
			if (clean) {
				iconifySvgCache.set(iconId, clean);
				return clean;
			}
		}
	} catch {
		// Ignorar
	}
	return null;
}

export async function resolveAutoIconForUrl(urlStr: string): Promise<{
	iconSource: "custom-svg" | "lucide" | "online";
	customSvg?: string;
	lucideIcon?: string;
	onlineKey?: string;
}> {
	const known = detectKnownUrlIcon(urlStr);
	if (known.customSvg) {
		return { iconSource: "custom-svg", customSvg: known.customSvg, lucideIcon: known.lucideIcon || "globe" };
	}
	if (known.lucideIcon) {
		return { iconSource: "lucide", lucideIcon: known.lucideIcon };
	}

	const parsed = parseUrlLoose(urlStr);
	if (parsed) {
		const parts = parsed.hostname.replace(/^www\./i, "").split(".");
		const domainKeyword = parts[0];
		if (domainKeyword && domainKeyword.length >= 2) {
			const key = `simple-icons:${domainKeyword.toLowerCase()}`;
			const directSvg = await fetchIconifySvg(key);
			if (directSvg) {
				return { iconSource: "online", customSvg: directSvg, lucideIcon: "globe", onlineKey: key };
			}
		}
	}

	return { iconSource: "lucide", lucideIcon: "globe" };
}

export function getOrRegisterItemIconId(item: RibbonBookmarkItem): string {
	if (item.type === "separator") {
		return "";
	}
	if ((item.iconSource === "custom-svg" || item.iconSource === "online") && item.customSvg) {
		const customId = `rb-custom-icon-${item.id}`;
		registerIconOnce(customId, item.customSvg);
		return customId;
	}
	if (item.iconSource === "lucide" && item.lucideIcon) {
		return item.lucideIcon;
	}
	if (item.type === "folder") {
		return item.lucideIcon || "folder";
	}
	if (item.type === "file") {
		return getLucideIconForFilePath(item.filePath || item.title);
	}
	if (item.type === "url" && item.url) {
		const known = detectKnownUrlIcon(item.url);
		if (known.customSvg) {
			const customId = `rb-auto-icon-${item.id}`;
			registerIconOnce(customId, known.customSvg);
			return customId;
		}
		if (known.lucideIcon) {
			return known.lucideIcon;
		}
	}
	return item.lucideIcon || "globe";
}

export function getAllObsidianLucideIcons(): string[] {
	const rawIds = getIconIds();
	if (cachedLucideIcons && rawIds.length === lastRawIconCount) {
		return cachedLucideIcons;
	}
	const result: string[] = [];
	for (let i = 0; i < rawIds.length; i++) {
		const id = rawIds[i];
		if (
			id.startsWith("rb-custom-icon-") ||
			id.startsWith("rb-auto-icon-") ||
			id.startsWith("rb-saved-custom-") ||
			id.startsWith("rb-brand-") ||
			id.startsWith("rb-net-")
		) {
			continue;
		}
		result.push(id.startsWith("lucide-") ? id.slice(7) : id);
	}
	cachedLucideIcons = result;
	lastRawIconCount = rawIds.length;
	return result;
}
