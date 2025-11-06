# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2025-11-06

### Added
- Debug logging mode with `--debug` flag for troubleshooting daemon/IPC issues
- Live activity metrics to `bdg status` command (network requests, console messages, DOM queries)
- Smart page readiness detection for SSR applications with three-phase adaptive detection
- Chrome popup suppression (translate prompts, notification requests) for cleaner automation
- Configurable IPC timeouts for better test reliability and slow page handling

### Changed
- Flatten CLI structure by eliminating `src/cli` directory for simpler imports
- Centralize all UI messages into `src/ui` layer (commands, errors, session, console, preview, validation)
- Rename "collectors" → "telemetry" throughout codebase for clearer terminology
- Enhance message organization with domain-specific message modules
- Improve peek command UX in follow mode (timestamps, hide tips during live updates)
- Hide empty sections in peek output when filters are active

### Fixed
- Chrome launch validation now checks process liveness (no more false "PID: 0" success messages)
- Enhanced Chrome launch errors with installation diagnostics and troubleshooting steps
- Enhanced target-not-found errors with available tabs list and diagnostic commands
- Port validation now throws consistent `ChromeLaunchError` instead of generic `Error`
- Stale session auto-cleanup when daemon PIDs are dead (no more manual cleanup required)
- **"Last Request" timestamp in status command** (was showing "489560h ago" instead of "2s ago")

## [0.1.0] - 2025-11-05

### Added
- Direct CDP passthrough command (`bdg cdp`) for low-level Chrome DevTools Protocol access
- High-level network commands (`bdg network getCookies`) with human-readable formatting
- JavaScript evaluation command (`bdg dom eval`) for executing code in browser context
- Console log queries (`bdg console`) with filtering and pagination support
- Comprehensive contract tests for network collector and IPC server (1,173 lines)
- Enhanced CDP type definitions with complete Network domain coverage
- CommandRunner helper for unified error handling and output formatting
- commonOptions helper for shared CLI flags (`--json`, `--last`, `--filter`)
- responseValidator helper for type-safe IPC/CDP response validation
- Phase 1 reliability improvements for SSR applications
- Smart page readiness detection foundation (load event, network stability, DOM stability)
- IPC-based live data streaming for `peek` and `details` commands

### Changed
- Migrated all CLI commands to unified helper architecture (KISS, DRY, YAGNI principles)
- Replaced two-tier file-based preview system with pure IPC streaming
- Improved status output with clean formatting and Chrome diagnostics
- Enhanced error messages with consistent formatting and actionable suggestions
- Git commit guidelines: exclude AI tool attribution from commit messages

### Removed
- Old DOM collector implementation (domCache, domQuery, selectorParser)
- ipcTest command and tests (no longer needed)
- PreviewWriter.ts and file-based preview system (139 lines)
- Preview loop and file write operations from worker
- Unused test fixtures and dead code

### Fixed
- Module resolution for TypeScript path aliases in tests
- IPC timeout configuration for test reliability
- Chrome launch validation with proper PID checks
- Stale session detection and auto-cleanup

### Performance
- **241x smaller data transfer** for peek/details (no file I/O)
- Faster response times with live data from memory instead of disk reads
- Real-time access to preview data without stopping collection

## [0.1.0-alpha.1] - 2025-11-05

### Changed
- Updated installation instructions to recommend alpha tag

## [0.1.0-alpha.0] - 2025-11-05

### Added
- Initial alpha release
- Core CLI commands: start, stop, status, cleanup, peek, details
- Daemon + IPC architecture for persistent CDP connections
- Three telemetry collectors: DOM, network, console
- Chrome launcher integration with auto-detection
- Session management with Unix socket IPC
- JSON output format for programmatic consumption
- Basic filtering for tracking domains and dev server noise

---

**Legend:**
- `Added` - New features
- `Changed` - Changes in existing functionality
- `Deprecated` - Soon-to-be removed features
- `Removed` - Removed features
- `Fixed` - Bug fixes
- `Security` - Vulnerability fixes
- `Performance` - Performance improvements
