# pelec

`pelec` now uses Bun for dependency installation and project commands.

## Prerequisite

Install Bun 1.3.3 or newer:

```bash
curl -fsSL https://bun.sh/install | bash
```

## Setup

Install dependencies:

```bash
bun install
```

## Common Commands

Start the app in development mode:

```bash
bun run start
```

Rebuild local artifacts and start from a clean `.vite` and `out` state:

```bash
bun run rebuild:start
```

Package the Electron app:

```bash
bun run package
```

Build a fresh Linux AppImage:

```bash
bun run appimage:fresh
```

## Notes

This app still runs on Electron, so the packaged application continues to use Electron's embedded Node runtime internally. Contributors should not need system `node` or `npm` for normal install, development, or packaging workflows in this repository.

Electron Forge still performs a package-manager version check, so this repo provides a local `npm` version shim for Forge while continuing to use Bun for actual project commands.
