# GitHub Pages deployment

The GitHub Pages site is a **project site** at `https://maniator.github.io/MauriceCraft/`. Vite builds assets with the `/MauriceCraft/` base and outputs static files to `dist/`.

## Repository setup

1. On **maniator/MauriceCraft**, open **Settings → Pages**.
2. Change **Build and deployment → Source** from **Deploy from a branch** to **GitHub Actions**.
3. Allow the `Deploy Pages` workflow to publish after the main-branch build checks pass.
4. Browse to `https://maniator.github.io/MauriceCraft/` and verify that the menu starts and a saved world can load.

**Do not select `dist/` as a Pages branch directory.** It is generated, not committed. While branch publishing remains enabled, the source HTML will not work as a built Vite site, so switch to Actions once the workflow is committed. The Pages settings are not changed by source commits.

The site must remain at the same origin/path for existing browser saves to be reachable. If deploying to a custom domain later, adjust the Vite base and be aware that IndexedDB storage does not transfer to the new origin automatically.
