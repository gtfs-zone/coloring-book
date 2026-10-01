# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/gtfs-zone/gtfs-zone-editor/security/advisories/new).
Do not open a public issue.

If you cannot use GitHub, email maxkatzchristy@gmail.com instead.

## Supported versions

Only the latest release is supported. That is the version deployed at <https://edit.gtfs.zone>. Fixes are not backported to older tags.

## Response

- Reports are acknowledged within 14 days.
- A fix or coordinated disclosure is targeted within 90 days of the report.

## Dependency scanning

Every push and pull request runs [osv-scanner](https://github.com/google/osv-scanner)
against `pnpm-lock.yaml` on GitHub Actions. The build fails on any critical finding. Run the same check locally with
`pnpm vuln`.
