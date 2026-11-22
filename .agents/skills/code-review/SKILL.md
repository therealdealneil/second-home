---
name: code-review
description: Performs a structured, adversarial pre-commit code review of uncommitted git changes or specified files for bugs, security vulnerabilities, edge cases, and test coverage.
---

# Code Review Workflow

Follow these steps strictly when auditing code:

## Step 1: Gather the Diff & Context

1. Run `git status` and `git diff` (plus `git diff --cached` if changes are staged) to see every modified and newly created line.
2. Read the surrounding functions, callers, and interfaces in modified files—do not review diff hunks in isolation.
3. Check whether corresponding unit or integration tests were added or updated.

## Step 2: Audit Against Core Criteria

Evaluate the changes across five dimensions:

1. **Correctness & Edge Cases:** Off-by-one errors, null/undefined handling, unhandled promise rejections or exceptions, race conditions, and boundary inputs.
2. **Security:** Injection risks (SQL, command, XSS), hardcoded secrets/tokens, missing authentication or authorization checks, and unsafe deserialization.
3. **Architecture & Contracts:** Breaking API/schema changes, tight coupling, duplicated logic, and adherence to existing repository patterns.
4. **Performance:** N+1 queries, unbounded loops or memory allocations, blocking I/O on hot paths, and missing cleanup/disposal.
5. **Testability & Coverage:** Untested branches, brittle mocks, or missing regression tests for bug fixes.

## Step 3: Format the Review Report

Group all findings by severity using exact file paths and line numbers. Do not include generic praise or filler.

- **[BLOCKING]** _(Must fix before commit/PR)_: Bugs, data loss risks, security flaws, or broken contracts.
- **[IMPORTANT]** _(Should fix)_: Missing error handling, performance bottlenecks, maintainability hazards, or missing test coverage.
- **[NIT]** _(Optional)_: Naming, readability, or minor style improvements.

For every finding, provide:

1. **Location:** `path/to/file.ext:line`
2. **Issue:** Concise explanation of what can go wrong and why.
3. **Suggested Fix:** Concrete code snippet or actionable change.

If no issues are found in a category, omit it. If zero `[BLOCKING]` or `[IMPORTANT]` issues exist, explicitly state: `LGTM — No blocking or important issues found.`
