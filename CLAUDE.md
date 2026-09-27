# DO NOT

- Take screenshots to test your changes. it wastes token
- Commit yourself! Thats my job!

## Frontend

## DO NOT

Use custom styls like these: text-[15px]

## Where things live

Two apps (`apps/studio`, `apps/marketplace`) on one backend (`services/api`),
sharing five `@play/*` packages. Read [docs/workspace.md](docs/workspace.md)
before adding a screen or moving code: it says what belongs in a package, how
the aliases resolve, and why a shared component takes its URLs from the app it
renders in rather than assuming them.
