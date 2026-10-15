[![Downloads](https://img.shields.io/github/downloads/bryanmongesolano/obsidian-ribbon-bookmarks/total?style=for-the-badge&logo=obsidian&color=7c3aed)](https://community.obsidian.md/plugins/ribbon-bookmarks)
[![Release](https://img.shields.io/github/v/release/bryanmongesolano/obsidian-ribbon-bookmarks?style=for-the-badge)](https://github.com/bryanmongesolano/obsidian-ribbon-bookmarks/releases)
[![License](https://img.shields.io/badge/license-MIT-7c3aed?style=for-the-badge)](LICENSE)
[![Review](https://img.shields.io/badge/review-passed-22c55e?style=for-the-badge)](https://community.obsidian.md/plugins/ribbon-bookmarks)

# Ribbon Bookmarks

A bookmark bar inside the left ribbon of Obsidian: web links, any kind of file, nested folders, separators, drag and drop, and flat monochrome icons.

![Ribbon Bookmarks](assets/social-preview.png)

## Features

- **Web links** open in whichever browser plugin is actually enabled in the vault: Surfing, the built-in Web viewer, or the system browser. The plugin never hardcodes a browser, and it never hardcodes tab behavior either — it inherits whatever the vault is configured to do.
- **Any file** can be pinned: notes, PDFs, canvas, Excalidraw, Office documents, video, audio and archives.
- **Folders**: drop one item on top of another to group them. Folders nest without limit and open in cascading side menus.
- **Separators** to group the ribbon visually.
- **Drag and drop** onto the ribbon: drag a tab from the tab bar, a link from a web page, or files and folders from the vault or from your computer.
- **Flat monochrome icons**: Lucide icons, built-in vector logos, an online SVG search, or your own `.svg` files — always rendered with `currentColor` so they match any theme.
- **English and Spanish** interface, following the app language by default.

## Installation

### From the community directory

[![Install Ribbon Bookmarks](https://img.shields.io/badge/Install-Ribbon%20Bookmarks-7c3aed?style=for-the-badge)](https://obsidian.md/plugins?id=ribbon-bookmarks)

Or, from inside the app:

1. Open **Settings → Community plugins**.
2. Turn off **Restricted mode** if needed, then **Browse**.
3. Search for **Ribbon Bookmarks** and install it.
4. Enable it and reload.

### Via BRAT (useful before the directory listing goes live)

1. Install the community plugin [BRAT](https://github.com/TfTHacker/obsidian42-brat).
2. Run the command **BRAT: Add a beta plugin for testing**.
3. Enter `bryanmongesolano/obsidian-ribbon-bookmarks`.
4. Enable **Ribbon Bookmarks** in **Settings → Community plugins**.

BRAT keeps it updated from the GitHub releases automatically.

### Manual

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/bryanmongesolano/obsidian-ribbon-bookmarks/releases/latest).
2. Create `.obsidian/plugins/ribbon-bookmarks/` in your vault and place the three files there.
3. Enable the plugin in **Settings → Community plugins**.

## Usage

| Action | Result |
| --- | --- |
| Left click an item | Opens the link or file |
| Middle click | Opens in a new tab |
| Left click a folder | Toggles its content menu |
| Right click the ribbon (empty space) | Add item, add separator, and the native ribbon options |
| Right click an item | Open in new tab, open externally, modify, delete |
| Drag an item onto another item's center | Creates a folder, or moves it inside an existing one |
| Drag an item between two items | Reorders it, with a purple line showing the drop position |
| Hover over a folder while dragging | Expands it after about 350 ms so you can drop inside |

The only setting is the interface language.

## Development

```bash
npm install
npm run dev      # watch build
npm run lint     # ESLint + Stylelint, using Obsidian's official rules
npm run build    # type check + production build
npm run deploy   # build, then copy into a local vault
```

`npm run deploy` copies `manifest.json`, `main.js` and `styles.css` into a local vault. Set `OBSIDIAN_VAULT_PLUGINS` to the `.obsidian/plugins` folder of your vault before running it:

```bash
OBSIDIAN_VAULT_PLUGINS="/path/to/vault/.obsidian/plugins" npm run deploy
```

## Compatibility

- `minAppVersion`: 1.13.0
- **Tab behavior** is inherited from the vault: when the community plugin **Open Tab Settings** is enabled its configuration is respected, otherwise Obsidian's native behavior is used.
- **Browser rendering** is inherited from the vault: **Surfing** → built-in **Web viewer** → system browser.
- The plugin requests no telemetry. The only network requests are the optional icon search and the site logo lookup, both triggered by the user.

## License

MIT
