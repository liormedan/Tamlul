# Task: Sprint S1 — automated, signable release build for Tamlul

**Executor:** Codex (AI coding agent, works in the repo on the user's Windows PC)
**Requested by:** Lior   **Date:** 2026-10-31
**Branch:** `saas` (already checked out and pushed; do not switch, do not merge into `main`)

## Goal
Tamlul is a Windows desktop app: a Tauri 2 shell (Rust, `src-tauri/`) around a local Python/FastAPI
engine (`app/`), shipped as one NSIS installer. Today the installer is built by hand on one machine.
S1 makes a release repeatable: pushing a version tag builds the installer on GitHub Actions, optionally
signs it, and attaches it to a draft GitHub Release. It also makes the version number come from one
place and gives the installer Tamlul's own look. This is the first sprint of the subscription plan
(`HANDOFF.md`, section "תוכנית המנוי"); all work stays on the user's PC, there is no cloud processing.

## Context
- Read first: `HANDOFF.md` (architecture, warnings), `README.md` (developer section), `src-tauri/tauri.conf.json`, `src-tauri/fetch-uv.ps1`, `src-tauri/nsis/Hebrew.nsh`.
- Build today: `CARGO_BUILD_JOBS=2 npx tauri build` -> `src-tauri/target/release/bundle/nsis/Tamlul_<version>_x64-setup.exe` (about 14 MB). `build.beforeBundleCommand` runs `fetch-uv.ps1`, which downloads a pinned `uv.exe` with a SHA-256 check into `src-tauri/bin/` (git-ignored).
- The version `0.1.0` is hard-coded in 5 places: `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (the `tamlul` package), `package.json`, `package-lock.json`, plus `APP_VERSION = "0.1.0"` in `app/server.py` (returned by `GET /api/health`, shown in Settings -> engine).
- The shell starts the engine in `spawn_engine` in `src-tauri/src/lib.rs` (around line 291), passing config as env vars (`TAMLUL_PORT`, `TAMLUL_TOKEN`, `TAMLUL_DATA`, ...).
- The user has **no code-signing certificate yet**. The pipeline must work unsigned today and sign automatically once secrets exist.
- Rust: edition 2024, `rust-version = "1.90"`. A debug `cargo build` once crashed rustc with `STATUS_STACK_BUFFER_OVERRUN`; retrying with `RUST_MIN_STACK=67108864` fixed it. Use `CARGO_BUILD_JOBS=2` locally (the PC runs out of memory otherwise).

## Product — what to deliver
1. **One version source.**
   - `tools/set-version.mjs`: `node tools/set-version.mjs 0.2.0` (also accepts `v0.2.0` and `0.2.0-beta.1`) writes the version to all files above; `node tools/set-version.mjs --check` prints each file's version and exits 1 if they differ. Preserve each file's existing line endings.
   - `src-tauri/src/lib.rs`: pass `TAMLUL_VERSION` (from `env!("CARGO_PKG_VERSION")`) to the engine.
   - `app/server.py`: `APP_VERSION = os.environ.get("TAMLUL_VERSION", "dev")`. Browser/dev mode then reports `dev`. Check nothing else (e.g. `app/static/app.js`) assumes `0.1.0`.
2. **Release workflow** `.github/workflows/release.yml`:
   - Trigger: push of a tag matching `v*`, plus `workflow_dispatch` (build only, no release).
   - `windows-latest`. Steps: checkout, Node 20, Rust stable (>= 1.90) with cargo cache, `node tools/set-version.mjs "$tag"` then `--check`, `npm ci`, `npx tauri build`, verify the installer file name contains the version, compute `SHA256SUMS.txt`, upload both as workflow artifacts, and create a **draft** GitHub Release with `gh release create` using the built-in `GITHUB_TOKEN` (mark it prerelease when the version has a `-` suffix). Prefer `gh` and first-party `actions/*`; pin to major versions; no third-party actions unless unavoidable.
   - Minimal `permissions:` (`contents: write` only on the release job).
3. **Optional code signing**, in the same workflow:
   - If repo secrets `WINDOWS_CERTIFICATE` (base64 PFX) and `WINDOWS_CERTIFICATE_PASSWORD` exist: import the certificate into the runner's cert store and build with a Tauri config override (`--config`) that sets `bundle.windows.certificateThumbprint`, timestamp URL, and digest algorithm, so both `tamlul.exe` and the installer are signed.
   - If they do not exist: build unsigned, and print a visible `UNSIGNED BUILD` warning in the job summary. **This path must be the one you actually test.**
   - Leave a short, commented, disabled example for Azure Trusted Signing via `bundle.windows.signCommand`. Do not add any secret values anywhere.
4. **Basic CI** `.github/workflows/ci.yml` on push and pull request to `main` and `saas`: `node tools/set-version.mjs --check`, `python -m compileall app`, `node --check` on every `app/static/*.js` (not `vendor/`), `cargo check` in `src-tauri`. Keep it under about 5 minutes.
5. **Installer artwork** in Tamlul's look (dark `#15181d` base, teal accent `#15837c`/`#2fb5a9`, the white "ת" mark and sound-wave from `src-tauri/icons/source.svg`):
   - `src-tauri/nsis/sidebar.bmp` (164x314, 24-bit BMP) and `src-tauri/nsis/header.bmp` (150x57, 24-bit BMP), wired in via `bundle.windows.nsis.sidebarImage` and `headerImage`.
   - Generate them with a small reproducible script in `tools/` (use whatever is already available: Python with Pillow in `.venv`, or PowerShell `System.Drawing`; do not add heavy dependencies to the app). Commit the script and the BMPs.
   - No text baked into the images except the "ת" mark (the installer is Hebrew, right-to-left, and text is localized elsewhere).
6. **Docs:** a "Releasing" section in `README.md` (developer part): how to cut a release (`node tools/set-version.mjs X.Y.Z`, commit, `git tag vX.Y.Z`, push the tag), what the workflow does, the two signing secrets, and the unsigned warning. Update `HANDOFF.md`: S1 status and any new warnings you hit.

## Process — how to do it
- **Constraints / do not:**
  - Do not touch engine logic (`app/engine.py`, `media.py`, `ai.py`, `exporters.py`), the UI, or the setup wizard (`setup.rs`, `setup.html`, `setup.js`). The auto-updater is S2, not this sprint.
  - Do not push tags, do not push to `main`, do not merge anything. Do not commit or push at all unless Lior asks; leave the work as uncommitted changes on `saas`. Nothing can be run on GitHub from here, so validate the workflow files locally (YAML parse, `actionlint` if available) and tell Lior exactly what to push to try them.
  - `.env` holds a real API key: never read it into logs, never put it in git, never print it. `data/`, `models/`, `.venv/`, `exports/` are git-ignored; keep them that way.
  - Keep line endings of existing files (`install.bat` must stay CRLF; `src-tauri/nsis/Hebrew.nsh` is UTF-8 without BOM, CRLF). Code, comments, commit messages in English; match the surrounding style and comment density.
  - Do not add npm/pip/cargo dependencies unless there is no way around it, and say so in the report.
- **Inputs & sources:** the files listed in Context; the Tauri 2 docs for `bundle.windows` (NSIS images, `certificateThumbprint`, `signCommand`).
- **Steps:** (1) version script + Rust/Python plumbing; (2) artwork + config; (3) workflows; (4) docs; (5) verify.
- **Verification (all of it, locally):**
  - `node tools/set-version.mjs --check` passes; run the script with `0.1.1` and back to `0.1.0` and check `git diff` is clean afterwards.
  - Build the installer: `CARGO_BUILD_JOBS=2 npx tauri build` (if rustc crashes with `STATUS_STACK_BUFFER_OVERRUN`, set `RUST_MIN_STACK=67108864`). Do the build once with a temporary test version (e.g. `0.1.1-test.1`) to prove the file name and `/api/health` version follow it, then restore `0.1.0`.
  - Look at the installer pages with the existing capture technique (see warning below) and confirm the sidebar/header render correctly in the Hebrew right-to-left layout. Attach the screenshots' paths to the report.
  - Silent-install the build (`/S`), start `tamlul.exe`, confirm `GET /api/health` returns the build's version (use `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` and `scratchpad`-style CDP eval, or read it in Settings -> engine), then close the app. The user's data in `%LOCALAPPDATA%\com.liormedan.tamlul` must survive untouched.

## Performance — how to behave
- **Autonomy:** decide alone on implementation details inside the scope above. Ask Lior before: adding any dependency, changing anything outside the listed files, committing/pushing, or anything touching the installed user data.
- **GUI-test warnings (learned the hard way):**
  - Never send keystrokes to an installer/uninstaller window: it takes the user's typing and once ran the uninstall by itself. Capture it with `PrintWindow`; cancel with `PostMessage(hwnd, WM_COMMAND, IDCANCEL)`.
  - Close apps by PID only, never by window class (a class match once killed an unrelated app).
  - Run at most one instance of the app at a time and close it at the end; the PC has little free memory.
  - Do not kill the user's other processes.
- **When uncertain:** pick the safer default, note it under Assumptions in the report.
- **Reporting:** answer Lior **in Hebrew** (code, paths, commands stay in English), short and without preamble. End with: what was verified and how, what could not be verified (the GitHub Actions run itself), what is uncommitted, branch name, and the exact commands/steps Lior needs to try the workflow. If you commit later at Lior's request, end commit messages with the attribution line he specifies.

## Definition of done
- [ ] `node tools/set-version.mjs --check` passes; one command changes the version everywhere; `GET /api/health` reports the installed build's version.
- [ ] `release.yml` and `ci.yml` parse cleanly; unsigned path verified locally by building with the same commands the workflow runs; signing path written and clearly gated on the two secrets.
- [ ] A locally built installer shows the new sidebar and header, in the Hebrew installer, with screenshots checked.
- [ ] Silent install -> app starts -> health shows the right version -> user data intact.
- [ ] `README.md` "Releasing" section and `HANDOFF.md` updated.
- [ ] Version files are back at `0.1.0`, no secrets or `.env` content in the diff, nothing committed or pushed.
- [ ] Report to Lior in Hebrew with results, open items, and the steps to trigger the first real release.

## Assumptions
- Releases are cut from `main` after a merge, but the workflow itself only cares about the tag.
- The runner is `windows-latest`; the installer is x64 only.
- The installer name stays `Tamlul_<version>_x64-setup.exe` (Tauri default).
- Pre-release versions use a `-` suffix (`0.2.0-beta.1`).

## Open questions
- None blocking. For Lior (not for Codex): buy a code-signing certificate or set up Azure Trusted Signing, and add the two secrets to the repo, so the first public release is signed.
