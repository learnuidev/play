import type { AuthUrlsWriteView } from "@/lib/types";
import { lastMeaningfulLines, run, type RunResult } from "./exec";
import { repoRoot } from "./repo";

/**
 * Applying the saved callback and logout URLs to the pool that is running now.
 *
 * ## Why a save has to reach Cognito
 *
 * The config file is what a *deploy* reads, and that is enough for a stage that
 * creates its own pool: `auth-stack.ts` builds the app client from
 * `auth.callbackUrls`. It is not enough for a stage that **imports** one —
 * an imported resource is unmanaged, so nothing that deploy does can change the
 * URL lists Cognito accepts.
 *
 * `services/api/scripts/set-auth-urls.mjs` writes the app client directly. It
 * used to be a step somebody had to remember after saving here, which is a step
 * that gets skipped — and the symptom of skipping it is `redirect_uri_mismatch`,
 * a Google-branded error page that names neither this repository nor the field
 * that was filled in. So the save runs it.
 *
 * ## `--stage` is not the whole command
 *
 * The stage chooses *which pool*. It does not choose *which list*: the script's
 * defaults are the product's deployed origins (`studio.lets-play.xyz`,
 * `lets-play.xyz`), so `--stage=test` on its own would write those onto `test`'s
 * pool — the opposite of the list that was just saved, and the one mistake this
 * must not make. The two lists therefore travel as arguments, and the script is
 * what reads the client back first and carries over its flows, scopes and
 * providers, because `UpdateUserPoolClient` clears anything it is not given.
 *
 * ## A failure is a sentence, not a failed save
 *
 * The config file has been written by the time this runs, and for a stage whose
 * pool does not exist yet — a new environment before its first deploy — there is
 * nothing to write to and nothing wrong. That is reported in
 * `SettingsWriteView.authUrls` rather than thrown, for the same reason the
 * signing key is: the save is what the request asked for, and this is the half of
 * it that has its own outcome. What *is* thrown is a CLI failure — the script
 * having run and failed — and it carries the script's own words, because that is
 * where the reason lives.
 */

export interface AuthUrlLists {
  callbackUrls: string[];
  logoutUrls: string[];
}

export async function applyAuthUrls(
  stage: string,
  urls: AuthUrlLists,
  ctx: { profile?: string; region?: string } = {},
): Promise<AuthUrlsWriteView> {
  // Both lists are written in one `UpdateUserPoolClient`, so one empty list is
  // not a smaller change — it is a request to leave a client that cannot
  // complete a sign-in, since every redirect is checked against this list. Left
  // alone, and said so.
  if (urls.callbackUrls.length === 0 || urls.logoutUrls.length === 0) {
    return {
      applied: false,
      note:
        "Cognito was left as it is: the script writes both lists at once, and one of them " +
        "was saved empty.",
    };
  }

  const result = await run(
    "node",
    [
      "services/api/scripts/set-auth-urls.mjs",
      `--stage=${stage}`,
      `--callback-urls=${urls.callbackUrls.join(",")}`,
      `--logout-urls=${urls.logoutUrls.join(",")}`,
      // The console's own context, so the script reaches the account the rest of
      // this page is reading rather than whatever `AWS_PROFILE` happens to be.
      ...(ctx.profile ? [`--profile=${ctx.profile}`] : []),
      ...(ctx.region ? [`--region=${ctx.region}`] : []),
    ],
    { cwd: repoRoot(), timeoutMs: 2 * 60_000 },
  );

  if (result.code !== 0) {
    throw new Error(`Cognito was not updated — ${detailOf(result)}`);
  }

  return {
    applied: true,
    note: `${count(urls.callbackUrls.length, "callback")} and ${count(
      urls.logoutUrls.length,
      "logout",
    )} now live on the app client — no redeploy needed`,
  };
}

function count(n: number, noun: string): string {
  return `${n} ${noun} URL${n === 1 ? "" : "s"}`;
}

/** V8's frames, and the version banner it prints under an uncaught error. */
const FRAME = /^\s*at\s/;
const BANNER = /^Node\.js v\d/;

/**
 * What the script said, as one sentence.
 *
 * The two ways this fails have the reason in different places. An `aws` failure
 * puts it in the CLI's own line — short, and often the only one. A script that
 * *threw* prints its message first and V8's stack under it, so the tail alone
 * would be somebody else's frames. Neither is assumed: the frames and the
 * version banner are what is dropped, and what is left is the message in both
 * cases. Space-joined rather than newline-joined because this lands in a note
 * beside the save button, where the prose should wrap rather than arrive as a
 * block.
 *
 * The `12` is the bound: it is enough for the script's longest paragraph and
 * short enough that a failure cannot turn the note into a transcript.
 */
function detailOf(result: RunResult): string {
  const lines = lastMeaningfulLines(result.stderr || result.stdout, 12);
  const said = lines.filter((line) => !FRAME.test(line) && !BANNER.test(line));

  // Nothing but frames: a crash before the script could say anything, which is
  // still more useful than an empty note.
  return (said.length > 0 ? said : lines.slice(-2)).join(" ");
}
