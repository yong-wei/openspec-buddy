# OpenSpec Buddy Issue Relationships

GitHub Issue relationships are the cross-agent scheduling truth. Issue front matter keeps an auditable mirror, but native GitHub relationships decide whether a change can be claimed.

## Series Parent

For a planned series, create one parent issue before creating child change issues:

```bash
<openspec-buddy-skill-dir>/scripts/create-series-parent.sh <series-name> [title]
```

The parent issue uses:

```text
type:series-parent
status:tracking
series:<series-name>
```

It is not an executable OpenSpec change and must never be selected by `apply` or `auto`.

## Series Parent Completion

After each child change is archived, check the linked series parent. When every
sub-issue under the parent is closed and labeled `status:archived`, finalize the
parent issue too:

```bash
<openspec-buddy-skill-dir>/scripts/close-completed-series-parent.sh <child-or-parent-issue>
```

Finalization changes the parent from `status:tracking` to `status:archived`,
sets the Project `Status` to `Done`, sets Project `End` to the local date, and
closes the parent with a comment listing the archived child changes. If any
child issue is still open or not archived, leave the parent as `status:tracking`.

## Parent Link

After creating each child issue, link it to the series parent:

```bash
<openspec-buddy-skill-dir>/scripts/link-issue-parent.sh <parent-issue> <child-issue>
```

This uses GitHub `addSubIssue`; the child issue then shows the parent issue in GitHub Projects.

## Dependency Link

When change A depends on change B:

```bash
<openspec-buddy-skill-dir>/scripts/link-issue-dependencies.sh <issue-A> <issue-B>
```

This records A as `marked as blocked by` B. GitHub also shows B as `marking as blocking` A.

Do not claim issue A while its `blockedBy` relationship contains any open, unarchived issue.

## Relationship Verification

Use the relationship list and verifier when diagnosing drift:

```bash
<openspec-buddy-skill-dir>/scripts/list-ready-change-relationships.sh 100
node <openspec-buddy-skill-dir>/scripts/verify-issue-relationships.mjs < relationships.json
```

The verifier is a consistency check. The claim gate still uses GitHub native `blockedBy` relationships, not front matter alone.
Pass `requireParent: true` in the input JSON only when auditing a newly registered series that should already have parent links; older issues may not have that relationship.

## Project Dates

Project date fields are managed by script:

```bash
<openspec-buddy-skill-dir>/scripts/set-project-date.sh <issue> Start YYYY-MM-DD
<openspec-buddy-skill-dir>/scripts/set-project-date.sh <issue> End YYYY-MM-DD
```

`claim-change.sh` sets `Start` after a successful claim. `mark-achieved.sh` sets `End` after archive status is recorded.
