# Contributing to edit.gtfs.zone

## Commit Message Guidelines

This project uses [Conventional Commits](https://www.conventionalcommits.org/) to automate versioning and changelog generation.

### Using Commitizen

Instead of `git commit`, use:

```bash
pnpm commit
```

This will prompt you to fill out the commit message following the conventional format. `git commit` also works, as long as the message is valid.

`cz` is the Python [Commitizen](https://commitizen-tools.github.io/commitizen/), not the npm package. Install it with:

```bash
pipx install commitizen
```

### Commit Message Format

Each commit message consists of a **type**, an optional **scope**, and a **subject**:

```
<type>(<scope>): <subject>
```

#### Types

- `feat`: A new feature (triggers minor version bump)
- `fix`: A bug fix (triggers patch version bump)
- `docs`: Documentation only changes
- `style`: Changes that don't affect the meaning of the code (white-space, formatting, etc)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A performance improvement
- `test`: Adding missing tests or correcting existing tests
- `build`: Changes that affect the build system or external dependencies
- `ci`: Changes to CI configuration files and scripts
- `chore`: Other changes that don't modify src or test files
- `revert`: Reverts a previous commit

#### Breaking Changes

Add `BREAKING CHANGE:` in the commit body or add `!` after the type/scope to trigger a major version bump:

```bash
feat!: remove support for old API
```

### Examples

```bash
feat(stop-view): add trip creation button
fix(gtfs-parser): handle null arrival times correctly
docs: update installation instructions
refactor(utils): simplify field component logic
```

## Versioning

This project uses [Commitizen](https://commitizen-tools.github.io/commitizen/) (`cz`) for versioning and changelog generation.

### Creating Releases

When you're ready to release, run on `main`:

```bash
cz bump
```

This will:
- Bump the version in `package.json` based on commit history
- Update `CHANGELOG.md`
- Create a git tag

Then push the commit and the tag:

```bash
git push --follow-tags origin main
```

Pushing a version tag triggers `.github/workflows/pages.yml`, which builds the app and publishes it to GitHub Pages.

## Development Workflow

1. Create a feature branch from `main`
2. Make your changes
3. Commit using `pnpm commit` (this ensures proper commit format)
4. Push your branch and create a pull request
5. After merge to `main`, run `cz bump` for releases when ready

## Changing gtfs-zone-web-common

Modules shared with the other gtfs.zone apps live in [gtfs-zone-web-common](https://github.com/gtfs-zone/gtfs-zone-web-common) and are not edited here. A shared change is:

1. A commit in gtfs-zone-web-common
2. A new tag in gtfs-zone-web-common, pushed to GitHub
3. A bump of the `gtfs-zone-web-common` tag in `package.json` here (and in each other consumer), then `pnpm install`

Restart the dev server after the bump: Vite does not watch `node_modules`, so a running server can keep serving the old copy.

## Git Hooks

This project uses Husky to enforce quality standards:

- **pre-commit**: Runs linting and formatting on staged files, then `pnpm check-spec`
- **commit-msg**: Validates commit message format using commitlint

If your commit message doesn't follow the conventional format, the commit will be rejected with a helpful error message.
