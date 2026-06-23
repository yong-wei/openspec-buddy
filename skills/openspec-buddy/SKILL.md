---
name: openspec-buddy
description: Use when the user explicitly invokes openspec-buddy claim, propose, apply, or achieve for OpenSpec changes coordinated through GitHub Issues across branches, agents, or worktrees.
compatibility: Requires openspec CLI and GitHub CLI.
---

# OpenSpec Buddy

OpenSpec Buddy is the coordination layer for OpenSpec work that is usually
GitHub-tracked. GitHub Issues are the default cross-worktree task record, but
`openspec-buddy propose --no-issue` may intentionally keep a change local-only.
OpenSpec remains the local specification and execution package.

Use this skill only when the user explicitly asks for `openspec-buddy claim`,
`openspec-buddy propose`, `openspec-buddy apply`, `openspec-buddy achieve`, or
asks to coordinate OpenSpec changes through GitHub Issues. The one exception is
`openspec-buddy propose --no-issue`, which creates a local-only OpenSpec change
without creating or updating any GitHub Issue.

## Required Configuration

Before running Buddy commands in a repository, verify project-local
configuration:

```bash
<openspec-buddy-skill-dir>/scripts/check-config.sh
```

Resolve `<openspec-buddy-skill-dir>` to the directory containing this
`SKILL.md`; do not paste the placeholder literally.

The helper scripts automatically read `.env.openspec-buddy` from the repository
root before checking the process environment. Set `OPENSPEC_BUDDY_ENV_FILE` to
use a different dotenv-style file. Non-empty process environment values override
file values.

Buddy may also read these optional internal coordination settings:

- `OPENSPEC_BUDDY_CACHE_DIR`
- `OPENSPEC_BUDDY_CACHE_SIGNAL_REF`
- `OPENSPEC_BUDDY_CACHE_SIGNAL_REMOTE`

They are cache and invalidation controls, not business truth. GitHub Issue, PR,
Project, and review state remain the source of truth.
`OPENSPEC_BUDDY_CACHE_SIGNAL_REMOTE` also determines which git remote is used
to derive the canonical `owner/repo` cache identity, so it must point at the
same GitHub remote Buddy should read and write.

Default GitHub-coordinated Buddy flows require:

- `OPENSPEC_BUDDY_BASE_BRANCH`
- `OPENSPEC_BUDDY_RELEASE_BRANCH`
- `OPENSPEC_BUDDY_PROJECT_OWNER`
- `OPENSPEC_BUDDY_PROJECT_NUMBER`
- `OPENSPEC_BUDDY_PROJECT_TITLE`

If any required variable is missing after file loading, stop and ask the user
for the value. Do not fall back to another project's branch or GitHub Project.
`openspec-buddy propose --no-issue` is the local-only exception: require only
`OPENSPEC_BUDDY_BASE_BRANCH` to keep the change aligned with the intended local
base, and do not block that mode on GitHub Project fields.
On first use in a project, ask for these basic values, generate
`.env.openspec-buddy`, then rerun the config check:

- Buddy base branch
- release branch
- GitHub Project owner
- GitHub Project number
- GitHub Project title

Use the npm installer when available:

```bash
openspec-buddy init
```

If the npm command is not available, use the bundled helper:

```bash
<openspec-buddy-skill-dir>/scripts/init-config.sh
```

Optional Development-link policy:

- `OPENSPEC_BUDDY_PR_DEVELOPMENT_LINK_MODE=auto` by default. Use a real
  PR-to-issue Development link only when the PR base is the repository default
  branch; otherwise record that manual GitHub sidebar linking is required.
- Set `OPENSPEC_BUDDY_PR_DEVELOPMENT_LINK_MODE=keyword` only for projects whose
  Buddy PRs target the repository default branch. The metadata helper then
  writes a closing keyword and verifies `closingIssuesReferences`.
- Use `manual` when PRs intentionally target a non-default Buddy base branch and
  humans will link the PR in GitHub's Development sidebar.

Required PR review request:

- Before a Buddy PR enters review, `OPENSPEC_BUDDY_PR_REVIEW_REQUEST` must be
  configured. `mark-review.sh` posts that exact request as a PR comment through
  `request-pr-review.sh` and verifies it before changing the issue to
  `status:in-review`.
- Projects that require Codex review should set the value explicitly, for
  example: `@codex review 中文回复，即使没有重大问题也必须给出显式回复`.

## Core Rule

One executable coordinated change maps to:

```text
one GitHub Issue = one change_id = one claim branch = one OpenSpec change = one PR
```

The issue metadata must include `claim_branch`, and `claim_branch` must equal `change_id`.

An ordinary open issue can be a source issue before it is adopted. The first Buddy action on that source issue is always `claim`: verify the current worktree is aligned with the configured base branch, read GitHub truth for partial-claim signals, write the minimal claim lock, re-read GitHub truth to prove the latest active claim belongs to this run and worktree identity, and only then create the Development branch lock and Project updates. Hidden Buddy metadata is added to the same original issue as part of the minimal claim lock. After the lock succeeds, decide whether the issue is simple enough to become one executable change or complex enough to become a tracking parent with child change issues. Do not create a mirror issue just to hold Buddy metadata for an existing issue.

## Execution Retrospective Requirement

After every `claim`, `propose`, `apply`, or `achieve` run, include a brief execution retrospective in the final report.
The retrospective must state:

- what worked in the Buddy workflow
- what was confusing, fragile, manual, or missing
- whether any reusable rule should be added to `openspec-buddy`, `openspec-buddy-auto`, or their references

If the run reveals a reusable workflow gap and the user asks to persist it, update the relevant skill file in the same branch before closing the task.

## Modes

### claim

Use when the user wants to pick up an existing GitHub issue, with or without an issue number.

Claim is the intake operation. Do not explore, draft an OpenSpec proposal, split the issue, or start implementation before the claim lock succeeds.

Steps:

1. If the user gave an issue number or URL, use that issue. If not, select the smallest claimable open issue number:
   ```bash
   <openspec-buddy-skill-dir>/scripts/claim-issue.sh [issue-number]
   ```
   The script first runs `sync-base-branch.sh`, then lists open issues when no number is provided, skips series parents, issues assigned to another user, active or terminal status labels, and accepts unlabeled, `status:backlog`, or `status:ready` issues. The helper does not force a worktree branch switch: it fast-forwards only when the current branch is `$OPENSPEC_BUDDY_BASE_BRANCH`; otherwise it requires the current `HEAD` to match `origin/$OPENSPEC_BUDDY_BASE_BRANCH`.
2. If the selected issue already has valid Buddy metadata, the script delegates to `claim-change.sh`.
3. If the selected issue is an ordinary open issue, the script derives `change_id` as `issue-<number>-<title-slug>` and prepends a hidden `<!-- openspec-buddy ... -->` metadata block as part of the minimal claim lock.
4. Claim uses a hard gate:
   - before writing, bypass cache and read GitHub truth for issue state/labels/assignees, claim comments, same-name remote branch, Development link, and open PR
   - write only the minimal lock: assignee, `status:claimed`, Buddy metadata when adopting an ordinary issue, and an `OpenSpec Buddy Claim` comment with `claim_id`, `lease_until`, `worktree_alias`, `worktree_path_hash`, `coordination_branch`, and `run_id`
   - immediately re-read GitHub truth through REST and confirm the latest active claim belongs to this `claim_id` and this worktree
   - only after that verification succeeds, create `origin/<change_id>` through `gh issue develop`, verify the issue Development branch link, sync Project Status to `In Progress`, and set Project `Start`
   - if verification fails, stop the issue and do not create Development link, branch, Project updates, PR, or implementation changes
5. Re-read the claimed issue and confirm:
   - `status:claimed` is present
   - the latest active `OpenSpec Buddy Claim` comment belongs to this `claim_id`
   - the Development branch exists and is linked after claim verification
   - `parse-issue-metadata.mjs` parses either front matter or the hidden Buddy block
6. Classify the claimed issue immediately:
   - Simple issue: keep the claimed issue as the single executable change, run `openspec-explore` only as needed, create the local OpenSpec change under `openspec/changes/<change_id>`, then continue with `apply`.
   - Complex issue: keep the claim while decomposing. Create child executable issues with their own Buddy metadata, link them as sub-issues or dependencies, then convert the original issue to `type:series-parent` and `status:tracking` only after the child issues exist. The original issue remains the parent tracking record; do not create a second "original task" issue.
7. If complexity is unclear after a bounded read of the issue and repository context, keep the issue claimed and ask the user whether to treat it as simple or decompose it. Do not release the claim merely because classification needs a human decision.

When a complex issue is decomposed, the original issue is no longer an executable change. The child issues carry the one-issue/one-change mapping.

### propose

Use when the user wants to create a new local OpenSpec change and, by default,
register the matching GitHub Issue before implementation.

Steps:

1. Derive or confirm a kebab-case `change_id`.
2. Invoke `openspec-propose` to create the local OpenSpec change under
   `openspec/changes/<change_id>` before creating the GitHub Issue. Use the
   same `change_id` for the OpenSpec change, the issue metadata, and the future
   claim branch. If `openspec-propose` cannot create that path or produces a
   different change id, stop and resolve the mismatch before touching GitHub.
3. If the user invoked `openspec-buddy propose --no-issue`, stop after the
   local OpenSpec change exists. Record that the change is intentionally local
   only, without creating or updating any GitHub Issue, claim branch, parent or
   dependency link, Project item, or Buddy coordination label. Report the local
   `openspec/changes/<change_id>` path and note that `openspec-buddy-auto` may
   execute it later as a no-issue local run. In this path, require
   `OPENSPEC_BUDDY_BASE_BRANCH` but do not require GitHub Project fields.
4. Prepare an issue body from `references/issue-template.md`, using the local
   OpenSpec proposal as the source of the goal, scope, tasks, and acceptance
   criteria.
5. In issue front matter, keep empty list fields as `[]`, but write every
   non-empty `depends_on`, `blocked_by`, or `blocking` field as a YAML block
   list. Do not use inline lists such as `[other-change]`; the metadata parser
   rejects those so dependency metadata cannot be misread.
6. Set `claim_branch: <change_id>`.
7. Set `base_branch` to `$OPENSPEC_BUDDY_BASE_BRANCH`. Do not create new Buddy
   issues against `$OPENSPEC_BUDDY_RELEASE_BRANCH`; release from the Buddy base
   branch to the release branch is a manual action unless the project
   explicitly configures otherwise.
8. Validate the prepared body before creating or updating the issue:
   ```bash
   <openspec-buddy-skill-dir>/scripts/parse-issue-metadata.mjs <issue-body-file>
   ```
9. Add all applicable coordination labels by default:
   - `status:ready`
   - `type:change`
   - `level:<level>` when the project uses level labels or the user supplied one
   - `area:<area>`
   - `series:<series>`
   - `risk:<low|medium|high>`
   - `mode:<isolated|fixed-branch|stacked|docs-only>`
   - `coupling:<coupling_group>` when `coupling_group` is not `none`
10. Before creating the issue, verify every planned label exists in the target
   repository with `gh label list`. If a required Buddy label such as
   `status:ready`, `type:change`, `area:<area>`, `series:<series>`,
   `risk:<risk>`, or `mode:<mode>` is missing, create the missing label or stop
   and report the exact missing label. Do not silently omit labels or substitute
   a different risk/area/series/mode label without saying so in the final
   retrospective. Re-run the label check after creating any missing label.
11. Create the issue with `gh issue create`.
12. If this is a planned series, create or identify the series parent issue, then link the child issue:
   ```bash
   <openspec-buddy-skill-dir>/scripts/create-series-parent.sh <series>
   <openspec-buddy-skill-dir>/scripts/link-issue-parent.sh <parent-issue> <child-issue>
   ```
13. If this issue depends on another change issue, link the native relationship:
   ```bash
   <openspec-buddy-skill-dir>/scripts/link-issue-dependencies.sh <blocked-issue> <blocking-issue>
   ```
14. Add the created issue to the default GitHub Project:
   ```bash
   <openspec-buddy-skill-dir>/scripts/add-issue-to-project.sh <issue-url>
   ```
   The script also sets the Project `Status` to `Todo`. The issue is not fully
   registered until labels, parent/dependency relationships, Project membership,
   and Project `Status` have all been applied or explicitly reported as already
   present.
15. Verify parent and dependency relationships with the batch verifier before
   reporting registration complete:
   ```bash
   <openspec-buddy-skill-dir>/scripts/verify-issue-relationships.sh --require-parent <parent-issue> <child-issue>...
   ```
   For dependency-only changes without a required series parent, omit
   `--require-parent` and pass the blocked issue plus all blocking issues:
   ```bash
   <openspec-buddy-skill-dir>/scripts/verify-issue-relationships.sh <blocked-issue> <blocking-issue>...
   ```
   If a proposed issue has both a series parent and dependencies, run one
   combined verification with the parent, the child, and every blocking issue:
   ```bash
   <openspec-buddy-skill-dir>/scripts/verify-issue-relationships.sh --require-parent <parent-issue> <child-issue> <blocking-issue>...
   ```
   Prefer this helper for propose relationship checks. It batch-fetches native
   GitHub parent/sub-issue and blockedBy/blocking edges in one GraphQL request,
   then validates both directions. Do not hand-write GraphQL for normal propose
   relationship verification; only inspect GraphQL manually when the helper
   fails and the failure itself is under investigation.

Default `propose` creates the GitHub Issue. `openspec-buddy propose --no-issue`
is the only local-only exception. Do not claim the issue or implement in
`propose`.

### apply

Use when the user wants to implement a GitHub-tracked OpenSpec change.

Steps:

1. Locate the issue by number, URL, or `change_id`.
2. Verify the current worktree is aligned with the configured Buddy base branch before editing files:
   ```bash
   <openspec-buddy-skill-dir>/scripts/sync-base-branch.sh
   ```
   If the current branch is `$OPENSPEC_BUDDY_BASE_BRANCH`, the helper may fast-forward it. In a separate worktree or topic branch, the helper must not switch branches; it succeeds only when current `HEAD` equals `origin/$OPENSPEC_BUDDY_BASE_BRANCH`.
3. Read the issue body and labels.
4. Validate metadata:
   ```bash
   <openspec-buddy-skill-dir>/scripts/parse-issue-metadata.mjs <issue-body-file>
   ```
5. Verify:
   - issue has `status:ready` or is already `status:claimed` by the current viewer
   - issue is not labeled `type:series-parent`
   - native `blockedBy` has no open, unarchived issue
   - metadata `depends_on` entries are not active unfinished changes
   - no open issue in the same `coupling_group` has `status:claimed` or `status:in-progress`
   - `claim_branch` equals `change_id`
   - `base_branch` equals `$OPENSPEC_BUDDY_BASE_BRANCH`
   - execution mode and branch constraints are satisfiable
6. If the issue is `status:ready`, acquire the minimal claim lock and verify it before any peripheral mutation:
   ```bash
   <openspec-buddy-skill-dir>/scripts/claim-change.sh <issue-number>
   ```
   The claim first writes only assignee, `status:claimed`, and a structured
   claim comment with lease. It then re-reads GitHub truth through REST and
   verifies the latest active claim belongs to this `claim_id` and worktree identity. Only after that
   does it create or reuse `origin/<change_id>` from the declared `base_branch`
   through `gh issue develop`, verify that the issue Development branch list
   contains the claim branch, mirror the issue status to the Project `Status`
   field, and set Project `Start` to the current date.
   If the issue is already `status:claimed`, do not claim it again. Re-read the
   issue and confirm that the current viewer is the assignee, `origin/<change_id>`
   exists, the issue Development branch list contains `<change_id>`, and the
   latest Buddy claim comment records the same branch.
7. Confirm the claim id, assignee, status label, and branch lock.
8. Use branch `<change_id>` for the implementation. For isolated work, create it from `base_branch`. For fixed-branch work, stop if the required branch is not the same as the declared claim branch.
9. After entering the claim branch, mark the issue in progress:
   ```bash
   <openspec-buddy-skill-dir>/scripts/mark-in-progress.sh <issue-number>
   ```
   This must leave the Project `Status` as `In Progress`.
10. Invoke `openspec-apply-change` for the matching local OpenSpec change.
11. Before opening the PR, require
    `openspec instructions apply --change <change_id> --json` to report
    `remaining: 0`, then run `openspec validate <change_id> --strict` on the
    active change before pre-archiving it on the claim branch:
    - create a main spec skeleton first when a delta introduces a new capability
      and `openspec/specs/<capability>/spec.md` does not exist
    - run `openspec validate <change_id> --strict` to catch invalid delta spec
      format before `openspec archive` moves the change
    - run `openspec archive <change_id> --yes`
    - validate each affected main spec with `openspec validate <capability> --strict`
    The issue must remain `status:in-progress`; file-level pre-archive is not
    the same as GitHub issue archive.
12. Commit code, tests, synced main specs, and the archived change directory
    together.
13. Open a ready PR against `$OPENSPEC_BUDDY_BASE_BRANCH`, never a draft PR.
    Do not hand-write the issue Development link; let the metadata helper apply
    the configured PR Development-link policy.
14. Mark the ready PR and issue for review through the core review helper:
   ```bash
   <openspec-buddy-skill-dir>/scripts/mark-review.sh <issue-number> <pr-url>
   ```
   This first verifies the PR targets `$OPENSPEC_BUDDY_BASE_BRANCH`. If the PR
   targets `$OPENSPEC_BUDDY_RELEASE_BRANCH`, the script attempts to retarget it
   to the Buddy base branch; if retargeting fails, stop before review/merge.
   The script also rejects draft PRs, calls `configure-pr-metadata.sh`, posts
   the configured PR review request, runs `verify-pr-coordination.sh`, and only
   then moves the issue to review. The metadata step must add PR-scoped labels
   such as `pr:openspec-buddy` and `pr:base-<base-branch>`, copy the issue's
   non-status coordination labels (`type:*`, `level:*`, `area:*`, `series:*`,
   `risk:*`, `mode:*`, and `coupling:*`) to the PR, mirror the issue assignee
   onto the PR, add the PR to the same Project as the issue, set the PR Project
   `Status` to `In Progress`, and record the origin issue in the PR body. When
   the PR base is the repository default branch and the policy is `auto` or
   `keyword`, the helper writes a closing keyword such as `Closes #123` and
   verifies GitHub reports the issue through `closingIssuesReferences`. When the
   PR base is not the default branch, GitHub CLI cannot create a verifiable PR
   Development link; the helper records a manual sidebar-link requirement
   instead of pretending the link is complete. This must leave the issue Project
   `Status` as `In Progress`.
15. When handling Codex review feedback, a pushed fix commit is not complete
    until every addressed actionable `P0`, `P1`, or `P2` thread has a same-thread
    reply with the fix commit or non-actionable rationale plus verification
    evidence, and this gate passes:
   ```bash
   <openspec-buddy-skill-dir>/scripts/review-response-gate.sh <pr-url> --head <head-sha>
   ```
   Do not request another review or enter `wait-for-review-clear.sh` until the
   gate resolves the addressed threads and a fresh GraphQL read confirms
   `isResolved=true`.

If claim verification fails, stop before editing files. If the user is starting from an ordinary open issue rather than a prepared Buddy issue, run `claim` first so intake and adoption happen before implementation.

### achieve / archive

Use after the PR for a GitHub-tracked OpenSpec change has been merged and the user wants to finish the change record. Treat `archive` as an alias for `achieve`.

Default Buddy PRs are pre-archived before review, so `achieve` normally syncs
GitHub issue state rather than creating a new archive commit. Keep the legacy
archive path only for older PRs that merged before this rule existed.

Steps:

1. Confirm the PR is merged.
2. Verify the current worktree is aligned with
   `origin/$OPENSPEC_BUDDY_BASE_BRANCH` using `sync-base-branch.sh`, then
   confirm the target branch contains the merge.
3. Prefer the pre-archived path:
   - confirm the merged branch contains
     `openspec/changes/archive/YYYY-MM-DD-<change_id>/`
   - read the archived `tasks.md` and require no unchecked tasks
   - confirm synced main specs exist and validate affected specs
   - verify actionable Codex review threads are resolved:
     ```bash
     <openspec-buddy-skill-dir>/scripts/verify-review-threads-resolved.sh <pr-url>
     ```
4. If the merged PR does not contain an archive path, use the legacy recovery
   path: confirm `openspec instructions apply --change <change_id> --json`
   reports `remaining: 0`, run `openspec-archive-change`, and commit/push the
   archive update before marking the issue archived.
5. Mark the issue archived:
   ```bash
   <openspec-buddy-skill-dir>/scripts/mark-achieved.sh <issue-number> <archive-path> [pr-url]
   ```
   This must leave the Project `Status` as `Done`, set Project `End` to the current date, and close the issue if it is still open.
   The script also checks the linked series parent and closes it when all child changes are already archived.
6. Report dependent blocked issues and any finalized series parent issue, if any.

`achieve` means the GitHub issue, PR, and OpenSpec archive all agree that the change is complete.

## Required References

Read only the reference needed for the current mode:

- `references/issue-template.md`: body template for `propose`
- `references/claim-locking.md`: branch lock, claim lease, and stale-claim rules for `apply`
- `references/metadata-schema.md`: field definitions and validation rules
- `references/issue-relationships.md`: parent issue, blocked-by, blocking, and Project date rules
- `references/project-coordination.md`: default GitHub Project target and status sync
- `references/status-flow.md`: labels and transitions

## Guardrails

- Do not implement unclaimed GitHub-tracked changes.
- Do not execute adjacent OpenSpec changes found in the worktree.
- Do not claim `type:series-parent` issues.
- Do not inspect an open collaborator issue deeply, split it, or propose local OpenSpec artifacts before the `claim` lock succeeds.
- Do not claim an issue while GitHub `blockedBy` contains any open, unarchived issue.
- Do not treat GitHub Projects as the agent execution source of truth; use issue metadata, labels, assignee, and comments.
- Do not update `status:*` labels without the Buddy wrapper scripts; Project `Status` must stay synchronized for human-visible coordination.
- Do not open, review, or merge Buddy PRs against `$OPENSPEC_BUDDY_RELEASE_BRANCH`. Retarget them to `$OPENSPEC_BUDDY_BASE_BRANCH` or stop.
- Do not create or submit draft PRs for Buddy changes; PRs must be ready for review when they are handed to the review loop.
- Do not request another Codex review, enter `wait-for-review-clear.sh`, merge,
  or mark achieved while actionable Codex review threads remain unresolved.
  `request-pr-review.sh`, `wait-for-review-clear.sh`, and `mark-achieved.sh`
  enforce this with `verify-review-threads-resolved.sh`.
- Do not silently resolve Codex review threads. Use
  `review-response-gate.sh` after replying with commit or verification
  evidence; the gate resolves through `resolve-review-thread.sh` and re-reads
  GraphQL.
- Do not leave Buddy PRs without PR-scoped labels, copied non-status
  coordination labels, mirrored issue assignees, the same Project as the
  originating issue, an origin issue record, the configured review request
  comment, and a successful `verify-pr-coordination.sh` check.
- Do not hand-write PR Development links. Use `configure-pr-metadata.sh` so closing keywords are used only when GitHub can verify them through `closingIssuesReferences`.
- Do not claim a PR Development link is complete when the PR targets a non-default base branch; use the manual GitHub sidebar link or report it as a remaining coordination step.
- Do not set `status:archived`, Project `Done`, or Project `End` merely because files were pre-archived in a PR. Those GitHub states are set only after the PR merges and `mark-achieved.sh` runs.
- Do not use a branch whose name differs from `change_id` unless the user explicitly cancels OpenSpec Buddy coordination for this change.
- Do not bypass the remote branch lock in `claim-issue.sh` or `claim-change.sh`; label changes alone are not a reliable lock.
- Do not bypass `verify-claim-worktree.sh`. It is the hard gate that blocks detached execution, foreign local worktree ownership, mismatched PR head branches, and active claims owned by another worktree.
- Do not reclaim `status:claimed` or `status:in-progress` work unless the lease is stale and the branch/PR recovery checks prove it is safe.
- Do not continue after a failed claim or unresolved coupling conflict.
- GitHub is the task-state source of truth; Git is still the code source of truth.

## Output

For `propose`, report the issue URL, `change_id`, labels, OpenSpec path, parent issue link, and dependency relationship links.
Also report the GitHub Project item id or state that the issue was already present in the Project, plus the Project `Status`.

For `claim`, report the issue number, whether it was selected automatically or specified by the user, `change_id`, claim branch, claim id, whether the issue was adopted from an ordinary open issue, and whether it is simple or requires decomposition.

For `apply`, report the issue, claim branch, blockedBy status, downstream blocking count when known, coupling-group result, Project `Start`, PR metadata labels, PR Project membership, and the OpenSpec change being applied.

For `achieve`, report the PR, merge state, archive path, Project `End`, final labels, issue close state, any finalized series parent issue, and any follow-up issues that were unblocked.

For every mode, include the execution retrospective required above.
