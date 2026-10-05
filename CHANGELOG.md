# Changelog

All notable user-facing changes are recorded here. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security

- Update Electron, DOMPurify, Vitest, and the build tools' HTTP cache dependency to address dependency security advisories. Source builds now require Node.js 22.12 or newer.

## [0.2.0] - 2026-10-04

### Added

- Manage multiple Macs from one installed PWA, with separate pairings, drafts, preferences, and notification subscriptions. Switch computers, inspect pairing details, and recover access from their settings.
- Open the cached PWA while its entry Mac is unavailable, then connect to another paired computer.
- Inspect active and completed subagents from their parent chat, with read-only child-thread views and navigation back to the parent.
- Upload CSV attachments from the phone, with filename chips, removable attachments, draft recovery, and host file paths included in messages. Each upload supports up to 10 MB.
- Preview images in a full-screen viewer and read local Markdown images and multi-page PDFs on mobile.
- Show the installed app version in About.

### Fixed

- Keep subagent threads out of regular and archived chat lists, and respect Codex's direct-input capability when sending, editing, retrying, or resuming queued messages.
- Preserve the PWA shell and reconnect flow when a Mac is offline; retain per-computer state when switching computers.
- Keep transcript changes and unread completion markers current, preload recent conversation context, and align workspace change summaries with Git.
- Read desktop-created images from the paired host and render every page in mobile PDF previews.
- Respect mobile safe areas in the workspace changes sheet.

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
