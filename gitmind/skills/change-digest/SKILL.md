---
name: change-digest
description: "Summarizes recent git activity, themes of commits, and notable diffs for the MIND.md Recent Changes sections."
allowed-tools: Bash Read Write
---

# Change Digest

You are GitMind running a change digest. Your job is to read the repository's git history, find patterns in what is changing and what is not, and write a clear, dated summary into `MIND.md`. Every commit cited must include its hash and date. Every section must end with a confidence level.

If there is no git history, handle it gracefully — write a friendly note and stop. Never crash, never output raw errors.

---

## Step 0 — Verify History Exists

Run this first. Do not proceed to any other step until you have checked:

```bash
git rev-list --count HEAD 2>/dev/null || echo "NO_HISTORY"
```

**If the output is `NO_HISTORY` or `0`:** go directly to Step 4. Do not run any other git commands.

**If the output is a number ≥ 1:** store it as `TOTAL_COMMITS` and proceed to Step 1.

Also capture the repo's first commit date for age context — you will use this in Step 5:

```bash
git log --reverse --format="%ad" --date=short | head -1
```

---

## Step 1 — Get Recent History

Run all three commands. Each gives a different view of the same history — do not skip any.

**1a. Last 20 commits, short format:**
```bash
git log --oneline -20
```
This gives you `<short_hash> <subject>` for each commit. Read the subjects as a group — look for recurring themes (e.g. multiple "fix auth", "update deps", "refactor user module" lines cluster into work streams).

**1b. Last 5 commits with file-level stats:**
```bash
git log --stat -5
```
This shows which files changed in each of the last 5 commits and how many lines moved. From this output extract:
- Which files appear in multiple commits — these are active files
- Whether changes are concentrated in one area or spread across the repo
- The ratio of insertions to deletions — high deletions relative to insertions suggests refactoring or cleanup

**1c. Last 20 commits with structured dates:**
```bash
git log --format="%h %ad %ae %s" --date=short -20
```
Parse each line as: `hash | date | author_email | subject`. Store all 20 rows. These are your primary citation source — every commit you mention in `MIND.md` must use the hash and date from this output.

---

## Step 2 — Get Change Patterns

**2a. Files changed in the last commit:**
```bash
git diff HEAD~1 HEAD --name-only 2>/dev/null
```
If only one commit exists, use instead:
```bash
git show --name-only --pretty=format: HEAD
```
For each file listed, note its directory path (first segment). This tells you which module the most recent work touched.

**2b. Who is committing most (last 20 commits):**
```bash
git log --format="%ae" -20 | sort | uniq -c | sort -rn
```
This gives `<count> <email>` pairs. Record the top contributors. Note anyone who appears in only 1 of 20 commits — they may be an infrequent contributor or a new joiner.

**2c. Which directories are changing most (last 30 days):**
```bash
git log --after="30 days ago" --name-only --pretty=format: \
  | grep -v '^$' \
  | sed 's|/[^/]*$||' \
  | sort | uniq -c | sort -rn | head -15
```
This rolls file-level changes up to directories. A directory appearing frequently here is an **active area**.

**2d. Commits per week for the last 8 weeks (velocity trend):**
```bash
git log --after="56 days ago" --format="%ad" --date=format:"%Y-%W" \
  | sort | uniq -c
```
This outputs `<count> <year-weeknumber>` pairs in chronological order. Compare the most recent 4 weeks against the prior 4 weeks to determine if velocity is rising, stable, or falling.

**2e. Total commits in defined windows (for the velocity section):**
```bash
git log --oneline --after="7 days ago" | wc -l
git log --oneline --after="30 days ago" | wc -l
git log --oneline --after="90 days ago" | wc -l
```

---

## Step 3 — Find Stale Files

Identify source files that have not been touched in 90 or more days. These may be forgotten, deprecated, or simply stable — the digest surfaces them so the team can decide which.

**3a. Get all tracked source files:**
```bash
git ls-files | grep -E '\.(js|ts|jsx|tsx|py|go|rs|java|kt|rb|cs|cpp|c|h|sh|yaml|yml|json|toml|md)$' \
  | grep -vE '(node_modules|dist|build|vendor|\.min\.|package-lock|yarn\.lock|\.venv)' \
  | sort
```

**3b. Find the last-modified date for each file and filter to those untouched for 90+ days:**

Run this to get a sortable list of file → last-commit-date pairs:
```bash
git ls-files \
  | grep -E '\.(js|ts|jsx|tsx|py|go|rs|java|kt|rb|cs|cpp|c|h|sh)$' \
  | grep -vE '(node_modules|dist|build|vendor)' \
  | while read f; do
      last=$(git log -1 --format="%ad" --date=short -- "$f" 2>/dev/null)
      [ -n "$last" ] && echo "$last $f"
    done \
  | sort | head -30
```

The files at the top of the sorted output (oldest dates) are your stale candidates. For any file whose date is 90+ days before today:

```bash
git log -1 --format="%h|%an|%ad|%s" --date=short -- "<stale_file>"
```

Record: path, last-touched date, last author, last commit hash, last commit subject.

**3c. Identify stale zones — directories where most files are stale:**
If 3 or more files in the same directory are stale, flag the entire directory as a stale zone rather than listing files individually.

**Important exclusions — do not flag as stale:**
- `LICENSE`, `CONTRIBUTING.md`, `CHANGELOG.md`, root-level config files
- Lock files (`package-lock.json`, `yarn.lock`, `go.sum`, `Cargo.lock`)
- Generated or vendored code
- Files with fewer than 10 lines — likely config stubs or placeholders

---

## Step 4 — Handle Empty History

If Step 0 returned `NO_HISTORY` or `0`, write the following block to `MIND.md` and stop. Do not run any further commands.

```markdown
## 🔍 Recent Changes

This repository has no git history yet.

GitMind tracks changes through commits — once you make your first commit,
this section will fill in automatically on the next scan.

**To make your first commit:**
```bash
git add .
git commit -m "Initial commit"
```

Then re-run `change-digest` and GitMind will start tracking everything from here.

## 🔥 Active Areas
_Not available — no commit history yet._

## 🧊 Stale Areas
_Not available — no commit history yet._

## 📈 Change Velocity
_Not available — no commit history yet._

## 👥 Recent Contributors
_Not available — no commit history yet._

_Confidence: High — absence of history is a definitive fact, not an inference._
_Last scanned: <ISO 8601 timestamp>_
```

---

## Step 5 — Write to MIND.md

Write (or update) the following sections in `MIND.md` at the repository root. If these sections already exist, replace them. Preserve all other sections written by other skills.

```markdown
## 🔍 Recent Changes

<Plain-English paragraph (3–5 sentences) summarizing what the team has been working on.
Draw from the themes you identified in Step 1a. If commits cluster around a feature, bugfix,
or refactor, name it. If messages are terse ("fix", "update", "wip"), say so and note that
intent cannot be fully determined — keep confidence Low for that claim.>

### Last 10 Commits

| Date | Hash | Author | Summary |
|------|------|--------|---------|
| <YYYY-MM-DD> | `<hash>` | <email or name> | <subject line> |
| <YYYY-MM-DD> | `<hash>` | <email or name> | <subject line> |
<!-- repeat for up to 10 commits — fewer if history is shorter -->

> Showing <N> of <TOTAL_COMMITS> total commits.
> First commit: <date from Step 0>

### Last Commit Detail
- **Commit:** `<full hash>`
- **Date:** <YYYY-MM-DD>
- **Author:** <name / email>
- **Message:** <subject>
- **Files changed:** <list from Step 2a, each on its own line as `- \`path\``>

_Confidence: <High if messages are descriptive / Low if messages are terse like "fix" or "wip">_
_Last scanned: <ISO 8601 timestamp>_

---

## 🔥 Active Areas

> Directories and files receiving the most commits in the last 30 days.

### By Directory (last 30 days)

| Directory | Commits | Notes |
|-----------|---------|-------|
| `<path>/` | <N> | <any notable pattern, e.g. "all from one author" or "mixed feature + fix commits"> |
| `<path>/` | <N> | |

<!-- If no commits in the last 30 days: -->
<!-- > No commits in the last 30 days. Repository appears to be in low-activity or maintenance mode. -->

### Most-Changed Files (last 30 days)

| File | Commits | Last touched |
|------|---------|-------------|
| `<path>` | <N> | <YYYY-MM-DD> (`<hash>`) |

_Confidence: High — sourced from `git log --after="30 days ago" --name-only`_
_Last scanned: <ISO 8601 timestamp>_

---

## 🧊 Stale Areas

> Source files not modified in 90 or more days.
> These may be stable, forgotten, or candidates for removal — review to decide.

<!-- If no stale source files: -->
<!-- > No stale source files detected. All tracked source files have been touched within the last 90 days. ✅ -->

### Stale Files

| File | Last Touched | Last Author | Commit | Age (days) |
|------|-------------|-------------|--------|------------|
| `<path>` | <YYYY-MM-DD> | <author> | `<hash>` | <N> |

### Stale Zones
<!-- Directories where 3+ files are all stale -->
- `<directory>/` — <N> files untouched since <earliest date>. Last activity: `<hash>` on <date>.

> Note: Lock files, generated code, LICENSE, and root config files are excluded from this list.

_Confidence: High — sourced from `git log -1 --date=short` per source file_
_Last scanned: <ISO 8601 timestamp>_

---

## 📈 Change Velocity

| Window | Commits |
|--------|---------|
| Last 7 days | <N> |
| Last 30 days | <N> |
| Last 90 days | <N> |
| All time | <TOTAL_COMMITS> |
| Repo age | <N months/years> (since <first commit date>) |

### Weekly Trend (last 8 weeks)

| Week | Commits |
|------|---------|
| <YYYY-WNN> | <N> |
<!-- one row per week, oldest to newest -->

### Assessment

<!-- Choose one and write 1–2 sentences citing the numbers: -->
<!-- 🟢 Accelerating — commits/week rising over the last 4 weeks -->
<!-- 🟡 Steady — roughly consistent commit rate across 8 weeks -->
<!-- 🟡 Slowing — commits/week falling over the last 4 weeks -->
<!-- 🔴 Dormant — fewer than 1 commit/week average over 90 days -->

<Assessment label + sentence. Example: "🟡 Slowing — 14 commits in weeks 1–4 vs 6 in weeks 5–8.
The drop coincides with the last active area shifting from `src/api/` to `src/auth/`, suggesting
a feature handoff rather than a team slowdown.">

_Confidence: High — sourced from `git log --format="%ad" --date=format:"%Y-%W"` weekly counts_
_Last scanned: <ISO 8601 timestamp>_

---

## 👥 Recent Contributors

> Authors active in the last 20 commits.

| Author | Commits (last 20) | First seen | Last seen |
|--------|------------------|------------|-----------|
| <email or name> | <N> | <YYYY-MM-DD> | <YYYY-MM-DD> |

<!-- To get first/last seen per author: -->
<!-- git log --format="%ae %ad" --date=short -20 | awk '{seen[$1]=$2; if(!first[$1]) first[$1]=$2} END {for(a in seen) print a, first[a], seen[a]}' -->

> New contributors (only 1 commit in this window) are marked with ✨.
> Authors absent for 60+ days are noted — they may have rotated off the project.

_Confidence: High — sourced from `git log --format="%ae" -20`_
_Last scanned: <ISO 8601 timestamp>_
```

---

## Execution Rules

**Always cite commit hash and date for every claim.** A statement like "the auth module has been active recently" must be followed by the commit hash(es) and dates that support it. No naked assertions.

**Use short hashes in tables, full hashes when citing a single commit.** 7-character short hashes keep tables readable. When writing the "Last Commit Detail" block, use the full hash.

**Confidence levels mean exactly this:**

| Level | When to use |
|-------|-------------|
| **High** | Output is directly from a git command — hash, date, author confirmed |
| **Medium** | Pattern inferred from commit messages or aggregate counts — reasoning shown |
| **Low** | Interpretation of terse or ambiguous commit messages; intent cannot be confirmed |

**Commit message quality affects confidence.** If the last 20 subjects are mostly `fix`, `update`, `wip`, or single words, state that explicitly and set the plain-English summary to confidence Low. Do not invent narrative from uninformative messages.

**Append, never overwrite unrelated sections.** When updating `MIND.md`, replace only the sections this skill owns (`🔍 Recent Changes`, `🔥 Active Areas`, `🧊 Stale Areas`, `📈 Change Velocity`, `👥 Recent Contributors`). Leave all other sections untouched.

**Stale file judgment.** Only flag files in source directories where staleness implies neglect. Do not flag `LICENSE`, lock files, generated files, or root config stubs — these are stable by design, not forgotten.

**Velocity assessment is honest.** If the repo has fewer than 4 weeks of history, do not produce a trend assessment — write: `Insufficient history for trend analysis — repo is <N> days old.` A trend requires at least two comparable periods.

**Every section ends with two lines:**
```
_Confidence: <High/Medium/Low>_
_Last scanned: <ISO 8601 timestamp>_
```
These lines are how future scans know what is current. Do not omit them.
