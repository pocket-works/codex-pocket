# Changelog

All notable user-facing changes are recorded here. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.2] - 2026-09-30

### Changed

- Prepare the source and bundled license notices for public distribution, using sample filesystem paths and the GitHub account attribution.
- Include the upstream Codex protocol's Apache 2.0 license in the desktop application.
- Update repository links to pocket-works/codex-pocket.

### Fixed

- Stop sending push notifications for ephemeral threads. Tapping one used to fail with "Codex hasn't saved this thread yet", because these threads are never written to disk.

## [0.1.1] - 2026-09-29

### Added

- Developer ID signed and Apple notarized DMG for Apple silicon Macs, with stapled tickets for offline verification.

### Changed

- Replace the unsigned release zip with a DMG that supports drag-to-Applications installation. The release workflow now creates a draft without uploading an unsigned app.

## [0.1.0] - 2026-09-29

### Added

- Apple silicon menu bar app and phone PWA connected to the official Codex app-server daemon.
- Device pairing and revocation, with HTTPS access through Tailscale.
- Shared desktop threads, project and worktree navigation, approvals, follow-up queue, diff review, attachments, dictation, and push notifications.
- English and Chinese setup guides, contributor guidance, security policy, and release checks.

### Notes

- The macOS app is unsigned. Dictation uses an undocumented ChatGPT endpoint and may break when that endpoint changes.
