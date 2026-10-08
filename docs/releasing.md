# Releasing

Codex Pocket uses one [Semantic Versioning](https://semver.org/) version across the root and all four workspace packages. Tags are annotated and named `v<version>`. Workspace packages remain `private: true`; the supported distributions are the macOS app and experimental Linux x86_64 host archive, not npm.

`make app` and the **Build unsigned macOS app** workflow produce local development builds. Versioned releases starting after v0.1.0 require a Developer ID Application signature, Apple notarization, and a DMG. Pushing a tag runs CI and creates a draft Release with a checked Linux archive and checksum. Signing credentials stay in the maintainer's local Keychain and are never sent to GitHub Actions.

## Signing setup

1. Install an **organization-owned Developer ID Application** certificate and private key in the signing Mac's Keychain. Store an App Store Connect API key as a `notarytool` Keychain profile; see `xcrun notarytool help store-credentials`. Do not commit the certificate, private key, API key, Keychain profile, team ID, or personal contact information.
2. Set `APPLE_KEYCHAIN_PROFILE` to that local profile's name in your shell. The release script selects the unique Developer ID Application identity in the login Keychain. If more than one exists, set `CODEX_POCKET_TEAM_ID` locally to select the organization's certificate. It rejects Apple ID passwords, API key environment variables, and exported certificate files.
3. The organization name and Team ID in the signature are visible to everyone who downloads the app. An individual Developer ID certificate would expose the person's name; no packaging option can hide the signing identity.

## Before tagging

Before making a private repository public, review every branch and tag,
commit and tag identities, issue and pull request comments, screenshots,
Actions logs and artifacts, and Release assets. Editing the current tree
does not remove personal data from Git history. Back up the repository
before rewriting history, and coordinate changes to published refs.
GitHub pull request refs and cached commits can retain the original history
after a force push; resolve their exposure before changing visibility.
Keep existing Releases as drafts until their packaged license notices and
public signing identity have been reviewed. Publish rebuilt artifacts under
a new version instead of replacing assets under an existing published tag.

1. Review Git history and the planned artifact for credentials, personal data, and license obligations. Check `git config user.name` and `git config user.email` locally before committing; use a GitHub noreply address and a nonpersonal display name if the repository may become public. Run `gitleaks git --redact .` and `gitleaks dir --redact .`; investigate findings beyond the self-signed `*.lan.example.test` test key.
2. Update all five `package.json` versions and move notes from `## [Unreleased]` to a dated `## [<version>] - YYYY-MM-DD` heading in `CHANGELOG.md`. Add a new `## [Unreleased]` heading above it. Keep both READMEs aligned.
3. Run `pnpm install --frozen-lockfile`, `pnpm release:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm package:linux`. On Linux x86_64, run `pnpm package:linux:check` against the extracted archive. Test pairing, reconnecting, approvals, and desktop linking with a supported Codex CLI.
4. Commit and push the release changes to `main`, then run `make release-dmg` on an Apple silicon Mac. It requires a clean checkout at `origin/main`, dated release notes, the selected organization certificate, and the Keychain profile. It builds into `packages/desktop/release/signed` without replacing the development app, signs and notarizes the app and DMG, checks Gatekeeper and the stapled tickets, opens the DMG to inspect its app and Applications shortcut, then writes a SHA-256 file. Missing credentials or a failed check stop the build.

## Draft and publish

After the release commit is on `main`, push an annotated version tag. CI checks that the tag matches all package versions, points to a commit on `main`, and has dated changelog notes; it then creates a draft Release with a checked Linux archive and checksum.

```bash
git tag -a v0.1.1 -m "Release v0.1.1"
git push origin v0.1.1
```

Use the actual version. Upload the two locally verified files from `packages/desktop/release/signed` to the draft with `gh release upload v0.1.1 <dmg> <dmg>.sha256`. Download the draft assets again, check their SHA-256 and the app's signature and notarization, and test first launch from a browser download on a clean Apple silicon Mac. Review the notes and publish with `gh release edit v0.1.1 --draft=false`. Do not replace assets under an already published tag; publish a new patch version instead.

## Linux artifact checks

The Linux packager includes no Node/Codex binaries or Electron and collects host/PWA production dependency notices. CI verifies the extracted archive outside the checkout: its launcher (including a symlink), static PWA, authentication, pairing, daemon RPC, restart persistence and rejection of desktop commands. Before publishing, download the Linux archive and checksum again, run `sha256sum -c`, inspect the legal notices and validate on a real Linux host with a signed-in Codex CLI. Preserve existing host state and the public origin during upgrades. Document which architectures, distributions and phone devices were tested; a unit syntax check does not prove systemd boot recovery.
