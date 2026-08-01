# KCxLabs desktop publishing guide

## Convoy Downloads

The public site Downloads section includes a Convoy card. **Open Web App** launches the continuously hosted foreground web companion at `https://convoy.kcxlabs.org`; it does not require Metro, an Expo tunnel, localhost, or a PC server.

Android remains labeled **Development Preview** until a real signed APK is copied into the public release area and its version, byte size, and SHA-256 checksum are verified. Never publish an Android App Bundle (`.aab`) as a direct tester download. When a verified APK is available, testers download it and approve Android sideload installation.

iPhone remains labeled **iPhone beta coming soon** until an Apple-reviewed external TestFlight build and real public invitation URL exist. Never offer a direct `.ipa`. Once available, testers install Apple's TestFlight app, open the public invitation link, and install Convoy through TestFlight. The hosted web app remains the alternative on both platforms and does not provide native push, background GPS, or reliable screen-off tracking.

KCxLabs is the local publishing workspace for the KCx Labs website. It does not deploy automatically. Any action that writes website metadata, copies a release file, or overwrites theme files is previewed or confirmed first.

## Start KCxLabs

1. Open PowerShell in `D:\KCxProjects\KCxLabs`.
2. Run `npm.cmd run dev`.
3. Wait for the **KCx Labs** Electron window to open.
4. Use `npm.cmd run dev:website` only when you need the website without the desktop application.

The left navigation controls the modules. The status text at its bottom reports the latest operation result.

## Recommended publishing order

1. Scan and register projects.
2. Stage discovered projects for the website and inspect the change preview.
3. Approve website changes only after reviewing additions, removals, and warnings.
4. Prepare a release and run its validation preview.
5. Confirm a release publish only after checking its artifact, version, SHA-256, and metadata effect.
6. Build the website, start a website preview, then check deployment readiness.
7. Deploy to Vercel manually when you are satisfied.

## Dashboard

The Dashboard is a summary only. It shows the registered-project count and the readiness of the local publishing environment. It does not change files or deploy anything.

## Projects

### Register one project manually

1. Open **Projects**.
2. Enter a name, lowercase slug, and real project folder.
3. Optionally add a description.
4. Select **Register project**.

The folder is checked and displayed as `available` or `missing`. A missing path is not scanned. Correct the path before using that project for releases or theme synchronization.

### Browse or drag a project folder

1. Open **Projects** and find **Quick project registration**.
2. Select **Browse project folder**, or drag one folder from File Explorer onto **Drop project folder**.
3. Confirm that the selected path is correct.
4. Select **Register selected folder**.

This is explicit registration: dropping a folder fills the pending selection but does not add it until the registration button is selected.

### Scan a folder tree for projects

1. In **Scan for projects**, select **Choose scan folder**.
2. Select the existing root folder to search.
3. Select **Scan subfolders**.
4. Review each result and its detected marker, such as `package.json`, `build.gradle.kts`, `Cargo.toml`, or `pyproject.toml`.
5. Use **Use candidate** to copy one result into the manual registration form, then select **Register project** if you want it in the local catalog.

The scan searches up to seven levels beneath the chosen root. It skips generated, dependency, virtual-environment, and audit/training directories, including `.git`, `.claude`, `.codex`, `.venv`, `.training`, `node_modules`, `site-packages`, `dist`, `build`, `out`, `.next`, `.vite`, `coverage`, and `fixtures`.

### Add scanned projects to the website

Scanning never changes website metadata by itself.

To add selected candidates:

1. Tick the checkboxes beside the candidates you want.
2. Select **Preview selected projects**.

To stage every discovered candidate:

1. Select **Add all projects to website**.

For either route:

1. Review **Website change preview**.
2. Check the additions, removals, and warnings carefully.
3. Select **Approve website changes** only if they are correct.
4. Confirm the native confirmation dialog.

Before metadata changes, KCxLabs creates a backup in its local application data. The current scan workflow only proposes additions; if a future workflow proposes removals, they will be shown in the same preview and require this same approval step.

## Release Publisher

The **Release Publisher** is a three-step wizard.

1. Open **Release Publisher** and select the project, then select **Continue**.
2. Enter a semantic version such as `1.2.3` and a release title. Browse for a ZIP/EXE/MSI, or drag it onto **Drop release artifact**.
3. Select **Preview before publishing**.
4. Review validation errors, warnings, file size, SHA-256, and planned operations.
5. Select **Publish release** only when the preview passes, then confirm the native dialog.

Publishing copies the artifact into `public/downloads/releases/<project-slug>/`, backs up an existing file before replacing it, updates `src/data/publishing-catalog.json`, and records activity. It does not deploy the website.

If validation fails, correct the project, version, title, or artifact and validate again. Do not publish a failed preview.

## Artifacts

Use **Artifacts** when you need to prepare files before opening the Release Publisher.

1. Select a registered project with an `available` folder.
2. Select **Open project folder** to inspect its real source folder in File Explorer.
3. Select **Create staged ZIP** to create `public/downloads/staged/<project-slug>/<project-slug>-source.zip`.
4. Select **Build executable** only when the project's `package.json` defines a `package`, `make`, or `dist` script.
5. In **Release Publisher**, browse to the staged ZIP or generated EXE, preview it, then publish only after confirmation.

KCxLabs cannot create a trustworthy generic EXE for arbitrary source code. It runs the project’s own configured packaging script and reports when one is not available.

## Patch Import

Patch import is separate from release publishing. It stores a `.patch` or `.diff` file without creating a download release.

1. Open **Patch Import**.
2. Select the target project.
3. Browse for a `.patch` or `.diff`, or drag it onto **Drop patch file**.
4. Select **Preview patch import** and review the file and planned operations.
5. Select **Import patch**, then confirm the native dialog.

Patches are stored under `public/patches/<project-slug>/`. If a file with the same name already exists, KCxLabs backs it up before replacement.

## Website

Select **Build website** to run the normal Vite production build. This validates the website after metadata changes, but it does not deploy.

Use this after approving website changes and after publishing a release.

## Website Preview

1. Open **Website Preview**.
2. Select **Start preview**.
3. Use the displayed local URL to inspect the website in a browser.
4. Review the output shown in the module for errors.
5. Select **Stop preview** when finished.

The website preview is separate from the Electron app and tracks its own local Vite process.

## Deployment

1. Open **Deployment**.
2. Select **Check readiness**.
3. Review the branch, working-tree changes, website build state, and Vercel CLI availability.
4. Resolve any concern before deployment.
5. Deploy through your normal Vercel workflow only after the review.

KCxLabs intentionally does not run preview or production deployments automatically.

## Theme Sync

1. Register the target project first.
2. Open **Theme Sync** and select the target project.
3. Select **Scan** to compare the KCxLabs canonical `theme-engine/` files to the target.
4. Review every `current`, `outdated`, or `missing` result.
5. Select **Sync with backup** only when the target is correct.
6. Confirm the browser-style prompt.

Every existing target file is backed up under `<project-folder>/.kcx-theme-backups/<timestamp>/` before being overwritten. KCxLabs uses its own `theme-engine/`; it has no runtime dependency on the ThemeSync or reference theme-engine projects.

## Release History and Activity

- **Release History** filters activity entries related to releases.
- **Activity** lists build, preview, release, theme-sync, and catalog actions. Select **Refresh** to reload it.

Use these modules to review what the desktop app actually did before committing or deploying.

## Settings

Settings explains the local-only operating boundary. It does not expose secrets and does not send API keys to the renderer.

## Safety checklist

Before approving a metadata change, release, or sync:

1. Confirm every folder path is real and belongs to the intended project.
2. Review the preview; never approve an unexpected addition or removal.
3. Validate a release before publishing it.
4. Build the website after changes.
5. Use Website Preview to inspect the result.
6. Check deployment readiness.
7. Commit and deploy manually when you are satisfied.

## Troubleshooting

| Issue | What to do |
| --- | --- |
| No scan results | Confirm the selected root contains supported manifests and is no more than seven levels above the project. |
| Folder shows `missing` | Update the project to a real, accessible path before proceeding. |
| Website preview will not start | Stop an existing preview, then try again; check the output area for a port or Vite error. |
| Release validation fails | Select a readable non-empty `.exe`, `.msi`, or `.zip`, and provide a registered project, semantic version, and title. |
| Theme sync reports missing/outdated | Inspect the target project and scan again; sync only after reviewing the file states. |
| Deployment is not ready | Resolve working-tree changes or build failures, then run the check again. |
