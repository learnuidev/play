# DO NOT

- Take screenshots to test your changes. it wastes token
- Commit yourself! Thats my job!
- Write throwaway scripts, and especially do not add new ones under
  `infra/scripts/` or wire them into builds. A script that exists only because a
  change was awkward to make by hand is a second build to keep working, and it
  hides the awkwardness instead of solving it. If a change seems to need one,
  stop and say so: either the design should be simpler, or the step belongs in a
  deploy or in an existing script — ask before inventing anything.

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
- The migration is done for `dev`: the legacy `play-backend-dev` stack is gone,
  the user pool's pre sign-up trigger and the bucket's S3 notification both point
  at the CDK functions, and both apps are pointed at the new API URL. What
  remains is phase E of [docs/migration.md](docs/migration.md) — owning the data
  — and point-in-time recovery on the tables.
- `infra/src/generated/service.ts` is the backend now. It is generated, and the
  script that generated it cannot run any more because the YAML it read is gone.
  Add a route by editing that file.

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

`apps/play` is the fourth app and the only one that is not a surface: the console
that deploys the backend to an environment and starts the other three against it.
`npm run play` starts it at http://localhost:3002, and it imports no `@play/*`
package on purpose — [apps/play/README.md](apps/play/README.md) says why, and its
`src/server/plan.ts` is the checklist of everything a deployment needs.

