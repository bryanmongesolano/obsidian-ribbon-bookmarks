# Publishing Ribbon Bookmarks to the community directory

Repository: https://github.com/bryanmongesolano/obsidian-ribbon-bookmarks

## Current state

- [x] Public GitHub repository
- [x] `LICENSE` (MIT), `README.md`, `manifest.json`, `versions.json`
- [x] Clean run of Obsidian's official linters (`npm run lint`)
- [x] No telemetry, no personal data, no `console` output
- [x] No hard dependency on other plugins (they are detected and delegated to)
- [x] `package-lock.json` committed so the build is reproducible
- [x] GitHub Action that builds, attests provenance and publishes the release

## What the review validates

| Requirement | Status |
| --- | --- |
| Public repository with `manifest.json` at the root | Done |
| `versions.json` containing the current version | Done |
| Release tag matching `version` in the manifest exactly | Done |
| The release ships `main.js`, `manifest.json` and `styles.css` | Done |
| `id` in kebab-case matching the plugin folder name | `ribbon-bookmarks` |
| The `description` avoids the words "Obsidian" and "plugin" | Done |
| Only public APIs are used, with fallbacks | Done |
| No network access except the optional icon search | Done |
| Build provenance attestations for the release assets | Done |

## Known review recommendations

These are advisory, not blocking:

- **Vault enumeration.** The file picker calls `vault.getFiles()` to let the user search their own files. It only runs while the user is typing a path in the new-item dialog.
- **Broad network requests.** The online icon search contacts `api.iconify.design`, and the site logo lookup does the same. Both are user triggered.

## Manual step in the portal (done by the maintainer)

Submissions are no longer made through a pull request; they go through the portal:

1. Sign in at **https://community.obsidian.md** with the Obsidian account.
2. In the profile, link the GitHub account (`bryanmongesolano`).
3. In the sidebar go to **Plugins** → **New plugin**.
4. Paste the repository URL: `https://github.com/bryanmongesolano/obsidian-ribbon-bookmarks`
5. Accept the developer policies and confirm ongoing support.
6. Submit.

After submitting:

- Address any automated review feedback in the portal, then publish a new release so it is scanned again.
- Wait for the manual review, which usually takes a few days.
- Once approved, the plugin can be installed from **Settings → Community plugins → Browse**.

## Publishing future releases

1. Bump `version` in `manifest.json`, `package.json` and add the matching entry to `versions.json`.
2. Build and deploy locally:

```bash
cd ~/Proyectos/obsidian-plugins/ribbon-bookmarks
OBSIDIAN_VAULT_PLUGINS="<path-to-vault>/.obsidian/plugins" npm run deploy
```

3. Commit and push to `main`.
4. Create and push the tag that matches the new version:

```bash
git tag 1.3.1
git push origin 1.3.1
```

The GitHub Action compiles the plugin, attaches `main.js`, `manifest.json` and `styles.css` to the release, and generates build provenance attestations.
