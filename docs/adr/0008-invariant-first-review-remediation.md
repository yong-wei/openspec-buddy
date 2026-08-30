# Use invariant-first review remediation

Review feedback can describe one failure category through several symptoms, so point-by-point conditions can leave the shared defect intact and make later reviews repeat the same finding. After feedback arrives, group findings by violated invariant or common root cause, then audit the complete affected state machine, authority boundary, read/write path, and validation path.

When multiple findings share a root cause in one round, or the same failure category recurs, the workflow requires invariant-level re-derivation and one fix covering the full impact surface. The reported trigger scenarios and sibling paths must have regression evidence. Review count is not a stopping condition.

If a root fix would expand the current OpenSpec scope, public API, or data model, stop and request authorization. This keeps remediation within the approved change while making repeated review feedback a signal to revisit the invariant rather than add another local branch.
