# Core Lifecycle Reference

The top-level `SKILL.md` is intentionally short. It tells the agent to run the
driver first. This file holds the stage rules the driver points to.

## Driver Rule

Every manual Buddy phase starts with:

```bash
<openspec-buddy-skill-dir>/scripts/buddy-driver.mjs --mode <explore|claim|propose|apply|achieve>
```

Use `--issue`, `--pr`, `--change`, `--no-issue`, or `--run-next` when the
driver asks for them. Do not substitute manual `gh`, `git`, `sleep`, or
handwritten GraphQL checks for a Buddy helper.

## Explore

Explore is a read-only manual Buddy phase for resolving uncertainty before a
claim, proposal, or implementation decision. It may inspect repository and
primary-source evidence, clarify intent, or run a disposable experiment, but
it must not mutate repository or GitHub state. Follow
`references/explore-routing.md` for question classification, optional method
selection, and the native fallback.

Invoke it with the matching question classification:

```bash
<openspec-buddy-skill-dir>/scripts/buddy-driver.mjs --mode explore --explore-question <intent|facts|interaction-state|active-change-design>
```

## Claim

Use claim for an existing GitHub issue. The claim helper is the hard gate:

```bash
<openspec-buddy-skill-dir>/scripts/claim-issue.sh [issue-number]
```

It verifies the bound worktree, synchronizes the base branch, reads current
GitHub truth, writes only the minimal claim lock, then re-reads GitHub truth.
Only after the lock belongs to this run and worktree may it create or reuse the
Development branch, Project fields, and remote claim branch.

An ordinary open issue is claim-first: acquire and verify the minimal claim
lock, re-read live issue truth, then run triage. Missing triage produces a
`HANDOFF` while the verified lock remains active; it does not authorize later
coordination or implementation mutations. The triage judgment must be bound to
the re-read issue `updatedAt` and inspected base SHA.

If the issue is ordinary, claim adopts that same issue by adding hidden Buddy
metadata. If the issue is too large, decompose it into child issues and make the
source issue a `type:series-parent` tracking record.

## Propose

Use propose to create a local OpenSpec change and, by default, the matching
GitHub issue.

Default propose is deliberately lightweight. The model owns proposal quality;
Buddy owns only coordination identity and dependencies.

1. Create one OpenSpec change for each independently deliverable outcome and
   run the repository's normal OpenSpec validation.
2. Commit and push the reviewed proposal artifacts to the configured base
   branch so other worktrees can see them.
3. Create one open GitHub Issue per executable change. The body contains exactly
   one mapping marker:

   ```markdown
   <!-- openspec-buddy change_id: example-change -->
   ```

4. Add only the required labels `type:change` and `status:ready`. Additional
   labels are optional and must never block registration.
5. When a change truly depends on another Issue, record the dependency with
   GitHub's native `blockedBy` relationship. Do not mirror it in issue metadata.
6. Read the Issue and expected dependency edges back once, then repeat the
   open-and-closed Issue search to confirm the mapping is still globally unique.
   If a concurrent duplicate exists, close the newly created Issue with a
   comment linking the existing mapping, and report the conflict. Then stop;
   propose does not claim the Issue or start implementation.

Before creating an Issue, inspect the bodies of existing open and closed Issues
for the exact `change_id` mapping. Recognize all formats accepted by Auto lite:
the lightweight single-line marker, legacy hidden metadata, and YAML front
matter. Reuse a unique existing Issue; stop on conflicting IDs, duplicate
mapping sources, or multiple Issues for the same change. Apply the same parsing
rules to the post-create uniqueness check.
Use ordinary engineering judgment for scope, duplication, testing, and
acceptance. `.buddy/triage.json`, `.buddy/proposal-review.yaml`, a prescribed
Testing Strategy schema, task-to-AC mapping, Project membership, and independent
proposal review are not default propose gates.

The Issue may summarize the goal, scope, acceptance, and proposal commit. Do
not copy the complete OpenSpec task structure into the Issue.

Use `--no-issue` only for intentionally local-only changes. That path creates
no GitHub issue, Project item, Development link, or claim branch.

## Apply

Use apply only after claim ownership is clear. Before editing files:

```bash
<openspec-buddy-skill-dir>/scripts/sync-base-branch.sh
<openspec-buddy-skill-dir>/scripts/mark-in-progress.sh <issue-number>
```

Matt TDD is an optional provider that changes the implementation method only.
When it is unavailable, the Buddy-native fallback is red-before-green,
public-interface tests, one vertical cycle at a time, and minimal
implementation. Provider availability never changes Buddy state, receipts,
artifacts, or lifecycle gates. Provider-specific refactoring advice is not a
Buddy gate; the existing independent review requirements below remain
authoritative.

The implementation branch is the declared `claim_branch` and must equal
`change_id`. Before opening a PR, local OpenSpec progress must be complete:

```bash
openspec instructions apply --change <change_id> --json
openspec validate <change_id> --strict
openspec archive <change_id> --yes
openspec validate <affected-capability> --strict
```

If a delta introduces a new capability and the main spec does not exist, create
the main spec skeleton before archiving.

If the issue contains an Acceptance Checklist, do not let the implementation
thread approve its own checklist items. Before the first implementation commit
or PR creation, run an independent review with the issue body, task-to-AC
mapping, current diff, and evidence. The review must explicitly return:

```text
approved_to_commit
approved_ac
rejected_ac
scope_status
regression_risk
required_fixes
```

Commit or PR creation may proceed only when `approved_to_commit: yes`. Only
items listed in `approved_ac` may be checked in the GitHub issue checklist or
issue tasks.

## Review And PR

For GitHub-backed work, do not implement PR coordination by hand. Use:

```bash
<openspec-buddy-skill-dir>/scripts/mark-review.sh <issue-number> <pr-number-or-url>
```

The helper configures PR labels, assignees, Project state, origin issue,
Development-link policy, review request, and coordination verification before
the issue enters `status:in-review`.

Review waiting belongs to Buddy Auto's driver. Manual Buddy runs may call the
same helper only when the PR coordination gate has passed:

```bash
<openspec-buddy-skill-dir>/scripts/wait-for-review-clear.sh <pr-number-or-url>
```

Do not infer clean review from `gh pr view --comments`.

## Achieve

After merge, keep the claim branch until issue achievement sync is complete:

```bash
<openspec-buddy-skill-dir>/scripts/verify-review-clear.sh <pr-number-or-url>
<openspec-buddy-skill-dir>/scripts/mark-achieved.sh <issue-number> <archive-path> <pr-number-or-url>
```

`mark-achieved.sh` verifies archived tasks, sets `status:archived`, updates
Project `Done` and `End`, closes the issue, and reconciles completed series
parents.
