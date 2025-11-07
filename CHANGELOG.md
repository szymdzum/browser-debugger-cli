# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

<!-- Empty for now - add here as you work -->

## [0.3.1] - 2025-11-07

### Changed
- **Code quality improvements** through Phase 1 technical debt resolution
  - Simplified error code mapping in stop command (TD-006)
  - Extracted magic numbers to named constants across codebase (TD-010)
  - Enhanced IPC connection error messages with contextual information (TD-012)
  - Replaced platform-specific execSync with cross-platform helper (TD-004)
  - Resolved TODO comments in IPC server (TD-009)
- **UI layer reorganization** for better maintainability
  - Moved error handling modules from `src/` to `src/ui/errors/` directory
  - Moved logger modules from `src/` to `src/ui/logging/` directory
  - Updated all import paths to use new locations
- **Documentation improvements**
  - Clarified release process for title format and changelog updates
  - Added comprehensive code review document (CODE_REVIEW.md) cataloguing 19 technical debt items
  - Added detailed refactoring guide (REFACTORING_GUIDE.md) with before/after examples

### Removed
- Deprecated re-export files (`src/errors.ts`, `src/logger.ts`)

### Performance
- Improved code maintainability through reduced duplication and clearer structure

## [0.3.0] - 2025-11-07

### Added
- **Screenshot command** (`bdg dom screenshot`) for capturing page screenshots
  - Full-page and viewport-only capture modes
  - PNG and JPEG format support with quality control (0-100)
  - Automatic directory creation
  - Comprehensive metadata output (dimensions, size, format)
  - Human-readable and JSON output modes
- Schema contract tests with golden files to prevent schema drift (12 tests)
- Golden CDP workflow script for agent reference implementation (`tests/agent-benchmark/scenarios/00-golden-cdp-workflow.sh`)
- Comprehensive exit codes documentation (`docs/EXIT_CODES.md`)
- Schema migration plan documentation (`docs/roadmap/SCHEMA_MIGRATION_PLAN.md`)
- Week 0 completion report (`docs/roadmap/WEEK_0_COMPLETION_REPORT.md`)
- `ScreenshotData` interface to type definitions
- Screenshot formatter for human-readable output

### Changed
- Page readiness now waits for stability by default (prevents premature DOM capture)
- Test suite organized with dedicated fixtures directory
- ESLint configuration enhanced for test files
- Improved documentation structure for roadmap and quality guidelines

### Fixed
- npm distribution tags properly configured (`latest` and `alpha` both point to current version)
- Package README now updates correctly on npm registry
- TypeScript build cache issues resolved with clean rebuild process

### Performance
- Test fixtures automatically copied to dist during build

## [0.2.1] - 2025-11-06

### Added
- Comprehensive test suite with agent benchmarks, error scenarios, edge cases, and integration tests
- Test runner script (`tests/run-all-tests.sh`) with granular suite selection (`--benchmarks`, `--integration`, `--errors`, `--edge-cases`)
- Agent benchmark framework for real-world web automation scenarios (Hacker News, GitHub, Wikipedia, Reddit)
- Error scenario tests for port conflicts, invalid URLs, session recovery, daemon crashes, Chrome launch failures
- Edge case tests for URL validation and handling
- Integration tests for CDP, console, DOM, network, cleanup, details, peek, and status commands
- Comprehensive test documentation in `tests/README.md`
- Testing philosophy documentation in `docs/quality/`
- Project roadmap documentation across multiple phases

### Changed
- **Code quality improvements** following KISS, DRY, and YAGNI principles
- Enhanced TSDoc comments with detailed descriptions and `@remarks` sections
- Reorganized testing documentation to `docs/quality/` directory
- Improved error handling with proper warning messages instead of silent failures
- Optimized Chrome diagnostics calls (reduced from 3× to 1× in error paths)
- Combined duplicate PID validation logic in launcher (reduced 30 lines to 26)

### Fixed
- **Collector activation timing** - activate before navigation to capture initial page load events
- **Stale daemon cleanup** - properly handle and report errors when removing stale daemon.pid files
- **Port conflict detection** - detect orphaned Chrome processes before launch with better error messages
- **URL validation** - stricter validation with centralized protocol constants and simplified logic
- **Chrome process validation** - combined PID and liveness checks for more efficient error detection

### Removed
- Dead code and unused catch parameters across codebase
- Obsolete `vbscript:` protocol support (YAGNI compliance)
- Redundant protocol validation regex checks (~25 lines)
- Duplicate protocol lists in URL utilities

### Performance
- Reduced code duplication by ~68 lines through DRY refactoring
- Optimized Chrome diagnostics generation in error paths
- Simplified URL validation logic for faster processing

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
