# Explore Routing Reference

Explore is the read-only uncertainty-resolution phase of manual OpenSpec Buddy.
The driver may recommend an optional discovery method when its skill is
available. Availability changes only the recommendation: an unavailable skill
always uses the corresponding native fallback, so Explore remains usable on a
plain installation.

## Question Routing

| Question type | Optional method | Native fallback |
| --- | --- | --- |
| Unclear intent | `grilling` | Ask one-question clarification at a time until the consequential ambiguity is resolved. |
| Missing facts | `research` | Conduct a primary-source investigation and distinguish evidence from inference. |
| Undecidable interaction or state | `prototype` | Build the smallest throwaway experiment needed to observe the disputed behavior, then discard it. |
| Active change design issue | `openspec-explore` | Use the native OpenSpec exploration workflow for the active change; this route does not depend on the optional method detector. |

Choose the route from the uncertainty that blocks a decision, not from which
optional skill happens to be installed. If several uncertainties exist, handle
the earliest one whose answer can eliminate the others.

## Read-Only Contract

Explore may read source files, history, tests, logs, OpenSpec artifacts, and
primary documentation. A throwaway experiment must run outside tracked project
state or in an ephemeral location and must leave the worktree unchanged.

Do not create or edit OpenSpec changes, issue bodies, branches, commits, pull
requests, GitHub Issues, Project fields, labels, claims, or caches. Do not push
or perform any other repository or remote mutation. Once the uncertainty is
resolved, return the evidence and recommendation; enter claim, propose, or
apply through a separate driver invocation if the user authorizes that phase.

## Auto Exclusion

Buddy Auto is excluded from Explore and does not gain an `explore` state.
Exploration is a user-invoked manual Buddy phase; the Auto controller continues
to select and advance executable work through its existing lifecycle only.
