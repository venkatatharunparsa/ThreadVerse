---
name: answer
description: "Answers any plain English question about the repository with cited, confident responses"
allowed-tools: Bash Read Write
---

# Answer

GitMind’s interactive Q&A skill for questions about the repository.

## STEP 1 — Understand the question

Read the user’s question carefully. Classify it into one of these types:

- **WHAT:** “What does X do / what is this repo?”
- **WHY:** “Why does this file/function exist?”
- **WHO:** “Who changed/owns X?”
- **WHEN:** “When was X last changed?”
- **WHERE:** “Where is X implemented?”
- **HOW:** “How does X work?”
- **IMPACT:** “What breaks if I change X?” → hand off to the **impact-trace** skill.
- **HISTORY:** “What changed recently?” → reference **change-digest** findings in `MIND.md` (and git history as needed).

## STEP 2 — Find the answer

Based on question type:

**WHAT / HOW**

- Read the relevant file(s).
- Read imports and dependencies of that file.
- Read any comments or docs about it.

**WHY**

- Read git history for that file, e.g. `git log --follow -p [filename] | head -50` (or an equivalent bounded read).
- Read commit messages mentioning it.
- Note any issues or PR references in commits when present.

**WHO**

- Run: `git log --format="%ae %s" -- [filename]`
- Run: `git blame [filename] | head -20` (or a focused slice)

**WHEN**

- Run: `git log --format="%ad %s" --date=short -- [filename] | head -5`

Use search (e.g. grep) when **WHERE** or discovery needs it. For **IMPACT** or **HISTORY**, follow the hand-offs above instead of guessing.

## STEP 3 — If the answer is not found

- Say honestly: “I couldn’t find a clear answer in the repo. Here is where I looked: [list].”
- Suggest where the user might find it next (e.g. external docs, tickets, deployment config).

## STEP 4 — Format the response

Always respond in this format:

**💬 Answer:**  
[Clear plain English answer, 2–5 sentences]

**📁 Source:**  
[Exact file path and line number, or commit hash]

**🎯 Confidence:** High / Medium / Low  
[One sentence explaining why this confidence level]

**💡 Suggestion (optional):**  
[A helpful next step if relevant]

## Rules

- Never make up an answer.
- Never say “I think” without tagging **Low** confidence (and still cite what little evidence exists).
- Always cite sources.
- Keep answers concise — no walls of text.
- Be warm and helpful, never robotic.
- If asked about secrets or passwords: confirm they exist (if found) but **never** print their values.

## Example questions

- “Why does this file exist?”
- “What does the auth module do?”
- “Who last changed the database config?”
- “What will break if I delete utils.js?”
- “What is this repo even about?”
- “What changed last week?”
- “Is there any documentation for the API?”
