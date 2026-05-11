# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0.1] - 2026-05-11

### Added
- New `pnpm infra:up` script to start Docker infrastructure easily.
- Role management page now has friendly Empty States and Loading skeletons.

### Changed
- Improved local testing stability by disabling proxy for internal service calls.
- Switched to `is_background: true` for local service orchestration.

### Fixed
- Resolved connection refused errors in TDD test suite.
