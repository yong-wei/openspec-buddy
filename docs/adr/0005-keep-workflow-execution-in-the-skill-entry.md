# Keep workflow execution in the skill Auto entry

Buddy Auto workflow execution remains behind the single skill-owned `buddy-auto.mjs` entry: its default is Lightweight Mode and the explicit `full` subcommand selects Full Mode. The npm `openspec-buddy` CLI remains limited to skill distribution and configuration, avoiding a second workflow surface while preserving one discoverable mode boundary.
