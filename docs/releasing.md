# Releasing

Codex Pocket uses one [Semantic Versioning](https://semver.org/) version across the root and all four workspace packages. Tags are annotated and named `v<version>`; `0.x` releases may change rapidly, while `-alpha.N`, `-beta.N`, and `-rc.N` mark prereleases. Workspace packages keep `private: true` because the supported distribution is the macOS app, not npm.

The app is currently unsigned and built for Apple silicon. **Package macOS app** is a manual workflow for candidate builds. Pushing a release tag runs tests and macOS packaging, then creates a **draft** GitHub Release with a zip, SHA-256 checksum, and notes from `CHANGELOG.md`. The app's `Contents/Resources/legal` directory includes the project license and third-party license notices. Nothing is published automatically.

## Before tagging

1. Review the full Git history and the planned artifact for credentials, personal data, and license obligations. Run `gitleaks git --redact .` and `gitleaks dir --redact .`. Both currently report the self-signed `*.lan.example.test` TLS key used only by a test; investigate any other finding.
2. Confirm GitHub private vulnerability reporting is available and [SECURITY.md](../SECURITY.md) points to a working reporting path before making the repository public.
3. Choose a version, update all five `package.json` files, and move the release notes from `## [Unreleased]` to `## [<version>] - YYYY-MM-DD` in `CHANGELOG.md`. Add a new `## [Unreleased]` heading above it. Keep the English and Chinese READMEs aligned.
4. Run `pnpm install --frozen-lockfile`, `pnpm release:check`, `pnpm typecheck`, `pnpm test`, and `make app` on an Apple silicon Mac. Test pairing, reconnecting, approvals, and desktop linking with a supported Codex CLI. The release workflow repeats the automated checks.
5. Run **Package macOS app** on the intended commit. Download its artifact, verify the checksum with `shasum -a 256 -c codex-pocket-macos-arm64.zip.sha256`, and open the app from the archive on an Apple silicon Mac.

## Draft and publish

After the checks pass and the release commit is on `main`, create and push an annotated tag:

```bash
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

Use the actual version in place of `0.1.0`. The tag workflow requires the tag to match every package version, point to a commit on `main`, and have dated notes in `CHANGELOG.md`. It creates a draft Release only after Linux checks and macOS packaging succeed.

Download the draft assets, confirm their SHA-256 checksum and first-launch behavior, review the notes, then publish the draft in GitHub. State that the app is unsigned and requires right-click **Open** on first launch. Signing and notarization require a separate setup with Apple credentials; do not describe this build as notarized.
