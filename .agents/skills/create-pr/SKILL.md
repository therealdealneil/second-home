---
name: create-pr
description: Generates a clean, well-structured GitHub Pull Request using Conventional Commits and a standardized PR description template. Trigger when the user asks to create, open, draft, or update a PR.
---

# Pull Request Creation Workflow

## Step 1: Pre-Flight Audit
Before pushing or opening a PR, run the following checks:
1. Run `git status` and `git diff origin/main...HEAD` to inspect all modified files and ensure no unintended artifacts, secrets, or debug logs are included.
2. Verify all local commits follow Conventional Commits (`<type>(<scope>): <description>`). If local commits are messy WIP commits, squash or amend them cleanly before pushing (only if the branch has not been shared/reviewed yet).
3. Run the project's build and test suite to confirm a green baseline.

## Step 2: PR Title & Metadata
- **PR Title:** Must strictly follow Conventional Commits format (`<type>(<scope>): <summary>`). If the PR contains a single commit, match its subject line; if multiple commits, summarize the overarching change.
- **Draft vs. Ready:** Open as a **Draft PR** (`gh pr create --draft`) if tests are pending, external configuration is required, or the user asks for an early review. Otherwise, open as ready for review.
- **Issue Linking:** Extract any Jira/GitHub issue ID from the branch name or prompt and link it cleanly.

## Step 3: PR Description Structure
Generate the PR body using the exact sections below. Do not use Markdown task checkboxes (`- [ ]`) anywhere in the PR body so GitHub does not render a task completion counter.

### Template

## Summary
- 2–4 concise bullet points explaining **what** changed and **why** (business or architectural motivation). Focus on behavior and design decisions rather than listing every modified file.

## Metadata
- **Type:** `<feat | fix | refactor | perf | test | chore | ci | docs>` *(keep only the applicable type(s))*
- **Related Issue:** `<TICKET-ID>` (or `Closes #<issue-number>`)

## Key Changes & Architecture Notes
- Briefly highlight non-obvious implementation details, new dependencies, schema/API contract updates, or infrastructure changes reviewers should scrutinize.

## Testing & Verification
- **Automated:** List unit, integration, or E2E test suites added or executed (with pass status).
- **Manual:** Concrete steps taken or needed to verify the behavior locally or in staging.

## Breaking Changes & Rollout Notes
- Explicitly call out any breaking API/schema changes, required environment variables, feature flags, or database migrations. State `None` if backwards-compatible.

## Step 4: Execution
1. Push the branch with `git push -u origin HEAD`.
2. Create the PR via `gh pr create --title "<title>" --body-file -` using a heredoc so markdown formatting and backticks are preserved cleanly.
3. Return the clickable PR URL and a brief summary of any reviewer action items (e.g., pending secrets, feature flags, or draft status).