import fs from "node:fs";

import type { AppKey, EnvRow, FrontendEnvView } from "@/lib/types";
import { FRONTEND_OUTPUTS, OUTPUT_ENV_NAME, stackOutputs } from "./backend";
import { listServices } from "./services";
import { appDir } from "./repo";
import path from "node:path";

/**
 * What a frontend is actually handed, for one environment.
 *
 * A frontend has no environment variables of its own — it has *derived* ones.
 * Every `NEXT_PUBLIC_*` it reads is a stack output with a different name, which
 * is why this table is short and why the interesting column is `source`: the
 * value did not come from a file anyone edited, it came from a deploy.
 *
 * Two details that explain most surprises:
 *
 * - **`NEXT_PUBLIC_*` is inlined at build time.** Next substitutes these while
 *   compiling, so on a deployed build the value is frozen into the JavaScript
 *   the visitor downloads. Changing the project variable does nothing until a
 *   redeploy — `Integrations → Vercel` is where that is visible.
 * - **The redirect URLs are not here.** `@play/auth` builds them from
 *   `window.location.origin`, which is how one package serves two apps on
 *   different ports. The list Cognito accepts is on the pool, not in this table.
 */

const OUTPUT_STACK: Record<string, string> = {
  ApiUrl: "Api",
  CognitoUserPoolId: "Auth",
  CognitoUserPoolClientId: "Auth",
  CognitoDomain: "Auth",
  GoogleAuthEnabled: "Auth",
};

/** `NEXT_PUBLIC_*` in an app's `.env.local`, if there is one. */
function readEnvLocal(app: AppKey): Record<string, string> {
  try {
    const text = fs.readFileSync(path.join(appDir(app), ".env.local"), "utf8");
    const values: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) values[match[1]] = match[2];
    }
    return values;
  } catch {
    return {};
  }
}

export async function frontendEnv(
  app: AppKey,
  stage: string,
  ctx: { profile?: string; region?: string } = {},
): Promise<FrontendEnvView> {
  const outputs = await stackOutputs(stage, ctx);
  const local = readEnvLocal(app);

  const rows: EnvRow[] = FRONTEND_OUTPUTS.map((output) => {
    const key = OUTPUT_ENV_NAME[output];
    const stackLabel = `Play${OUTPUT_STACK[output] ?? "Api"}Stack-${stage}`;
    const fromLocal = local[key];
    const deployed = outputs[output] ?? null;

    // Where the file and the deployment disagree, that is the thing worth
    // saying — a dev server started "as configured" reads the file, one started
    // against this stage reads the output, and both of them look identical from
    // the browser.
    const source =
      fromLocal && deployed && fromLocal !== deployed
        ? `${stackLabel} · .env.local says ${fromLocal}`
        : `${stackLabel} · output ${output}`;

    return { key, value: deployed, source, usedBy: [app] };
  });

  // The studio's one extra value: where the marketplace lives. It is not a stack
  // output — it is a domain, and `docs/deploy.md` sets it on the Vercel project.
  if (app === "studio") {
    rows.push({
      key: "NEXT_PUBLIC_MARKETPLACE_URL",
      value: local.NEXT_PUBLIC_MARKETPLACE_URL ?? null,
      source: "the marketplace's domain — set on the Vercel project, not here",
      usedBy: [app],
    });
  }

  // The demo signs in through the studio, so it needs the studio's own URL.
  if (app === "demo") {
    rows.push({
      key: "NEXT_PUBLIC_PLAY_STUDIO_URL",
      value: "http://localhost:3000",
      source: "the studio's local port — injected when the console starts it",
      usedBy: [app],
    });
  }

  const running = listServices().some(
    (service) => service.app === app && service.status === "running" && service.stage === stage,
  );


  return { app, stage, rows, running };
}
