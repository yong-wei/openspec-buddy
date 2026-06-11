#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

python3 - "$repo_root" <<'PY'
from pathlib import Path
import sys

repo_root = Path(sys.argv[1])
targets = [
    repo_root / "skills/openspec-buddy/scripts/link-issue-parent.sh",
    repo_root / "skills/openspec-buddy/scripts/close-completed-series-parent.sh",
]

for path in targets:
    text = path.read_text()
    if "gh api graphql \\\n  -R " in text or "gh api graphql -R " in text:
        sys.stderr.write(f"{path} should not pass -R to 'gh api graphql'.\n")
        sys.exit(1)

print("github cli compat tests passed")
PY
