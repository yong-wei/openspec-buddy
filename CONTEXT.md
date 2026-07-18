# OpenSpec Buddy

OpenSpec Buddy coordinates OpenSpec changes across agents and worktrees while preserving a lightweight path for changes that need no remote coordination.

## Language

**Lightweight Mode**:
The default Buddy Auto mode that relies on live GitHub and OpenSpec facts plus main-model judgment, retaining only the coordination needed to prevent duplicate ownership, scope drift, and unsafe merge.
_Avoid_: Simple controller, basic mode

**Full Mode**:
The explicitly selected Buddy Auto mode that retains Project coordination, multi-lane scheduling, caches, persisted controller state, signed receipts, and complex recovery behavior.
_Avoid_: Legacy mode, advanced default

**Auto Entry**:
The single skill-owned `buddy-auto.mjs` workflow entry. It selects Lightweight Mode by default, accepts an explicit no-PR modifier only for a Local-only change, and selects Full Mode through the `full` subcommand; the npm distribution CLI remains responsible only for installing and configuring skills.
_Avoid_: npm auto command, separate full entry

**Coordination Script**:
One of the three deterministic Lightweight Mode operations: select an Available Issue, establish and verify a Claim, or replace and verify a Progress Status. Coordination Scripts protect shared ownership facts but do not prescribe implementation, review, merge, or completion lifecycles.
_Avoid_: Phase helper, lightweight controller

**Issue-backed change**:
An active local OpenSpec change registered by a GitHub Issue. An untargeted run selects it only while the Issue is Available; explicit or resumed execution still obeys the Issue's live coordination facts.
_Avoid_: Registered change, coordinated task

**Local-only change**:
An active local OpenSpec change with no GitHub Issue. It defaults to normal PR delivery when the user explicitly targets it, but the user may explicitly choose a no-PR delivery; Buddy warns that the change has no Issue in either case.
_Avoid_: No-issue change, unregistered change

**Direct Integration Delivery**:
The explicit no-PR delivery of a Local-only change from its tested, locally reviewed, archived, and pushed implementation branch into the configured integration branch by fast-forward only. A changed integration baseline requires the implementation branch to be updated and reverified; force push is never part of this delivery.
_Avoid_: Local-only commit, direct force merge

**Available Issue**:
An open GitHub Issue labeled `status:ready` that explicitly identifies a corresponding local OpenSpec change and has no open blocking dependency. Lightweight selection does not consider series affinity, Project fields, risk, mode, or other full-mode metadata; an Available Issue without its local change cannot proceed automatically.
_Avoid_: Ready ticket, executable issue

**Selection Order**:
The deterministic ordering of Available Issues by ascending Issue number. After a proven Claim race loss, lightweight Buddy rereads live Issue facts and selects the next Available Issue; an ambiguous or partially applied Claim stops execution instead of being skipped or recovered automatically.
_Avoid_: Priority score, GitHub result order

**Blocking Dependency**:
An open GitHub Issue linked through GitHub's native `blockedBy` relationship. It is the only dependency source used by lightweight selection; body metadata, series order, and cached relationship state have no authority.
_Avoid_: `depends_on`, series predecessor

**Claim**:
The exclusive ownership of an Issue-backed change, established by first creating the remote branch named by its `change_id` and reflected by one assignee and a structured claim comment. A Claim has no lease, cache-derived authority, Project state, or recovery state machine.
_Avoid_: Reservation, local claim state

**Claim Consistency**:
The agreement of the live Issue, remote claim branch, sole assignee, latest structured Claim comment, and agent/worktree identity. A consistent tuple proves either the current executor's resumable Claim or another executor's Claim; an isolated branch or any conflicting tuple proves neither and stops lightweight execution without takeover or repair.
_Avoid_: Branch ownership, same-user ownership

**Partial Claim**:
A failed Claim attempt whose reread remote facts do not form a complete Claim Consistency tuple. Lightweight Buddy reports the exact observed facts and stops; it does not fill missing writes, roll back completed writes, delete the branch, or restore readiness.
_Avoid_: Recoverable claim, pending claim state

**Progress Status**:
One of the human-visible Issue labels `status:ready`, `status:claimed`, `status:in-progress`, or `status:in-review`. Lightweight Buddy records these labels without using them as a general workflow engine.
_Avoid_: Controller stage, persisted state

**Status Update**:
A verified replacement of an Issue's existing `status:*` label with one Progress Status. The Claim establishes `status:claimed`; the main model decides when later Status Updates reflect implementation and review progress.
_Avoid_: State transition, controller advancement

**Explicit Target**:
A change the user has clearly named for execution, independent of any particular command spelling. An Explicit Target limits the run to that single Issue or change and may authorize a Local-only change only when no mapped Issue exists; targeting by change id never overrides existing Issue coordination or falls through to unrelated work.
_Avoid_: CLI target, forced change

**Untargeted Run**:
A Lightweight Mode run that repeatedly selects the smallest Available Issue, completes it through merge and Issue archival, and continues until no Available Issue remains or a blocker stops execution.
_Avoid_: Goal mode, batch controller

**Clearance Comment**:
An explicit Codex review response stating that the latest submitted revision has no remaining significant or major issue. Quota exhaustion, service failure, silence, ambiguous approval, or a response about an older revision is not a Clearance Comment.
_Avoid_: Review success, quiet review, assumed approval

**Review Request**:
A visible top-level PR comment that asks Codex for a complete review and requires an explicit response even when no significant issue is found. A new Review Request follows either a changed PR head or a completed no-change feedback resolution whose request explains why the reviewed revision was not modified.
_Avoid_: Reviewer assignment, configured review receipt

**Review Resolution**:
The completed handling of Codex feedback: relevant threads are answered and resolved, and any required code change is tested and pushed. A no-change resolution records why no modification was warranted and still requires another Review Request; neither the explanation nor resolved thread is a Clearance Comment.
_Avoid_: Thread closure as clearance, implicit approval

**Review Window**:
A single bounded period for receiving Codex review after a Review Request: the first check occurs after 300 seconds, subsequent live checks occur every 60 seconds, and the window ends after 900 seconds. Ending a Review Window does not itself authorize another request or any merge action.
_Avoid_: Review controller, retry round

**Timeout Retry**:
The one additional Review Request automatically allowed after the first Review Window ends without a Codex response. The request visibly identifies itself as the single timeout retry so GitHub chronology, rather than persisted retry state, prevents another automatic retry; a second timeout requires explicit user recovery.
_Avoid_: Retry counter, indefinite review loop

**Review Blocker**:
A review outcome that cannot establish clearance, including quota exhaustion or service failure. An explicit service-capacity Review Blocker stops lightweight automation immediately, does not consume or trigger a Timeout Retry, and requires explicit user recovery.
_Avoid_: Review retry state, unavailable clearance

**Local Review**:
The pre-commit examination of the complete change diff, scope boundaries, test evidence, and omission risks by the GPT-5.6 main model. An independent subagent review is optional when the user has authorized subagents and the main model judges that the change risk warrants it.
_Avoid_: Mandatory subagent review, review gate

**Completed Change**:
A change whose tasks and implementation are complete, whose scope and tests have passed Local Review, and whose validated archive and synchronized specifications share one delivery unit with the implementation: an implementation PR or an explicit Direct Integration Delivery.
_Avoid_: Pre-archived state, implementation-only completion

**Archived Issue**:
A closed Issue-backed change whose only `status:*` label is `status:archived` and whose completion comment identifies the merged PR and OpenSpec archive path. Issue closure, label, and comment are required completion truth; deletion of the merged Claim branch is best-effort cleanup and does not determine completion.
_Avoid_: Merged ticket, deleted branch proof
