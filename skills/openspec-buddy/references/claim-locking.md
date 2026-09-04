# OpenSpec Buddy Claim Locking

Labels alone are not a distributed lock. `openspec-buddy claim` must use a remote branch lock plus issue metadata before any exploration, decomposition, or implementation work.

## Claim Proof

A valid claim has all of these:

```text
origin/<change_id> exists
issue has status:claimed, status:in-progress, or status:in-review
issue has the claiming assignee
latest OpenSpec Buddy Claim comment records claim_id, branch, base_sha, and lease_until
claim_branch == change_id
```

The minimal lock writes the hidden metadata, assignee, active claim comment, and
`status:claimed`, then re-reads remote truth. Only after that verification does
the helper create and verify the Development branch and remote branch lock. If
the post-lock branch creation fails, the claim script releases the claim. For
ordinary open issues, `claim-issue.sh` preserves the original human-readable
body while adding the hidden metadata.

For an unmapped Issue, direct claim derives one stable provisional `change_id`
and records `direct_claim: true` in its hidden metadata. It still proves
ownership with the assignee, active claim comment, Development link, and remote
branch; its only difference is the mandatory handoff to OpenSpec Explore and
proposal adoption before triage or implementation. A resumed direct claim must
re-verify that same ownership proof and return to that handoff. After proposal
push advances the base branch, `apply --resume-active` alone may refresh it:
the base must be a descendant of the recorded SHA, the claim branch must still
be at the recorded SHA (or already at the new base after a retry), the pushed
base must contain the proposal, and no open PR may exist. The refresh keeps the
same claim id, lease, and worktree identity, then reruns normal strict claim
verification. Any other branch head, ownership drift, expired lease, or base
rewrite stops for recovery.

The local claim receipt and cache are not part of this proof. Before reusing a
claim after restart, worktree switching, or timeout recovery, query the live
claim truth:

```bash
<openspec-buddy-skill-dir>/scripts/read-live-claim-truth.sh <issue-number> --json
```

Only `status: owned` authorizes continuation. `missing` and `expired` return to
the claim path, `foreign` refuses takeover, and a REST failure blocks because
it is not evidence that the claim is absent.

## Triage Backfill And Freshness

Prepared changes created before the triage contract may be missing
`.buddy/triage.json`. Treat this as a compatibility backfill, not as immediate
invalidation: after live ownership is verified, keep the existing artifacts and
preserve the verified claim lock, return `HANDOFF`, and require the triage file
before Development, Project, or implementation mutation continues. Do not
recreate the change or acquire a second claim.

The backfilled judgment is valid only for the facts it inspected. Pass the
current issue `updatedAt` and base SHA to `validate-triage.mjs`. If either value
changes or mismatches the recorded binding, the triage judgment is stale and
invalid. Re-read live ownership and evidence, regenerate the judgment, and
validate it again; never reuse a stale result as permission to mutate state.

## Stale Claim Recovery

Do not reclaim automatically unless every condition is true:

```text
lease_until is in the past
no open PR exists for the claim branch
origin/<change_id> still equals recorded base_sha, or the branch has no commits beyond base_sha
no newer OpenSpec Buddy Claim comment exists
```

If any condition is unclear, set `status:needs-human` and stop.

## Lease

Default lease duration is 12 hours. Override only for a specific run:

```bash
OPENSPEC_BUDDY_CLAIM_TTL_HOURS=12 <openspec-buddy-skill-dir>/scripts/claim-issue.sh <issue-number>
```

Set `OPENSPEC_BUDDY_AGENT` for every Claim to the actual `harness/model`, such
as `codex/gpt-5.6-sol`. This value is attribution only. Ownership checks use
the GitHub comment author, assignee, claim id, and worktree identity.

Long-running auto workflows should refresh the issue with progress comments after major transitions rather than silently holding a stale branch.

Issue, PR, relationship, and Project read caches remain performance aids. They
must be force-refreshed before claim dependency acceptance or any coordination
write; they never authorize a claim or replace the remote issue, comment, branch,
or lease truth.
