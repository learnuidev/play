import { FUNCTIONS } from '../generated/service';
import type { FunctionSpec } from '../types';

/**
 * How the API's routes are divided between CloudFormation stacks.
 *
 * ## Why there is a division at all
 *
 * CloudFormation caps a stack at 500 resources, and this API does not fit in
 * one: 134 functions, a log group and a permission each, 133 methods, 87 CORS
 * preflights and 101 gateway resources comes to about 850. That is not a
 * surprise — it is the wall the whole migration exists to get away from. The
 * Serverless service hit it exactly, and its answer was
 * `serverless-plugin-split-stacks`, which moved resources into nested stacks
 * *by logical id* at deploy time. That plugin re-decides the partition on every
 * deploy, which is why renaming a function could leave the service holding two
 * nested stacks for it and 501 resources in the root.
 *
 * Here the partition is written down. Nothing moves between groups because a
 * name changed.
 *
 * ## The rule the groups have to obey
 *
 * **A path's first segment belongs to exactly one group.** Not a preference — a
 * requirement. Each stack builds its own slice of the gateway's resource tree
 * under the API's root resource, so two stacks creating `me` would be two
 * `AWS::ApiGateway::Resource` resources with the same parent and path part.
 * API Gateway accepts that silently and serves whichever it feels like, so the
 * failure is a route that works until it does not.
 *
 * `planGroups` enforces it, along with its twin: every route has to be in some
 * group. Both are checked at synth, which is the point of writing the partition
 * down — a route added to a new root fails `cdk synth`, in a second, with a
 * message naming the group to put it in.
 *
 * ## How the boundaries were chosen
 *
 * By what a change touches, which is also how the product is shaped. Adding a
 * field to a lesson touches `content`; adding a page to the public API touches
 * `public`. The alternative — splitting at an arbitrary resource count — would
 * mean a change to one feature re-planning a stack full of unrelated ones.
 *
 * The sizes are what they are because of that, not because they are equal:
 * `content` is the biggest, and it is now past CloudFormation's warning line —
 * `cdk synth` reports `ApiContentRoutes` at 410 of the 500 a stack may hold,
 * which it reached by taking the quiz feature's routes rather than by anyone
 * being careless. It is worth knowing before the next route lands there.
 *
 * What to do about it is a decision for the day it is needed, and there is an
 * obvious shape to it: `questions` and `banks` are roots of their own, so they
 * can leave as a group of their own (a quiz group) without breaking the rule
 * above — a root belongs to exactly one stack, and it would still. What cannot
 * leave is `contents/{contentId}/quiz`, which is a route under a root that
 * lessons share, so a feature that outgrows this partition has to be split at a
 * path root rather than inside one.
 */
export interface ApiGroup {
  /** The construct id, and the stack name's suffix. */
  id: string;
  /** What a person should read before adding a route to it. */
  description: string;
  /** The first path segment of every route in this group. */
  roots: string[];
}

export const API_GROUPS: ApiGroup[] = [
  {
    id: 'Content',
    description: 'What a course is made of: its videos, its sections, the content filed under them, and the questions their quizzes ask',
    roots: ['videos', 'sections', 'contents', 'questions', 'banks'],
  },
  {
    id: 'Courses',
    description: 'Courses themselves, the groups they run in, what they hand over, and the catalog they appear in',
    roots: ['spaces', 'cohorts', 'rewards', 'catalog'],
  },
  {
    id: 'People',
    description: 'Organizations, who belongs to them, and everything addressed under /me',
    roots: ['organizations', 'me'],
  },
  {
    id: 'PublicApi',
    description: 'The curated surface somebody outside the product integrates against, and OAuth',
    roots: ['v1', 'oauth'],
  },
];

export interface GroupPlan {
  group: ApiGroup;
  /** The functions that serve this group's routes, in generated-table order. */
  functions: FunctionSpec[];
  /** Every distinct path in the group — the CORS preflights are built from these. */
  paths: string[];
}

/** A route's group is its first path segment — `spaces/{id}/members` is `spaces`. */
export function rootOf(path: string): string {
  return path.split('/')[0];
}

/**
 * Assigns every function to a group, and refuses to if the partition does not
 * hold.
 *
 * The checks are here rather than in a comment because both of them fail
 * *silently* at the AWS level and are caught here in a second.
 */
export function planGroups(groups: ApiGroup[] = API_GROUPS): GroupPlan[] {
  const byRoot = new Map<string, ApiGroup>();
  for (const group of groups) {
    for (const root of group.roots) {
      const existing = byRoot.get(root);
      if (existing) {
        throw new Error(
          `Path root '${root}' is claimed by both '${existing.id}' and '${group.id}'. ` +
            'Two stacks building the same gateway resource is a route that works until it does not.',
        );
      }
      byRoot.set(root, group);
    }
  }

  const plans = new Map<string, GroupPlan>(
    groups.map((group) => [group.id, { group, functions: [], paths: [] }]),
  );
  const pathsSeen = new Map<string, string>();

  for (const spec of FUNCTIONS) {
    if (spec.http.length === 0) continue;

    const roots = new Set(spec.http.map((route) => rootOf(route.path)));
    if (roots.size > 1) {
      throw new Error(
        `${spec.key} serves routes under more than one path root (${[...roots].join(', ')}), ` +
          'so it cannot belong to a single group. Split the function, or move a route to a ' +
          'function in the group it belongs to.',
      );
    }

    const root = [...roots][0];
    const group = byRoot.get(root);
    if (!group) {
      throw new Error(
        `No API group claims the path root '${root}' (served by ${spec.key}). ` +
          `Add it to a group's \`roots\` in src/stacks/api-groups.ts — and note that the ` +
          'group it goes in decides which stack a change to it will re-plan.',
      );
    }

    const plan = plans.get(group.id)!;
    plan.functions.push(spec);

    for (const route of spec.http) {
      const owner = pathsSeen.get(route.path);
      if (owner && owner !== group.id) {
        throw new Error(`Path '${route.path}' is served from both '${owner}' and '${group.id}'.`);
      }
      pathsSeen.set(route.path, group.id);
      if (!plan.paths.includes(route.path)) plan.paths.push(route.path);
    }
  }

  for (const plan of plans.values()) {
    if (plan.functions.length === 0) {
      throw new Error(`API group '${plan.group.id}' has no functions — its roots are unused.`);
    }
    // Sorted so the synthesized template does not depend on the order the
    // generated table happens to list things in.
    plan.paths.sort();
  }

  return groups.map((group) => plans.get(group.id)!);
}

/** The functions that have no HTTP route: the S3 and EventBridge ones. */
export function offlineFunctions(): FunctionSpec[] {
  return FUNCTIONS.filter((spec) => spec.http.length === 0 && !spec.ownRole);
}
