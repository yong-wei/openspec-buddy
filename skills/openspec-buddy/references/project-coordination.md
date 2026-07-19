# OpenSpec Buddy Project Coordination

These rules apply only when a configured legacy/full workflow uses a GitHub
Project. Default lightweight `openspec-buddy propose` does not require Project
configuration and does not add its Issue to a Project.

## Project Configuration

OpenSpec Buddy does not have a built-in GitHub Project default. Configure the
target project with environment variables before running any Project mutation:

| Variable | Meaning |
| --- | --- |
| `OPENSPEC_BUDDY_PROJECT_OWNER` | GitHub Project owner |
| `OPENSPEC_BUDDY_PROJECT_NUMBER` | GitHub Project number |
| `OPENSPEC_BUDDY_PROJECT_TITLE` | Human-readable Project title |
| `OPENSPEC_BUDDY_PROJECT_STATUS_FIELD` | Status field name, default `Status` |
| `OPENSPEC_BUDDY_PROJECT_STATUS_TODO` | Todo option name, default `Todo` |
| `OPENSPEC_BUDDY_PROJECT_STATUS_IN_PROGRESS` | In-progress option name, default `In Progress` |
| `OPENSPEC_BUDDY_PROJECT_STATUS_DONE` | Done option name, default `Done` |
| `OPENSPEC_BUDDY_PROJECT_START_FIELD` | Start date field name, default `Start` |
| `OPENSPEC_BUDDY_PROJECT_END_FIELD` | End date field name, default `End` |
| `OPENSPEC_BUDDY_PR_DEVELOPMENT_LINK_MODE` | PR Development link policy: `auto` default, `keyword`, `manual`, or `off` |

The Project is the human-visible coordination board. Labels and issue metadata remain the agent execution source of truth, but every issue status transition must also mirror to the Project `Status` field.

## Issue Development Branches

Claiming a Buddy issue must create the implementation branch through GitHub's
Development linkage, not through a plain `git push` alone:

```bash
gh issue develop <issue-number> --name <change_id> --base "$OPENSPEC_BUDDY_BASE_BRANCH"
gh issue develop --list <issue-number>
```

The branch name must remain `change_id`. If the branch is created but
`gh issue develop --list` does not show it on the issue, stop before marking the
claim valid; a remote branch without the issue Development link is not a
complete Buddy claim.

## PR Coordination

Every Buddy implementation PR must be coordinated with the same Project and
labels as its originating issue before the review wait starts.

After creating a ready PR against `$OPENSPEC_BUDDY_BASE_BRANCH`, run:

```bash
<openspec-buddy-skill-dir>/scripts/configure-pr-metadata.sh <issue-number> <pr-number-or-url>
```

The helper must:

- add `pr:openspec-buddy`
- add `pr:base-<base-branch>`
- copy the issue's non-status coordination labels to the PR:
  `type:*`, `level:*`, `area:*`, `series:*`, `risk:*`, `mode:*`, and
  `coupling:*`
- mirror the issue assignees onto the PR
- add the PR to the same Project as the issue
- set the PR Project `Status` to `In Progress`
- record the origin issue in the PR body
- create a verifiable PR Development link when the configured policy and PR
  base branch allow it

Do not copy `status:*` labels to PRs. Issue status remains the Buddy execution
state, while `pr:*` labels describe PR-specific review metadata.

Before moving the issue to review, run:

```bash
<openspec-buddy-skill-dir>/scripts/request-pr-review.sh <pr-number-or-url>
<openspec-buddy-skill-dir>/scripts/verify-pr-coordination.sh <issue-number> <pr-number-or-url>
```

The review request must come from `OPENSPEC_BUDDY_PR_REVIEW_REQUEST`. For
projects that require Codex review, configure that value explicitly. The
request must preserve complete code review scope: correctness, regression
risk, edge cases, tests, maintainability, security, data consistency, and
compatibility with existing behavior. Acceptance and scope checks are additional
checks, not a replacement for normal review. The additional checks are
Acceptance Checklist coverage, scope drift, and unregistered requirement
detection. A good request is:

```text
@codex review

请进行完整代码审查，包括正确性、回归风险、边界条件、测试覆盖、可维护性、安全性、数据一致性和现有行为兼容性。

此外，请额外检查：
1. 本 PR 是否仍在原 issue / OpenSpec change 的范围内。
2. 实现是否覆盖 issue 中的 Acceptance Checklist。
3. 每个已声明完成的 task 是否有足够 evidence 支撑。
4. 是否引入了未在 issue / spec / task 中登记的新需求或范围扩张。
5. 如果发现缺陷，请指出它关联的 AC / task；如果无法关联，请说明是否代表 checklist 缺项。

中文回复，即使没有重大问题也必须给出显式回复。
```
The helper treats an existing request as fresh only when it was posted after the
current PR head commit; after a fix push, it appends a new request instead of
reusing a stale one.
Before merging after the review wait, run
`<openspec-buddy-skill-dir>/scripts/verify-review-clear.sh <pr-number-or-url>`.
This check reads review body, review comments, and GraphQL review threads; an
empty `gh pr view --comments` result is not evidence that Codex review feedback
is clear. If the helper passes through a top-level PR clear comment, it must
print the matched current-head review request and the later clear comment
excerpt, timestamp, and URL. Use that returned excerpt as the human judgment
record for "no major issues"; do not rely on broad PR comment text matching.

When resolving a GitHub review thread, use:

```bash
<openspec-buddy-skill-dir>/scripts/resolve-review-thread.sh <review-thread-node-id>
```

Do not hand-write the `resolveReviewThread` GraphQL mutation. The helper runs
the mutation and then re-queries the same thread; a non-zero exit means the
thread is still not verified as resolved and the merge gate remains closed.

GitHub CLI has no direct `gh issue link-pr` equivalent. For a PR to appear as a
verifiable issue Development link through CLI, the PR body must contain a
closing keyword such as `Closes #123` and the PR must target the repository
default branch. The helper uses that path only when
`OPENSPEC_BUDDY_PR_DEVELOPMENT_LINK_MODE=keyword`, or when the mode is `auto`
and the PR base already equals the default branch. It then verifies
`gh pr view --json closingIssuesReferences` contains the issue number.

When Buddy PRs target a non-default base branch, do not write a closing keyword
and then claim the Development link is complete. GitHub will not report a
verifiable `closingIssuesReferences` link in that case. Use
`OPENSPEC_BUDDY_PR_DEVELOPMENT_LINK_MODE=manual`, or the default `auto` mode's
manual-link notice, and link the PR from GitHub's Development sidebar.

## Command

After creating the issue, run:

```bash
<openspec-buddy-skill-dir>/scripts/add-issue-to-project.sh <issue-url>
```

The script is idempotent: if the issue is already present in the Project, it reports the existing item id and does not add a duplicate.
It also sets the Project `Status` to `Todo` for a newly registered `status:ready` issue.

## Status Sync

Whenever an issue `status:*` label changes, run:

```bash
<openspec-buddy-skill-dir>/scripts/set-status-label.sh <issue-number> <status:label>
```

Do not edit status labels directly with `gh issue edit`; the wrapper also updates the Project `Status`.

Project status mapping:

| Issue label | Project `Status` |
| --- | --- |
| `status:backlog`, `status:ready`, `status:blocked`, `status:tracking`, `status:stale-claim`, `status:needs-human`, `status:failed` | `Todo` |
| `status:claimed`, `status:in-progress`, `status:in-review` | `In Progress` |
| `status:archived` | `Done` |
| `status:merged` | `Done` only for legacy or recovery flows |

`status:archived` is the normal completed-change state. A current Buddy PR
should already contain the OpenSpec archive directory before review, so
`status:merged` is not a normal intermediate state. Use `status:merged` only
when repairing an older PR that merged before pre-archive became the default,
and move it to `status:archived` after the archive path, main specs, issue
comment, Project `Status`, and Project `End` all agree. Series parent issues
start as `status:tracking`, but once all child changes are closed with
`status:archived`, the parent must also move to `status:archived`, Project
`Status: Done`, and Project `End` set.

## Overrides

Required Project variables:

```bash
OPENSPEC_BUDDY_PROJECT_OWNER=<owner>
OPENSPEC_BUDDY_PROJECT_NUMBER=<number>
OPENSPEC_BUDDY_PROJECT_TITLE=<title>
```

Project-local defaults should live in `.env.openspec-buddy`. Non-empty process
environment values override that file for one-off repairs.

## Date Fields

The default Project has `Start` and `End` date fields.

- `claim-change.sh` sets `Start` to the local date after the branch lock, assignee, label, and claim comment are confirmed.
- `mark-achieved.sh` sets `End` to the local date after `status:archived` is recorded.
- `close-completed-series-parent.sh` sets parent `End` when the last child change in a series is archived.

For manual repair, use:

```bash
<openspec-buddy-skill-dir>/scripts/set-project-date.sh <issue> Start YYYY-MM-DD
<openspec-buddy-skill-dir>/scripts/set-project-date.sh <issue> End YYYY-MM-DD
```
