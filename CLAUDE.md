# DO NOT

- Take screenshots to test your changes. it wastes token
- Commit yourself! Thats my job!

## Frontend

## DO NOT

Use custom styls like these: text-[15px]

## Where things live

Two apps (`apps/studio`, `apps/marketplace`) on one backend (`services/api`),
sharing five `@play/*` packages, plus `apps/demo` — a third-party OAuth client of
that backend rather than a third surface of the product. Read
[docs/workspace.md](docs/workspace.md) before adding a screen or moving code: it
says what belongs in a package, how the aliases resolve, and why a shared
component takes its URLs from the app it renders in rather than assuming them.
For the demo app specifically, [apps/demo/README.md](apps/demo/README.md) is the
document — and note that it may not import `@play/auth` or `@play/api`, because
the day it does it stops being a demonstration of what an outsider can build.
