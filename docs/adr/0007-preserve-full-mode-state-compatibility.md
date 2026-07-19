# Preserve Full Mode behavior and state compatibility

Moving the existing controller modules under `scripts/full/` does not change their behavior, environment inputs, persisted state locations or formats, output protocol, or recovery parameters. Only the public selection boundary changes: Full Mode now requires `buddy-auto.mjs full`, allowing in-progress full workflows to continue without state migration while making Lightweight Mode the deliberate default.
