# Publishing Guide

## Public Repository Boundary

This repository is meant to be portable. Local operator paths, contact details,
runtime state, model blobs, WhatsApp auth stores, and uploaded files must stay
outside Git.

Public defaults should work from a normal clone:

```env
PRATIKSHA_HOST_DATA_ROOT=./.pratiksha-data
PRATIKSHA_HOST_RESOURCE_ROOT=./viji-files
VIJI_CONTAINER_DATA_ROOT=/data/pratiksha
VIJI_CONTAINER_RESOURCE_ROOT=/data/pratiksha/viji-files
```

Use a private local `.env` to point those host paths at an external SSD.

## Never Commit

- `.env`
- real phone numbers, real WhatsApp JIDs, QR data, auth tokens, or message bodies
- `session.db`, `wacli.db`, SQLite files, Postgres data, logs, backups, models,
  or uploaded media
- private machine-specific absolute paths
- private filenames or machine-specific run commands

## Branch Hygiene

Create feature branches from `origin/main` unless a branch is intentionally
stacked:

```bash
git fetch --all --prune
git switch --detach origin/main
git switch -c <owner>/<branch-name>
```

Before pushing:

```bash
git status --short --branch
git diff --cached --stat
git diff --cached --check
corepack pnpm typecheck
corepack pnpm test
```

Use the GitHub account switcher before pushing and verify the active account:

```bash
gh auth status --hostname github.com --active
git config user.name
git config user.email
```

## Docker and SSD Storage

Pratiksha has two storage layers:

- Project runtime data, configured by `.env` and mounted by Docker Compose.
- Docker Desktop image/VM storage, configured globally in Docker Desktop.

Moving Docker Desktop storage to an SSD can make images and volumes for other
Docker projects use that SSD too. Other Docker projects do not inherently need
Pratiksha's SSD; they only depend on it if Docker Desktop's global data root or
their own Compose mounts point there.

Keep public docs generic. Document external SSD usage as an operator
configuration choice, not as a hardcoded repository default.
