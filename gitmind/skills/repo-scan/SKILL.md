---
name: repo-scan
description: "Walks the repository tree, maps structure and entry points, and updates MIND.md and per-folder summaries."
allowed-tools: Bash Read Write
---

# Repo Scan

You are GitMind executing a full repository scan. Read the structure, key files, and git history. Synthesize everything into a root `MIND.md` and a short `MIND.md` inside every subfolder. Cite every insight with its source file. Never read or print the contents of sensitive files.

---

## Step 1 — Read Structure

Get the complete file and folder tree. Run both commands:

```bash
find . -type f -not -path './.git/*' | sort
```

```bash
find . -type d -not -path './.git/*' | sort
```

As you read the output:

- Record every **directory name**. Infer its purpose from its name and the filenames inside it. Common patterns:
  - `src/`, `lib/`, `app/` → primary source code
  - `test/`, `tests/`, `__tests__/`, `spec/` → test suite
  - `docs/`, `doc/` → documentation
  - `scripts/`, `bin/` → automation and CLI tools
  - `config/`, `settings/` → configuration
  - `public/`, `static/`, `assets/` → served or bundled assets
  - `dist/`, `build/`, `out/` → generated artifacts (do not scan contents)
  - `migrations/`, `db/`, `database/` → data layer
  - `components/`, `pages/`, `views/` → UI layer
  - `middleware/`, `handlers/`, `routes/` → request-handling layer
  - `utils/`, `helpers/`, `shared/`, `common/` → shared utilities

- **Flag immediately** any file whose name matches a sensitive pattern (do NOT read its contents — see Step 5):
  - `.env`, `.env.local`, `.env.production`, `.env.*`
  - `*.key`, `*.pem`, `*.p12`, `*.pfx`, `*.cer`
  - `id_rsa`, `id_dsa`, `id_ed25519`, `*_rsa`, `*_dsa`
  - `secrets.*`, `credentials.*`, `serviceAccount.json`
  - `*.secret`, `*.token`, `.htpasswd`

- Note any `MIND.md` files that already exist — you will update them in Step 6 and Step 7, not overwrite them.

---

## Step 2 — Read Key Files

Read each file below **if it exists**. Use the Read tool. Do not skip a file because you expect it to be empty.

### Documentation
- `README.md` — full read
- Every `.md` file in the root directory — full read
- `CONTRIBUTING.md`, `CHANGELOG.md`, `ARCHITECTURE.md` if present — full read
- `CLAUDE.md` — full read; instructions here take precedence over this skill

### Dependency Manifests
Read whichever of these exist. Extract the fields specified:

**`package.json`**
- `name`, `version`, `description`, `main`, `module`, `bin`
- `scripts` — every key and value
- `dependencies` — all entries with versions
- `devDependencies` — all entries with versions
- `engines` — Node/npm version constraints

**`requirements.txt`** / **`pyproject.toml`** / **`setup.py`**
- All package names and version pins
- Note whether versions are pinned (`==`) or loose (`>=`, `~=`, no pin)

**`Cargo.toml`**
- `[package]` section: name, version, edition
- `[dependencies]` and `[dev-dependencies]`

**`go.mod`**
- Module path and Go version
- All `require` entries

**`pom.xml`** / **`build.gradle`** / **`build.gradle.kts`**
- GroupId, artifactId, version
- All dependency entries

### Entry Points
Read the **first 50 lines only** of whichever of these files exist:

| Language | Entry point candidates |
|----------|----------------------|
| JavaScript / TypeScript | `index.js`, `index.ts`, `main.js`, `main.ts`, `app.js`, `app.ts`, `server.js`, `server.ts`, `src/index.ts`, `src/main.ts` |
| Python | `main.py`, `app.py`, `run.py`, `server.py`, `manage.py`, `wsgi.py`, `asgi.py`, `__main__.py` |
| Go | `main.go`, `cmd/main.go`, any `main.go` under `cmd/` |
| Rust | `src/main.rs`, `src/lib.rs` |
| Ruby | `app.rb`, `config.ru`, `Rakefile` |

For each entry point found, note:
- The file path and the line where execution begins or the primary export is declared
- What framework or runtime it bootstraps (e.g. Express, FastAPI, Gin, Rails)
- Any environment variable names it references (names only — never values)

---

## Step 3 — Detect Stack

Using evidence gathered in Step 2, identify the following. For each, cite the source file and line number.

### Primary Language
Determine language from:
1. Manifest presence (`package.json` → JS/TS, `Cargo.toml` → Rust, `go.mod` → Go, `requirements.txt` → Python)
2. Extension distribution — run:
   ```bash
   find . -not -path './.git/*' -not -path './node_modules/*' \
     -not -path './dist/*' -not -path './build/*' \
     -type f | sed 's/.*\.//' | sort | uniq -c | sort -rn | head -15
   ```
3. Shebang lines in root scripts

If multiple languages are present (e.g. Python backend + TypeScript frontend), list all of them and note which directories each occupies.

### Framework
Identify from dependency names and entry point imports:
- `express`, `fastify`, `koa` → Node.js HTTP framework
- `react`, `vue`, `svelte`, `angular` → Frontend UI framework
- `next`, `nuxt`, `sveltekit` → Full-stack meta-framework
- `django`, `flask`, `fastapi`, `starlette` → Python web framework
- `gin`, `echo`, `fiber`, `chi` → Go HTTP framework
- `actix-web`, `axum`, `warp` → Rust web framework
- `rails`, `sinatra` → Ruby web framework

### Testing Tools
Search for test framework signatures:
```bash
grep -rn \
  --include="*.json" --include="*.toml" \
  --include="*.cfg" --include="*.ini" \
  -iE "(jest|vitest|mocha|jasmine|pytest|unittest|go test|cargo test|rspec|minitest)" \
  . 2>/dev/null | grep -v node_modules | head -10
```

### Build and Toolchain
Check for:
- `webpack.config.*`, `vite.config.*`, `rollup.config.*`, `esbuild.*` → bundlers
- `.babelrc`, `babel.config.*` → transpiler
- `tsconfig.json` → TypeScript
- `Dockerfile`, `docker-compose.yml` → containerization
- `.github/workflows/*.yml`, `.circleci/`, `Jenkinsfile`, `.gitlab-ci.yml` → CI/CD
- `Makefile` → build automation

---

## Step 4 — Detect Ownership

For each key source file identified in Steps 1–3, find who touches it most. Run:

```bash
git log --format='%ae' -- "<filepath>" 2>/dev/null | sort | uniq -c | sort -rn | head -5
```

Also run for each top-level source directory:

```bash
git log --format='%ae' -- "<directory>/" 2>/dev/null | sort | uniq -c | sort -rn | head -3
```

And get the overall top contributors across the whole repo:

```bash
git log --format='%an <%ae>' 2>/dev/null | sort | uniq -c | sort -rn | head -10
```

If git history is unavailable (no commits yet), write: `Ownership: Not determinable — no commit history. Confidence: Low.`

Build an ownership map: `directory → primary author email(s) → commit count`. Note any area where contributions are spread across 5+ authors with no clear lead — flag these as **shared ownership**.

---

## Step 5 — Detect Sensitive Files

Using the list flagged in Step 1, perform two additional checks:

**5a. Check if any sensitive files are tracked by git (the critical case):**
```bash
git ls-files | grep -iE \
  '(\.env$|\.env\.|\.key$|\.pem$|\.p12$|secrets\.|credentials\.|_rsa$|_dsa$|_ed25519$|\.token$|\.secret$)' \
  2>/dev/null
```

**5b. Check whether `.gitignore` exists and covers common patterns:**
```bash
cat .gitignore 2>/dev/null | grep -iE '(\.env|\.key|\.pem|secret|credential|token)' | head -10
```

Also run:
```bash
ls .gitignore 2>/dev/null || echo "NO .gitignore FOUND"
```

For each sensitive file detected:
- Record its path
- Record whether it is tracked by git (Step 5a) or only present on disk
- Record whether `.gitignore` covers it
- **Do not open the file. Do not read a single line. Do not infer or mention its contents.**
- If tracked by git: flag as **Critical** — potential credential exposure in commit history

---

## Step 6 — Write Root MIND.md

Write (or update) `MIND.md` at the repository root. If `MIND.md` already exists, replace only the sections below — preserve any sections not listed here.

Use exactly this structure:

```markdown
## 🗺️ Repo Map

**Project:** <name from manifest or README, or directory name if neither exists>
**Version:** <version from manifest, or "not specified">
**Purpose:** <1–2 sentence description from README or manifest `description` field>
_Source: <file>:<line>_

### Entry Points
- `<path>:<line>` — <what it bootstraps, e.g. "Express HTTP server, reads PORT from env">
- `<path>:<line>` — <what it bootstraps>

### File Tree
<Condensed directory tree — directories only, max 50 lines. Omit node_modules, dist, build, .git>
```

_Confidence: <High/Medium/Low>_
_Last scanned: <ISO 8601 timestamp>_

---

## 🔧 Tech Stack

### Languages
- **<Language>** — <evidence: extension count or manifest>
  _Source: <file>:<line>_

### Framework
- **<Framework>** `<version>` — <what it does in this project>
  _Source: <manifest file>:<line>_

### Runtime
- **<Runtime>** `<version constraint>` — <where this is specified>
  _Source: <file>:<line>_

### Testing
- **<Tool>** `<version>` — <test command from scripts>
  _Source: <file>:<line>_

### Build / Toolchain
- **<Tool>** — <role: bundler / transpiler / CI / container>
  _Source: <config file>_

_Confidence: <High/Medium/Low>_
_Last scanned: <ISO 8601 timestamp>_

---

## 📁 Folder Purposes

| Folder | Purpose | Confidence | Source |
|--------|---------|------------|--------|
| `<path>/` | <what lives here and why> | High/Med/Low | `<file or observation>` |

> Any folder not listed is either empty, auto-generated (e.g. `dist/`), or its purpose could not be determined from available evidence.

_Confidence: <High/Medium/Low>_
_Last scanned: <ISO 8601 timestamp>_

---

## 👤 Ownership Map

| Directory | Primary Owner(s) | Commits | Notes |
|-----------|-----------------|---------|-------|
| `<path>/` | <email or name> | <N> | |
| `<path>/` | Shared | — | 5+ contributors, no clear lead |

### Top Repo Contributors
| Author | Commits |
|--------|---------|
| <name / email> | <N> |

_Confidence: <High/Medium/Low>_
_Last scanned: <ISO 8601 timestamp>_

---

## 📦 Key Dependencies

List the top 10 most significant runtime dependencies. Skip dev-only tooling here — that belongs under Tech Stack.

| Package | Version | Inferred Purpose | Source |
|---------|---------|-----------------|--------|
| `<name>` | `<version>` | <what it does in this project> | `<manifest>:<line>` |

_Confidence: <High/Medium/Low>_
_Last scanned: <ISO 8601 timestamp>_

---

## 🔐 Sensitive File Flags

<!-- If none found: -->
> No sensitive files detected in the working tree or tracked by git.
> `.gitignore` covers common secret file patterns. ✅
> _Confidence: High — checked via `git ls-files` and `find`_

<!-- If found — one entry per file: -->
| File | On Disk | Tracked by Git | In .gitignore | Severity |
|------|---------|---------------|---------------|----------|
| `<path>` | ✅ | <✅ Critical / ❌> | <✅ / ❌ Warning> | <Critical / Warning / Info> |

> ⛔ Contents of the above files were not read. Never share, print, or include their values in any output.
>
> **If any file is Tracked by Git:** run `git rm --cached <file>` to stop tracking it,
> add it to `.gitignore`, and rotate any credentials it may have contained —
> even in private repositories, commit history persists.

_Confidence: High — sourced from `git ls-files` and filesystem scan_
_Last scanned: <ISO 8601 timestamp>_
```

---

## Step 7 — Write Per-Folder MIND.md

For **every subfolder** found in Step 1 (excluding `node_modules/`, `dist/`, `build/`, `vendor/`, `.venv/`, `.git/`, and other generated directories):

Write a `MIND.md` file inside that folder. If one already exists, replace its content with the updated version.

Use exactly this structure:

```markdown
# <Folder Name>

> GitMind summary — do not edit by hand. Re-run `repo-scan` to refresh.

## Purpose
<1–2 sentences describing what this folder is for and how it fits into the overall project.>
_Source: <how this was inferred — e.g. "README.md:14", "folder name convention", "contents inspection">_

## Key Files

| File | Role |
|------|------|
| `<filename>` | <what it does — one line> |
| `<filename>` | <what it does — one line> |

> If this folder has more than 15 files, list only the most significant ones.

## Ownership
<Primary owner name/email> — <N> commits
<Second owner if applicable> — <N> commits
_Source: `git log --format='%ae' -- <folder>/`_

> If no git history: "Not determinable — no commit history."

## Last Changed
**Date:** <YYYY-MM-DD>
**Commit:** `<short hash>` — <commit subject>
**Author:** <name>

```bash
git log -1 --pretty=format:"%ad | %h | %an | %s" --date=short -- "<folder>/"
```

_Confidence: <High/Medium/Low>_
_Last scanned: <ISO 8601 timestamp>_
```

---

## Execution Rules

**Cite every insight.** Every factual claim in any `MIND.md` output must reference its source as `file:line` or the exact command that produced it. Claims without citations are marked `(inferred)` with confidence Low.

**Never read sensitive files.** Files matching the sensitive pattern list in Step 1 must never be opened with the Read tool. Detect by name and `git ls-files` only. Record path and status. Stop there.

**Preserve existing MIND.md content.** When updating an existing `MIND.md`, replace only the sections this skill owns. Do not delete sections written by other skills (`change-digest`, `health-check`, etc.).

**Skip generated directories entirely.** Do not create `MIND.md` files inside `node_modules/`, `dist/`, `build/`, `target/`, `vendor/`, `.venv/`, `__pycache__/`, or `.git/`. These are not authored code.

**Confidence levels mean exactly this:**

| Level | When to use |
|-------|-------------|
| **High** | Directly read from a file — path and line cited |
| **Medium** | Inferred from naming conventions or multiple indirect signals |
| **Low** | Extrapolated from sparse evidence or a single weak signal |

Never round up. A Medium is not a shy High.

**Every section ends with two lines:**
```
_Confidence: <High/Medium/Low>_
_Last scanned: <ISO 8601 timestamp>_
```
These are not optional. They are how future scans know what is fresh and what is stale.

**All insights are AI-generated and should be verified.** State this once at the top of the root `MIND.md`, below the last-scanned timestamp:
```
> ⚠️ All insights are AI-generated by GitMind and should be verified against the source.
```
