# Islandsun browser extensions

Portal Workspace, Revenue Extractor and AutoFeedback for desktop Chrome and Edge. The website includes features, downloads, installation and update instructions.

The default portal is `http://apps.islandsunindonesia.com:81`. All three extensions also accept `http://192.168.0.22:81` when the user opens it. Page actions, session checks and background offline capture use that selected session; neither connection failures nor default launch links switch to the IP address. Workspace still opens its saved offline copy when the domain fails. Archive ownership remains account based across both addresses.

Runtime sources stay in the three named extension folders. Load a folder containing `manifest.json` as an unpacked extension for local development. Keep that path stable to retain the extension's local settings and saved offline copies.

Shared design assets come from the sibling `isi/family` package. Synchronize them with `node ../isi/family-tools/sync.mjs`, then `node tools/sync-extensions.mjs`. The tools reject conflicting local changes. Regenerate the update feed with `node tools/extension-versions.mjs` after changing extension versions.

For publication, install the pinned tools with `npm ci --prefix tools/site-build --ignore-scripts` and run `node tools/site-build/build.mjs`. The allowlist in `site-build.json` produces a minified site and three ZIP downloads under ignored `dist/`. GitHub Pages publishes this output. Developer notes, diagnostics, source responses, screenshots and obsolete prototypes are not published.

Portal Workspace's offline copy is read only. It requires password unlock and preserves account boundaries. An ordinary Sample or TIR Save opens its uniquely identified detail page in the same tab; the user submits through the portal's own Submit action. There is no combined Save & Submit workflow. Only test live submissions using genuine, specifically authorized business requests.
