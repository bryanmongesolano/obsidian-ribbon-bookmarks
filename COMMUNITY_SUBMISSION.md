# Submit Ribbon Bookmarks to the community directory

Repo: https://github.com/bryanmongesolano/obsidian-ribbon-bookmarks

## Requirements already satisfied in this repo

- [x] `LICENSE`, `README.md`, `manifest.json`, `versions.json` on `main`
- [x] GitHub release whose tag matches the `version` in `manifest.json`, with `main.js`, `manifest.json` and `styles.css` attached
- [x] No telemetry, no hardcoded user data, no network calls except the optional icon search

## Steps for the maintainer (browser)

1. Sign in at https://community.obsidian.md with the Obsidian account.
2. Profile → link the GitHub account (`bryanmongesolano`).
3. Sidebar → **Plugins** → **New plugin**.
4. Repository URL: `https://github.com/bryanmongesolano/obsidian-ribbon-bookmarks`
5. Accept the developer policies and confirm ongoing support.
6. Submit.

## After submission

- Address automated review feedback in the portal.
- Wait for manual review (usually several days).
- Once approved it can be installed from **Settings → Community plugins → Browse**.

## Future releases

1. Bump `version` in `manifest.json` and add the entry to `versions.json`.
2. Commit and push to `main`.
3. Create and push the matching tag:

```bash
git tag 1.1.1
git push origin 1.1.1
```

The GitHub Action builds and uploads `main.js`, `manifest.json` and `styles.css` to the release.
