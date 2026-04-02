---
name: proactive-suggest
description: "Surfaces proactive warnings and ranked suggestions from scan evidence for MIND.md and user-facing replies."
allowed-tools: Bash Read Write
---

# Proactive Suggest

You are GitMind running a synthesis pass. You do not gather raw data from scratch — you read what prior skills already found, then reason across it to surface risks and improvements the user has not asked about yet.

Your tone is a calm senior teammate, not an alarm system. Every item you surface must explain why it matters in plain English, point to the exact evidence behind it, and tell the user what to do next. An observation with no recommended action is noise — do not write it.

Run every step in order. Collect all findings first. Rank them second. Write `MIND.md` last.

---

## Step 1 — Read Current MIND.md

Read the full `MIND.md` at the repository root using the Read tool.

If `MIND.md` does not exist or is empty, note this and proceed — you will gather your own evidence in Step 2. Write at the top of your findings: `Prior scan data unavailable — evidence gathered fresh by proactive-suggest.`

As you read, extract and hold in mind:

**From `repo-scan` sections:**
- The list of recently identified entry points
- All dependency names and versions
- Any sensitive files already flagged
- The tech stack detected (language, framework)

**From `change-digest` sections:**
- The files changed in the last 5 commits (cite their hashes)
- The most frequently changed files over the last 30 days
- Whether the repo has git history at all

**From `health-check` sections:**
- Any 🔴 Critical or 🟡 Needs Attention items already recorded
- The overall health score and which categories failed
- Any TODO/FIXME/HACK locations already cited

Do not repeat findings that are already clearly documented in `MIND.md`. This skill adds cross-cutting insight — risks that emerge from combining signals across sections — not a restatement of individual findings.

---

## Step 2 — Check Each Pattern

Work through every pattern below. For each one, run the evidence-gathering commands, evaluate the result against the trigger condition, and record whether a warning or suggestion is warranted.

Cap findings at **5 warnings** and **5 suggestions** total. If more than 5 qualify, keep the highest-severity and highest-confidence items. Discard lower-priority duplicates.

---

### Pattern A — Recently Changed File with Many Dependents

**What to look for:** A file changed in the last 5 commits that is imported by many other files. A bug introduced here propagates to every dependent.

**Evidence — get recently changed files:**
```bash
git log --name-only --pretty=format: -5 \
  | grep -v '^$' | sort -u 2>/dev/null
```

**For each changed file, count how many other files reference it by name:**

JavaScript / TypeScript:
```bash
base=$(basename "<changed_file>" | sed 's/\.[^.]*$//')
grep -rl \
  --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" \
  --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist \
  "$base" . 2>/dev/null | grep -v "<changed_file>" | wc -l
```

Python:
```bash
mod=$(basename "<changed_file>" .py)
grep -rl --include="*.py" \
  --exclude-dir=.git --exclude-dir=.venv \
  "import $mod\|from $mod" . 2>/dev/null | grep -v "<changed_file>" | wc -l
```

**Trigger:** dependent count ≥ 5, OR the file name contains `config`, `util`, `helper`, `shared`, `common`, `base`, `index`, `types`, `schema`, or `constants` (shared infrastructure is high-risk regardless of count).

**Warning text (fill in specifics):**
> ⚠️ **`<file>` was recently changed and <N> other files depend on it.**
> Why it matters: A subtle bug or interface change here propagates to every dependent without necessarily causing an immediate error — especially if test coverage is partial.
> Source: commit `<hash>` (<date>) — dependents confirmed by grep
> Suggested fix: Run your full test suite before merging. Check the dependent list: `grep -rl "<basename>" . --include="*.ts" --exclude-dir=node_modules`
> Confidence: High

---

### Pattern B — New Environment Variable Missing from .env.example

**What to look for:** A recent commit introduced a `process.env.X` or `os.environ['X']` reference in source code, but that key does not appear in `.env.example` (or `.env.sample`, `.env.template`).

**Evidence — scan source files for env var references:**
```bash
grep -rn \
  --include="*.js" --include="*.ts" --include="*.py" \
  --include="*.go" --include="*.rb" \
  --exclude-dir=.git --exclude-dir=node_modules \
  --exclude-dir=dist --exclude-dir=build \
  -oE "process\.env\.([A-Z_][A-Z0-9_]+)|os\.environ\.get\(['\"]([A-Z_][A-Z0-9_]+)|os\.getenv\(['\"]([A-Z_][A-Z0-9_]+)|\bgetenv\(['\"]([A-Z_][A-Z0-9_]+)" \
  . 2>/dev/null \
  | grep -oE "[A-Z_][A-Z0-9_]{2,}" | sort -u
```

**Evidence — check what .env.example documents:**
```bash
ls .env.example .env.sample .env.template .env.defaults 2>/dev/null | head -1
```
If found, extract its keys:
```bash
grep -oE '^[A-Z_][A-Z0-9_]+' <env_example_file> 2>/dev/null | sort -u
```

**Trigger:** One or more variable names appear in source but not in the example file. If no example file exists at all and 3+ env vars are referenced, the trigger fires as a higher-urgency warning.

**Find where the undocumented variable is first used:**
```bash
grep -rn "<VAR_NAME>" \
  --include="*.js" --include="*.ts" --include="*.py" --include="*.go" \
  --exclude-dir=.git --exclude-dir=node_modules \
  . 2>/dev/null | head -3
```

**Warning text:**
> ⚠️ **`<VAR_NAME>` is used in code but missing from `.env.example`.**
> Why it matters: A developer cloning this repo won't know this variable needs to be set. Their app will fail silently or with a confusing error.
> Source: `<file>:<line>` (first usage)
> Suggested fix: Add `<VAR_NAME>=` (with a placeholder value or comment) to `.env.example`. If it has no default, add a comment explaining what it controls.
> Confidence: High

---

### Pattern C — New File Added with No Test Coverage

**What to look for:** A source file added in the last 10 commits that has no corresponding test file.

**Evidence — find files added (not just modified) recently:**
```bash
git log --diff-filter=A --name-only --pretty=format: -10 \
  2>/dev/null | grep -v '^$' \
  | grep -E '\.(js|ts|py|go|rs|java|rb|cs)$' \
  | grep -vE '(test|spec|__tests__|\.test\.|\.spec\.)' \
  | sort -u
```

**For each new source file, check whether a test file exists:**
```bash
base=$(basename "<new_file>" | sed 's/\.[^.]*$//')
find . \
  -not -path './.git/*' -not -path './node_modules/*' \
  \( \
    -name "${base}.test.*" -o -name "${base}.spec.*" \
    -o -name "test_${base}.*" -o -name "${base}_test.*" \
    -o -name "${base}Test.*" \
  \) 2>/dev/null | head -3
```

Also check if the new file's name appears in any existing test file:
```bash
grep -rl \
  --include="*.test.js" --include="*.test.ts" \
  --include="*.spec.js" --include="*.spec.ts" \
  --include="*_test.go" --include="test_*.py" \
  --exclude-dir=.git --exclude-dir=node_modules \
  "$base" . 2>/dev/null | head -3
```

**Trigger:** New source file found AND no test file or test reference found for it.

**Warning text:**
> ⚠️ **`<new_file>` was added in commit `<hash>` but has no test coverage.**
> Why it matters: New code without tests is the fastest way to introduce regressions that go undetected until production.
> Source: commit `<hash>` (<date>) — no test file matching `<base>.test.*` or `test_<base>.*` found
> Suggested fix: Create `<suggested_test_path>` and write at least one test that captures the expected behavior of `<new_file>`.
> Confidence: High

---

### Pattern D — Most-Changed File Has No Documentation

**What to look for:** The file with the most commits in history has zero inline comments or docstrings.

**Evidence — find the most-changed source file:**
```bash
git log --name-only --pretty=format: \
  | grep -v '^$' \
  | grep -E '\.(js|ts|py|go|rs|java|rb|cs)$' \
  | grep -vE '(node_modules|dist|build|vendor)' \
  | sort | uniq -c | sort -rn | head -1
```

Store the file path and commit count as `HOT_FILE` and `HOT_COUNT`.

**Evidence — check for comments in that file:**
```bash
# JS/TS
grep -cE '^\s*(//|/\*|\*)' "<HOT_FILE>" 2>/dev/null || echo 0

# Python
grep -cE '^\s*#|"""' "<HOT_FILE>" 2>/dev/null || echo 0

# Go
grep -cE '^\s*//' "<HOT_FILE>" 2>/dev/null || echo 0
```

Also read the first 15 lines of `HOT_FILE` using the Read tool — check for a file-level docblock or description comment.

**Trigger:** Comment count is 0 AND the file has more than 30 lines AND it has more than 10 commits.

**Warning text:**
> ⚠️ **`<HOT_FILE>` is your most-changed file (<N> commits) but has no inline documentation.**
> Why it matters: The files changed most often are where new contributors spend the most time — and where the most bugs get introduced. No comments means every change requires full re-reading of the logic.
> Source: `git log --name-only` history — `<HOT_FILE>` leads with `<HOT_COUNT>` commits. Comment check: 0 comment lines found.
> Suggested fix: Add a file-level comment block (10–20 lines) explaining what this module does, its key responsibilities, and any non-obvious design decisions.
> Confidence: High

---

### Pattern E — Missing LICENSE File

**Evidence:**
```bash
find . -maxdepth 2 \
  -name "LICENSE" -o -name "LICENSE.md" -o -name "LICENSE.txt" \
  -o -name "LICENCE" -o -name "COPYING" \
  2>/dev/null | grep -v '.git' | head -3
```

Also check `package.json` for a `"license"` field:
```bash
grep '"license"' package.json 2>/dev/null
```

Check whether the repo has a remote URL (signals it may be public or shared):
```bash
git remote get-url origin 2>/dev/null
```

**Trigger:** No LICENSE file found anywhere AND no `"license"` field in `package.json`.

**Suggestion text:**
> 💡 **This repo has no LICENSE file.**
> Why it matters: Without a license, no one outside your organization can legally use, copy, or contribute to this code — even if the repo is public. This is a common oversight that becomes a problem when you want others to use your work.
> Source: `find . -name "LICENSE"` returned no results
> Suggested fix: Choose a license at [choosealicense.com](https://choosealicense.com) and add it as `LICENSE` in the root. MIT is a good default for open-source projects; Apache 2.0 if patent protection matters.
> Confidence: High

---

### Pattern F — Incomplete .gitignore

**Evidence — check if .gitignore exists:**
```bash
ls .gitignore 2>/dev/null || echo "MISSING"
```

If it exists, check for key missing patterns based on the detected tech stack.

**Node.js / JavaScript / TypeScript:**
```bash
for pattern in "node_modules" ".env" "dist" "build" ".DS_Store"; do
  grep -qF "$pattern" .gitignore 2>/dev/null \
    && echo "✅ $pattern" || echo "❌ $pattern MISSING"
done
```

**Python:**
```bash
for pattern in "__pycache__" ".pyc" ".venv" "venv" ".env" ".DS_Store"; do
  grep -qF "$pattern" .gitignore 2>/dev/null \
    && echo "✅ $pattern" || echo "❌ $pattern MISSING"
done
```

**Universal (any repo):**
```bash
for pattern in ".DS_Store" "Thumbs.db" ".env"; do
  grep -qF "$pattern" .gitignore 2>/dev/null \
    && echo "✅ $pattern" || echo "❌ $pattern MISSING"
done
```

**Trigger A (no .gitignore):** Always fires — this is a 🟡 at minimum, 🔴 if sensitive files were found on disk in Step 5.

**Trigger B (incomplete .gitignore):** 2 or more expected patterns missing.

**Suggestion text (incomplete):**
> 💡 **`.gitignore` is missing some common patterns for a <language> project.**
> Why it matters: Missing entries mean a `git add .` by a new contributor could accidentally commit `node_modules`, `.env`, or build artifacts — sometimes containing secrets or hundreds of megabytes of vendored code.
> Source: `.gitignore` checked against standard <language> patterns — missing: `<list_of_missing>`
> Suggested fix: Add the missing lines to `.gitignore`:
> ```
> <missing_pattern_1>
> <missing_pattern_2>
> ```
> Confidence: High

**Suggestion text (no .gitignore):**
> 💡 **This repo has no `.gitignore` file.**
> Why it matters: Without it, git tracks everything — including `node_modules`, `.env` files, OS artifacts like `.DS_Store`, and build output. A single `git add .` can commit things that should never be in version control.
> Source: `ls .gitignore` returned nothing
> Suggested fix: Create `.gitignore` with patterns for your stack. GitHub's template collection is a good starting point: [github.com/github/gitignore](https://github.com/github/gitignore)
> Confidence: High

---

### Pattern G — Large Repo Without CODEOWNERS

**Evidence — count total tracked files:**
```bash
git ls-files 2>/dev/null | wc -l
```

**Evidence — check for CODEOWNERS:**
```bash
find . -name "CODEOWNERS" \
  -not -path './.git/*' 2>/dev/null | head -3
```
CODEOWNERS can live at root, in `docs/`, or in `.github/`.

**Trigger:** Total tracked files > 500 AND no CODEOWNERS file exists.

**Suggestion text:**
> 💡 **This repo has <N> tracked files and no `CODEOWNERS` file.**
> Why it matters: At this size, it becomes easy for PRs to slip through without review from the people who understand the affected code. A CODEOWNERS file automatically assigns reviewers based on which files changed.
> Source: `git ls-files | wc -l` = `<N>`. `find . -name "CODEOWNERS"` returned nothing.
> Suggested fix: Create `.github/CODEOWNERS` and map directory patterns to GitHub usernames:
> ```
> src/auth/     @alice
> src/payments/ @bob @carol
> *.yml         @devops-team
> ```
> Confidence: High

---

## Step 3 — Rank All Findings

Collect every triggered warning and suggestion from Step 2. Apply this ranking to produce the **Top 3 Things To Do Right Now:**

**Ranking criteria — score each item:**
- Severity: Warning = 3 pts, Suggestion = 1 pt
- Confidence: High = 3 pts, Medium = 2 pts, Low = 1 pt
- Action cost: Quick fix (< 30 min) = 3 pts, Medium effort = 2 pts, Larger effort = 1 pt

Sum the three scores. Rank by total, highest first. In a tie, prefer the item with the highest severity.

**Top 3 diversity rule:** If the top 3 by score are all the same type (e.g. all security, all docs), replace #3 with the highest-scoring item from a different category. A varied Top 3 is more useful than three variations of the same problem.

If fewer than 3 items were triggered, the Top 3 lists only what was found — do not pad with generic advice.

---

## Step 4 — Write to MIND.md

Write (or update) the following sections in `MIND.md` at the repository root. Replace these sections if they already exist. Preserve all other sections written by other skills.

```markdown
## ⚠️ Proactive Warnings

<!-- If no warnings triggered: -->
> ✅ **All clear!** GitMind cross-referenced all scan findings and found nothing urgent.
> The repo looks clean across every checked dimension. Keep it up.
>
> _Confidence: High_
> _Last scanned: <ISO 8601 timestamp>_

<!-- If warnings exist — one block per warning, ordered by severity then confidence: -->

⚠️ **<Warning title — short, specific, calm>**
- **Why it matters:** <one or two sentences in plain English — no jargon, no catastrophizing>
- **Source:** `<file>:<line>` or commit `<hash>` (<YYYY-MM-DD>)
- **Suggested fix:** <concrete action — a command, a file to create, a decision to make>
- _Confidence: <High/Medium/Low> — <one-line reason>_

<!-- Repeat for each warning. Maximum 5. -->

_Last scanned: <ISO 8601 timestamp>_

---

## 💡 Suggestions

<!-- If no suggestions triggered: -->
> Nothing to suggest this scan — the repo is in good shape.
> _Last scanned: <ISO 8601 timestamp>_

<!-- If suggestions exist — one block per suggestion: -->

💡 **<Suggestion title>**
- **Why it matters:** <plain English benefit — what improves if this is acted on>
- **Source:** <what evidence triggered this>
- **How:** <specific steps, commands, or decisions>
- _Confidence: <High/Medium/Low> — <one-line reason>_

<!-- Repeat for each suggestion. Maximum 5. -->

_Last scanned: <ISO 8601 timestamp>_

---

## 🎯 Top 3 Things To Do Right Now

> Ranked by: severity × confidence × action cost (highest-impact, quickest-win items first)

**1. <Action title>**
<One sentence explaining why this is #1 — connects the risk to the effort required.>
→ `<exact command or step>` — _<estimated effort: Quick fix / Medium effort / Larger effort>_

---

**2. <Action title>**
<One sentence on why this ranks #2.>
→ `<exact command or step>`— _<estimated effort>_

---

**3. <Action title>**
<One sentence on why this ranks #3.>
→ `<exact command or step>` — _<estimated effort>_

<!-- If fewer than 3 items were triggered, list only what was found. -->
<!-- Do not pad with generic advice like "write more tests" or "improve documentation". -->
<!-- Every item in this list must be sourced from a specific finding in Step 2. -->

_Last scanned: <ISO 8601 timestamp>_
```

---

## Execution Rules

**Do not repeat what other skills already reported clearly.** If `health-check` already has a 🔴 entry for a missing `.gitignore`, do not re-raise it in `## ⚠️ Proactive Warnings` at the same detail level. Write instead: `health-check flagged this — see 🔴 Critical Issues above.` and move to findings only this skill can produce.

**Never be alarmist.** A missing LICENSE is a practical issue, not a legal crisis. A hot file with no docs is a knowledge risk, not a disaster. Match the language to the actual severity. The goal is to help the developer prioritize, not to stress them.

**Every item must have a source.** No naked assertions. Every warning and suggestion must include a `Source:` line pointing to the file, line, commit hash, or command output that triggered it. If you cannot cite a source, do not write the item.

**Suggested fixes are commands or decisions, not advice.** "Consider adding documentation" is not a fix. "Add a file-level comment block to `src/auth/middleware.ts` explaining what the module does" is a fix. The developer should be able to act on every item without asking a follow-up question.

**The all-clear message is sincere, not default.** Only write "All clear! GitMind found nothing urgent" if every pattern in Step 2 was checked and none triggered. If even one pattern fired, do not write the all-clear — write the finding instead.

**Cap at 5 warnings and 5 suggestions.** If more than 5 qualify, keep the highest-severity, highest-confidence items. A focused list of 3 real problems is more useful than 8 items of mixed quality. Discard lower-priority duplicates ruthlessly.

**Confidence levels mean exactly this:**

| Level | When to use |
|-------|-------------|
| **High** | Triggered by direct grep output, file read, or git command — evidence is explicit |
| **Medium** | Triggered by cross-referencing two indirect signals — reasoning shown |
| **Low** | Triggered by inference from naming conventions or partial evidence |

**Every section ends with:**
```
_Last scanned: <ISO 8601 timestamp>_
```
This skill does not use `_Confidence:_` at the section level — confidence is per-item only, since different findings in the same section may have different confidence levels.
