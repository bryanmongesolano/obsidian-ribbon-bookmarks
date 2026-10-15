# Publicar Ribbon Bookmarks en el directorio comunitario

Repo: https://github.com/bryanmongesolano/obsidian-ribbon-bookmarks

## Estado actual

- [x] Repositorio público en GitHub
- [x] `LICENSE` (MIT), `README.md` bilingüe, `manifest.json`, `versions.json`
- [x] Sin telemetría, sin datos personales, sin `console.log`
- [x] Sin dependencias de otros plugins (detecta y delega)
- [x] GitHub Action de release en `.github/workflows/release.yml`
- [x] Release publicado con `main.js`, `manifest.json` y `styles.css` adjuntos

## Requisitos que valida la revisión de Obsidian

| Requisito | Estado |
| --- | --- |
| Repositorio público con `manifest.json` en la raíz | Cumplido |
| `versions.json` con la versión actual | Cumplido |
| Release cuyo tag coincida exactamente con `version` del manifest | Cumplido |
| El release incluye `main.js`, `manifest.json` y `styles.css` | Cumplido |
| `id` en kebab-case igual al nombre del plugin | `ribbon-bookmarks` |
| La `description` no menciona "Obsidian" ni "plugin" | Cumplido |
| Sin uso de APIs internas no documentadas sin respaldo | Cumplido (todo con `try/catch` y respaldo) |
| Sin acceso a red salvo la búsqueda opcional de íconos | Cumplido |

## Paso manual en el portal (lo hace Bryan)

El envío ya no se hace por Pull Request. Se hace en el portal:

1. Entrar a **https://community.obsidian.md** con la cuenta de Obsidian.
2. En el perfil, vincular la cuenta de GitHub (`bryanmongesolano`).
3. En la barra lateral, ir a **Plugins** → **New plugin**.
4. Pegar la URL del repositorio: `https://github.com/bryanmongesolano/obsidian-ribbon-bookmarks`
5. Aceptar las políticas de desarrollador y confirmar el soporte continuo del plugin.
6. Enviar.

Después del envío:

- Atender los comentarios de la revisión automática en el portal.
- Esperar la revisión manual (normalmente varios días).
- Una vez aprobado, el plugin se puede instalar desde **Settings → Community plugins → Browse**.

## Publicar versiones futuras

1. Subir `version` en `manifest.json` y agregar la entrada en `versions.json`.
2. Subir la misma `version` en `package.json`.
3. Compilar y desplegar en local:

```bash
cd ~/Proyectos/obsidian-plugins/ribbon-bookmarks
OBSIDIAN_VAULT_PLUGINS="<ruta-al-vault>/.obsidian/plugins" npm run deploy
```

4. Commit y push a `main`.
5. Crear y empujar el tag con la misma versión:

```bash
git tag 1.2.1
git push origin 1.2.1
```

La GitHub Action compila y adjunta `main.js`, `manifest.json` y `styles.css` al release automáticamente.
