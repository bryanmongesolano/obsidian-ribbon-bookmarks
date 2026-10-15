# Ribbon Bookmarks

A bookmark bar inside the left ribbon of Obsidian: web links, any kind of file, nested folders, separators, drag & drop and flat monochrome icons.

Una barra de marcadores dentro de la barra lateral izquierda de Obsidian: enlaces web, cualquier tipo de archivo, carpetas anidadas, separadores, arrastrar y soltar e íconos monocromáticos planos.

## Features / Funcionalidades

- **Web links** open in whichever browser plugin is actually enabled in the vault (Surfing, the built-in Web viewer, or the system browser). The plugin never hardcodes a browser.
- **Any file** can be pinned: notes, PDFs, canvas, Excalidraw, Office documents, video, audio, archives.
- **Folders**: drop one item on top of another to group them into a folder. Folders nest infinitely and open in cascading side menus.
- **Separators** to visually group the ribbon.
- **Drag & drop** onto the ribbon: drag a tab from the tab bar, a link from a page, or files/folders from the vault or from your computer.
- **Flat monochrome icons**: Lucide icons, built-in vector brand logos, online SVG search (Iconify), or your own `.svg` files — always rendered with `currentColor`.
- **i18n**: English and Spanish.

- **Enlaces web** se abren en el navegador que realmente esté activo en la bóveda (Surfing, Web viewer nativo o el navegador del sistema). El plugin nunca fija un navegador.
- **Cualquier archivo**: notas, PDF, canvas, Excalidraw, documentos de Office, video, audio, comprimidos.
- **Carpetas**: arrastra un ítem sobre otro para agruparlos. Las carpetas se anidan sin límite y se abren en menús laterales en cascada.
- **Separadores** para agrupar visualmente la barra.
- **Arrastrar y soltar** sobre la barra: una pestaña de la barra superior, un enlace de una página, o archivos y carpetas de la bóveda o de tu equipo.
- **Íconos monocromáticos planos**: iconos de Lucide, logos vectoriales integrados, búsqueda online de SVG (Iconify), o tus propios archivos `.svg` — siempre con `currentColor`.
- **Multi-idioma**: inglés y español.

## Installation / Instalación

### Community plugins

1. Open **Settings → Community plugins**.
2. Turn off **Restricted mode** if needed, then **Browse**.
3. Search for **Ribbon Bookmarks** and install.
4. Enable it and reload.

### Manual

1. Download `main.js`, `manifest.json` and `styles.css` from the latest release.
2. Create `.obsidian/plugins/ribbon-bookmarks/` in your vault and place the three files there.
3. Enable the plugin in **Settings → Community plugins**.

## Usage / Uso

| Action | Result |
| --- | --- |
| Left click an item | Opens the link or file |
| Middle click | Opens in a new tab |
| Left click a folder | Toggles its content menu |
| Right click the ribbon (empty space) | Add item, add separator, and native ribbon options |
| Right click an item | Open in new tab, open externally, modify, delete |
| Drag an item onto another item's center | Creates a folder (or moves it inside an existing one) |
| Drag an item between two items | Reorders it (a purple line shows the drop position) |
| Hover over a folder while dragging | Expands it after ~350 ms so you can drop inside |

## Development / Desarrollo

```bash
npm install
npm run dev      # watch build
npm run build    # type-check + production build
npm run deploy   # build + copy to the local vault
```

`npm run deploy` copies `manifest.json`, `main.js` and `styles.css` into a local vault path. Edit the `deploy` script in `package.json` to point at your own vault.

## Compatibility / Compatibilidad

- `minAppVersion`: 1.8.0
- Tab behavior is inherited from the vault: if the community plugin **Open Tab Settings** is enabled it is respected, otherwise the native behavior is used.
- Browser rendering is inherited from the vault: **Surfing** → built-in **Web viewer** → system browser.

## License / Licencia

MIT
