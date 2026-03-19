# Contributing to edit.gtfs.zone

## Commit Message Guidelines

This project uses [Conventional Commits](https://www.conventionalcommits.org/) to automate versioning and changelog generation.

### Using Commitizen

Instead of `git commit`, use:

```bash
npm run commit
```

This will prompt you to fill out the commit message following the conventional format.

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

## Development Workflow

1. Create a feature branch from `main`
2. Make your changes
3. Commit using `npm run commit` (this ensures proper commit format)
4. Push your branch and create a pull request
5. After merge to `main`, run `cz bump` for releases when ready

## Git Hooks

This project uses Husky to enforce quality standards:

- **pre-commit**: Runs linting and formatting on staged files
- **commit-msg**: Validates commit message format using commitlint

If your commit message doesn't follow the conventional format, the commit will be rejected with a helpful error message.
