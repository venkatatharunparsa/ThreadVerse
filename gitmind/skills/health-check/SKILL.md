---
name: health-check
description: "Assesses repo hygiene, tests, CI signals, and consistency for the Repo Health and Needs Attention sections."
allowed-tools: Bash Read Write
---

# Health check

Assess repo health for `MIND.md` sections **Repo Health Score**, **What's Good**, **Needs Attention**, **Critical Issues**, and align security findings with **Sensitive File Flags** / **Security Flags** as defined in the master template. Cite `file:line` or command output for every finding. Never read, print, or infer contents of sensitive files—paths only.

## Workflow (concise)

1. **Docs** — README presence/substance; stub `.md` files; optional comment density spot-check on large source files.
2. **Debt** — `grep` for `TODO`, `FIXME`, `HACK`, and obvious debug leaks (e.g. `console.log` outside tests); count and cite hotspots.
3. **Dependencies** — Read manifests (`package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`, etc.): pins vs wildcards, lockfiles; cite risky lines.
4. **Large files** — Files over ~1MB; note if tracked by git and whether type looks intentional (asset vs artifact).
5. **Security** — `find` / `git ls-files` for sensitive names (`.env`, keys, pem, etc.); optional pattern grep for hardcoded secrets—report **path:line only**, never values.
6. **Structure** — `.gitignore`, `LICENSE`, `CONTRIBUTING`, empty dirs; match expectations to stack when obvious.
7. **CI / tests** — If configs exist (e.g. `.github/workflows`, `jest.config`), note presence and obvious gaps with sources.

## Scoring

Score categories 🟢 / 🟡 / 🔴 honestly. Derive an **overall score /100** with short rationale. Any tracked secret or hardcoded credential pattern → treat as critical (🔴) regardless of other scores.

## Write to MIND.md

Replace only the health-check-owned sections. Preserve repo-scan, change-digest, proactive-suggest, and impact-trace content. Each filled section ends with:

`_Confidence: High | Medium | Low — <one reason>_`  
`_Last scanned: <ISO 8601 timestamp>_`

**Fix suggestions** must be concrete (command, file to add, line to change). **Celebration copy** for “all green” only if every category is genuinely 🟢.
