export type LangSetting = "auto" | "es" | "en";

export type ResolvedLang = "es" | "en";

const ES = {
	ribbonAddItem: "Agregar ítem",
	ribbonAddSeparator: "Agregar separador",
	ribbonBarOptions: "Opciones de barra",
	ctxOpenNewTab: "Abrir en nueva pestaña",
	ctxOpenExternal: "Abrir en navegador externo",
	ctxModify: "Modificar",
	ctxDelete: "Eliminar",
	modalNewItem: "Nuevo ítem",
	modalEditItem: "Modificar ítem",
	modalNewFolder: "Nueva carpeta",
	modalEditFolder: "Modificar carpeta",
	fieldName: "Nombre",
	helpName: "Nombre que se mostrará al pasar el cursor en la barra o dentro de una carpeta.",
	fieldType: "Tipo de elemento",
	helpType: "Elige si este acceso directo apunta a una página web o a un archivo.",
	optionUrl: "URL",
	optionFile: "Archivo",
	fieldUrl: "URL",
	helpUrl: "Dirección de la página web a abrir.",
	urlPlaceholder: "https://",
	fieldFile: "Archivo",
	helpFile: "Ruta del archivo que deseas abrir.",
	filePlaceholder: "Ruta del archivo o buscar en el Vault...",
	browseMac: "Buscar en Mac",
	tabIcons: "Íconos",
	tabOnline: "Buscar en internet",
	iconSearchPlaceholder: "Buscar ícono...",
	iconSearch: "Buscar",
	addSvg: "Agregar SVG",
	cancel: "Cancelar",
	add: "Agregar",
	save: "Guardar",
	delete: "Eliminar",
	noticeUrlRequired: "Ingresa una URL.",
	noticeFileRequired: "Selecciona o escribe la ruta del archivo.",
	noticeSvgInvalid: "El archivo SVG no es válido.",
	noticeFileNotFound: "No se encontró el archivo: {path}",
	settingsTitle: "Ribbon Bookmarks",
	settingsActions: "Acciones",
	settingsAddItem: "+ Agregar ítem",
	settingsAddSeparator: "+ Agregar separador",
	settingsLanguage: "Idioma",
	settingsLanguageDesc: "Idioma de la interfaz de este plugin.",
	settingsLangAuto: "Automático (según Obsidian)",
	langEs: "Español",
	langEn: "English",
	defaultFolderName: "Nueva carpeta",
	defaultSeparator: "Separador",
	vaultFileSearchPlaceholder: "Buscar archivo...",
	noResults: "Sin resultados",
};

const EN: Record<keyof typeof ES, string> = {
	ribbonAddItem: "Add item",
	ribbonAddSeparator: "Add separator",
	ribbonBarOptions: "Bar options",
	ctxOpenNewTab: "Open in new tab",
	ctxOpenExternal: "Open in external browser",
	ctxModify: "Modify",
	ctxDelete: "Delete",
	modalNewItem: "New item",
	modalEditItem: "Edit item",
	modalNewFolder: "New folder",
	modalEditFolder: "Edit folder",
	fieldName: "Name",
	helpName: "Name shown on hover in the ribbon or inside a folder.",
	fieldType: "Element type",
	helpType: "Choose whether this shortcut points to a web page or a file.",
	optionUrl: "URL",
	optionFile: "File",
	fieldUrl: "URL",
	helpUrl: "Address of the web page to open.",
	urlPlaceholder: "https://",
	fieldFile: "File",
	helpFile: "Path of the file you want to open.",
	filePlaceholder: "File path or search the vault...",
	browseMac: "Browse Mac",
	tabIcons: "Icons",
	tabOnline: "Search online",
	iconSearchPlaceholder: "Search icon...",
	iconSearch: "Search",
	addSvg: "Add SVG",
	cancel: "Cancel",
	add: "Add",
	save: "Save",
	delete: "Delete",
	noticeUrlRequired: "Enter a URL.",
	noticeFileRequired: "Select or type the file path.",
	noticeSvgInvalid: "The SVG file is not valid.",
	noticeFileNotFound: "File not found: {path}",
	settingsTitle: "Ribbon Bookmarks",
	settingsActions: "Actions",
	settingsAddItem: "+ Add item",
	settingsAddSeparator: "+ Add separator",
	settingsLanguage: "Language",
	settingsLanguageDesc: "Interface language for this plugin.",
	settingsLangAuto: "Automatic (follow Obsidian)",
	langEs: "Español",
	langEn: "English",
	defaultFolderName: "New folder",
	defaultSeparator: "Separator",
	vaultFileSearchPlaceholder: "Search file...",
	noResults: "No results",
};

const DICTS: Record<ResolvedLang, Record<keyof typeof ES, string>> = { es: ES, en: EN };

export type TKey = keyof typeof ES;

export type TFn = (key: TKey, vars?: Record<string, string | number>) => string;

export function resolveLang(setting: LangSetting, obsidianLang: string): ResolvedLang {
	if (setting === "es" || setting === "en") return setting;
	return (obsidianLang || "").toLowerCase().startsWith("es") ? "es" : "en";
}

export function createTranslator(lang: ResolvedLang): TFn {
	const dict = DICTS[lang] || DICTS.en;
	return (key, vars) => {
		let value = dict[key] ?? DICTS.en[key] ?? String(key);
		if (vars) {
			for (const [k, v] of Object.entries(vars)) {
				value = value.split(`{${k}}`).join(String(v));
			}
		}
		return value;
	};
}
