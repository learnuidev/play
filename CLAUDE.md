# DO NOT

- Take screenshots to test your changes. it wastes token
- Commit yourself! Thats my job!

## Frontend

## DO NOT

Use custom styls like these: text-[15px]

## Backend

- Do NOT deploy for me (unless i EXPLICITLY TELL YOU), thats my job
- The infrastructure is the CDK app in `infra/`, not `services/api`: a handler
  lives in `services/api/src/functions/**` and its route in
  `infra/src/generated/service.ts`. Read [infra/README.md](infra/README.md)
  before changing either.
- The tables, the bucket, the CloudFront distribution and the Cognito user pool
  are **imported** by `infra`, so a deploy neither changes nor deletes them — and
  some operations are API calls rather than deploys. [docs/migration.md](docs/migration.md)
  says which, and why.
- The user pool has not been cut over yet: its pre sign-up trigger still points
  at the old Serverless stack's function. Do not let anyone delete that stack
  before `node infra/scripts/adopt-cognito.mjs` has run.
- The videos bucket's S3 notification still belongs to the old stack. The first
  `cdk deploy` of `PlayApiStack` fails until
  `node infra/scripts/handover-s3-notifications.mjs` has been run once — two
  rules for the same event and prefix are rejected by S3.

## Where things live

Two apps (`apps/studio`, `apps/marketplace`) on one backend (`services/api` for
the code, `infra/` for everything it runs on), sharing five `@play/*` packages,
plus `apps/demo` — a third-party OAuth client of that backend rather than a third
surface of the product. Read
[docs/workspace.md](docs/workspace.md) before adding a screen or moving code: it
says what belongs in a package, how the aliases resolve, and why a shared
component takes its URLs from the app it renders in rather than assuming them.
For the demo app specifically, [apps/demo/README.md](apps/demo/README.md) is the
document — and note that it may not import `@play/auth` or `@play/api`, because
the day it does it stops being a demonstration of what an outsider can build.

