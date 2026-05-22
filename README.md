# OpenSpec Buddy

Versioned distribution for the `openspec-buddy` and `openspec-buddy-auto`
agent skills.

The repository is the source of truth for both skills. Local global skills can
be symlinked to this checkout for development, while collaborators should use
explicit npm or Git upgrades so skill changes are reviewable and repeatable.

## Install

Global npm install:

```bash
npm install -g openspec-buddy
openspec-buddy install --target agents --force
```

One-shot installs with common JavaScript CLIs:

```bash
npx openspec-buddy install --target agents --force
pnpm dlx openspec-buddy install --target agents --force
yarn dlx openspec-buddy install --target agents --force
bunx openspec-buddy install --target agents --force
```

Install targets:

- `agents`: `$HOME/.agents/skills`
- `codex`: `$CODEX_HOME/skills`, or `$HOME/.codex/skills`
- `project`: `./.agents/skills` in the current project

For local skill development from a Git checkout:

```bash
git clone https://github.com/yong-wei/openspec-buddy.git
cd openspec-buddy
npm install
npm test
openspec-buddy install --target agents --mode symlink --source ./skills --force
```

## First Project Setup

The first time either skill is used in a project, create project-local Buddy
configuration:

```bash
openspec-buddy init
```

The command asks for:

- Buddy base branch
- release branch
- GitHub Project owner
- GitHub Project number
- GitHub Project title
- optional auto-review request for `openspec-buddy-auto`

It writes `.env.openspec-buddy` in the current project. Keep that file out of
git unless the project explicitly wants a committed example.
Use `.env.openspec-buddy.example` as the field reference when preparing a
project template.

Verify configuration:

```bash
$HOME/.agents/skills/openspec-buddy/scripts/check-config.sh
$HOME/.agents/skills/openspec-buddy/scripts/check-config.sh auto
```

## Commands

```bash
openspec-buddy install --target agents --mode copy --force
openspec-buddy install --target project --mode copy
openspec-buddy install --target agents --mode symlink --source ./skills --force
openspec-buddy init
openspec-buddy doctor --target agents
openspec-buddy version
```

Default installer mode is `copy`, which is safer for collaborators because npm
upgrades are explicit. Use `symlink` only when editing this repository directly.

## Release

The package version is stored in `package.json`. Release tags use the
`vMAJOR.MINOR.PATCH` format.

Local verification:

```bash
npm run check
```

Publish to npm after logging in:

```bash
npm login
npm publish --access public
```

`package.json` pins `publishConfig.registry` to `https://registry.npmjs.org/`
so publishing does not accidentally target a mirror registry.

## Repository Layout

```text
skills/openspec-buddy/       Core Buddy skill, scripts, references, evals
skills/openspec-buddy-auto/  Automation skill and references
src/cli.mjs                  npm CLI implementation
bin/openspec-buddy.mjs       executable entrypoint
test/                        package installer/config tests
docs/memory/                 stable project memory for future agents
```
