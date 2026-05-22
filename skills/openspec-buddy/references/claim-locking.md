# OpenSpec Buddy Claim Locking

Labels alone are not a distributed lock. `openspec-buddy apply` must use a remote branch lock plus issue metadata.

## Claim Proof

A valid claim has all of these:

```text
origin/<change_id> exists
issue has status:claimed or status:in-progress
issue has the claiming assignee
latest OpenSpec Buddy Claim comment records claim_id, branch, base_sha, and lease_until
claim_branch == change_id
```

The branch lock is created before issue status is changed. If status update or claim comment fails, the claim script removes the just-created remote branch.

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

Default lease duration is 6 hours. Override only for a specific run:

```bash
OPENSPEC_BUDDY_CLAIM_TTL_HOURS=12 <openspec-buddy-skill-dir>/scripts/claim-change.sh <issue-number>
```

Long-running auto workflows should refresh the issue with progress comments after major transitions rather than silently holding a stale branch.
