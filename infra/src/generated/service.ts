/**
 * The backend, as data.
 *
 * Generated from `services/api/serverless.yml` by
 * `infra/scripts/generate-from-serverless.mjs`. **Do not edit by hand** —
 * the script is the only thing that knows how to reproduce this file, and it
 * can no longer be re-run, because the YAML it read was deleted when the
 * migration finished. This file is the backend now.
 *
 * Two things live here that are worth knowing about before reading further:
 *
 * - **The comments came across.** Every function and every table below carries
 *   the reasoning that was written above it in the YAML — why a route has no
 *   authorizer, why a table has the indexes it has, why one function has a role
 *   of its own. They are attached to the same entry they were attached to
 *   there, and they are the reason this file is long.
 * - **The function keys are the deployed names.** `create-lesson-comment`
 *   serves `lesson-comment.ts`, and the key is not wrong: it is what the old
 *   stack's Lambda, log group and metrics are named after, so it is the string
 *   to search them by.
 */

import type { FunctionSpec, TableSpec } from '../types';

/** What every function gets unless it says otherwise. */
export const SERVICE_DEFAULTS = {
  runtime: 'nodejs22.x' as const,
  timeout: 29,
  memorySize: 512,
};

export const TABLES: TableSpec[] = [
  {
    id: 'VideosTable',
    envVar: 'VIDEOS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'videoId', type: 'S' },
      { name: 'ownerId', type: 'S' },
      { name: 'organizationId', type: 'S' },
      { name: 'status', type: 'S' },
      { name: 'createdAt', type: 'N' },
    ],
    keySchema: [
      { name: 'videoId', keyType: 'HASH' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'OwnerStatusIndex',
        keySchema: [
          { name: 'ownerId', keyType: 'HASH' },
          { name: 'status', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
      {
        name: 'OwnerCreatedIndex',
        keySchema: [
          { name: 'ownerId', keyType: 'HASH' },
          { name: 'createdAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
      {
        name: 'OrganizationStatusIndex',
        keySchema: [
          { name: 'organizationId', keyType: 'HASH' },
          { name: 'status', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
      {
        name: 'OrganizationCreatedIndex',
        keySchema: [
          { name: 'organizationId', keyType: 'HASH' },
          { name: 'createdAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
    ],
    actions: [
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  {
    id: 'OrganizationsTable',
    envVar: 'ORGANIZATIONS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'orgId', type: 'S' },
    ],
    keySchema: [
      { name: 'orgId', keyType: 'HASH' },
    ],
    globalSecondaryIndexes: [
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:TransactWriteItems',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  {
    id: 'OrgMembersTable',
    envVar: 'ORG_MEMBERS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'orgId', type: 'S' },
      { name: 'userId', type: 'S' },
      { name: 'joinedAt', type: 'N' },
      { name: 'invitedEmail', type: 'S' },
    ],
    keySchema: [
      { name: 'orgId', keyType: 'HASH' },
      { name: 'userId', keyType: 'RANGE' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'UserOrgIndex',
        keySchema: [
          { name: 'userId', keyType: 'HASH' },
          { name: 'joinedAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
      {
        name: 'InviteEmailIndex',
        keySchema: [
          { name: 'invitedEmail', keyType: 'HASH' },
          { name: 'joinedAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:TransactWriteItems',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  {
    id: 'SpacesTable',
    envVar: 'SPACES_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'spaceId', type: 'S' },
      { name: 'organizationId', type: 'S' },
      { name: 'createdAt', type: 'N' },
      { name: 'catalogKey', type: 'S' },
    ],
    keySchema: [
      { name: 'spaceId', keyType: 'HASH' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'OrganizationCreatedIndex',
        keySchema: [
          { name: 'organizationId', keyType: 'HASH' },
          { name: 'createdAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
      {
        name: 'CatalogCreatedIndex',
        keySchema: [
          { name: 'catalogKey', keyType: 'HASH' },
          { name: 'createdAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  {
    id: 'SectionsTable',
    envVar: 'SECTIONS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'sectionId', type: 'S' },
      { name: 'spaceId', type: 'S' },
      { name: 'position', type: 'N' },
    ],
    keySchema: [
      { name: 'sectionId', keyType: 'HASH' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'SpacePositionIndex',
        keySchema: [
          { name: 'spaceId', keyType: 'HASH' },
          { name: 'position', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  {
    id: 'ContentsTable',
    envVar: 'CONTENTS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'contentId', type: 'S' },
      { name: 'sectionId', type: 'S' },
      { name: 'spaceId', type: 'S' },
      { name: 'position', type: 'N' },
      { name: 'videoId', type: 'S' },
    ],
    keySchema: [
      { name: 'contentId', keyType: 'HASH' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'SectionPositionIndex',
        keySchema: [
          { name: 'sectionId', keyType: 'HASH' },
          { name: 'position', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
      {
        name: 'SpacePositionIndex',
        keySchema: [
          { name: 'spaceId', keyType: 'HASH' },
          { name: 'position', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
      {
        name: 'VideoSpaceIndex',
        keySchema: [
          { name: 'videoId', keyType: 'HASH' },
          { name: 'spaceId', keyType: 'RANGE' },
        ],
        projectAll: false,
      },
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  {
    id: 'ContentFilesTable',
    envVar: 'CONTENT_FILES_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'contentId', type: 'S' },
      { name: 'fileId', type: 'S' },
    ],
    keySchema: [
      { name: 'contentId', keyType: 'HASH' },
      { name: 'fileId', keyType: 'RANGE' },
    ],
    globalSecondaryIndexes: [
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  {
    id: 'FavouritesTable',
    envVar: 'FAVOURITES_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'userId', type: 'S' },
      { name: 'targetKey', type: 'S' },
    ],
    keySchema: [
      { name: 'userId', keyType: 'HASH' },
      { name: 'targetKey', keyType: 'RANGE' },
    ],
    globalSecondaryIndexes: [
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  {
    id: 'PlaylistTable',
    envVar: 'PLAYLIST_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'userId', type: 'S' },
      { name: 'contentId', type: 'S' },
      { name: 'addedAt', type: 'N' },
    ],
    keySchema: [
      { name: 'userId', keyType: 'HASH' },
      { name: 'contentId', keyType: 'RANGE' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'UserAddedIndex',
        keySchema: [
          { name: 'userId', keyType: 'HASH' },
          { name: 'addedAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  {
    id: 'CommentsTable',
    envVar: 'COMMENTS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'contentId', type: 'S' },
      { name: 'commentId', type: 'S' },
    ],
    keySchema: [
      { name: 'contentId', keyType: 'HASH' },
      { name: 'commentId', keyType: 'RANGE' },
    ],
    globalSecondaryIndexes: [
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  {
    id: 'ContentLoopsTable',
    envVar: 'CONTENT_LOOPS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'userId', type: 'S' },
      { name: 'loopKey', type: 'S' },
      { name: 'contentId', type: 'S' },
      { name: 'createdAt', type: 'N' },
    ],
    keySchema: [
      { name: 'userId', keyType: 'HASH' },
      { name: 'loopKey', keyType: 'RANGE' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'ContentCreatedIndex',
        keySchema: [
          { name: 'contentId', keyType: 'HASH' },
          { name: 'createdAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  {
    id: 'CompletionsTable',
    envVar: 'COMPLETIONS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'userId', type: 'S' },
      { name: 'spaceKey', type: 'S' },
    ],
    keySchema: [
      { name: 'userId', keyType: 'HASH' },
      { name: 'spaceKey', keyType: 'RANGE' },
    ],
    globalSecondaryIndexes: [
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: false,
  },
  {
    id: 'SpaceMembersTable',
    envVar: 'SPACE_MEMBERS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'spaceId', type: 'S' },
      { name: 'userId', type: 'S' },
      { name: 'invitedEmail', type: 'S' },
      { name: 'joinedAt', type: 'N' },
    ],
    keySchema: [
      { name: 'spaceId', keyType: 'HASH' },
      { name: 'userId', keyType: 'RANGE' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'UserSpaceIndex',
        keySchema: [
          { name: 'userId', keyType: 'HASH' },
          { name: 'joinedAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
      {
        name: 'InviteEmailIndex',
        keySchema: [
          { name: 'invitedEmail', keyType: 'HASH' },
          { name: 'joinedAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:TransactWriteItems',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  {
    id: 'CohortsTable',
    envVar: 'COHORTS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'cohortId', type: 'S' },
      { name: 'spaceId', type: 'S' },
      { name: 'createdAt', type: 'N' },
    ],
    keySchema: [
      { name: 'cohortId', keyType: 'HASH' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'SpaceCreatedIndex',
        keySchema: [
          { name: 'spaceId', keyType: 'HASH' },
          { name: 'createdAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:TransactWriteItems',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  {
    id: 'CohortMembersTable',
    envVar: 'COHORT_MEMBERS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'cohortId', type: 'S' },
      { name: 'userId', type: 'S' },
      { name: 'addedAt', type: 'N' },
    ],
    keySchema: [
      { name: 'cohortId', keyType: 'HASH' },
      { name: 'userId', keyType: 'RANGE' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'UserCohortIndex',
        keySchema: [
          { name: 'userId', keyType: 'HASH' },
          { name: 'addedAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:TransactWriteItems',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  {
    id: 'SpaceRewardsTable',
    envVar: 'SPACE_REWARDS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'rewardId', type: 'S' },
      { name: 'spaceId', type: 'S' },
      { name: 'createdAt', type: 'N' },
    ],
    keySchema: [
      { name: 'rewardId', keyType: 'HASH' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'SpaceCreatedIndex',
        keySchema: [
          { name: 'spaceId', keyType: 'HASH' },
          { name: 'createdAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:TransactWriteItems',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  {
    id: 'RewardGrantsTable',
    envVar: 'REWARD_GRANTS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'rewardId', type: 'S' },
      { name: 'userId', type: 'S' },
      { name: 'spaceId', type: 'S' },
      { name: 'grantedAt', type: 'N' },
    ],
    keySchema: [
      { name: 'rewardId', keyType: 'HASH' },
      { name: 'userId', keyType: 'RANGE' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'SpaceGrantedIndex',
        keySchema: [
          { name: 'spaceId', keyType: 'HASH' },
          { name: 'grantedAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
      {
        name: 'UserGrantedIndex',
        keySchema: [
          { name: 'userId', keyType: 'HASH' },
          { name: 'grantedAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:TransactWriteItems',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  {
    id: 'ApiKeysTable',
    envVar: 'API_KEYS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'keyId', type: 'S' },
      { name: 'keyHash', type: 'S' },
      { name: 'userId', type: 'S' },
      { name: 'organizationId', type: 'S' },
      { name: 'createdAt', type: 'N' },
    ],
    keySchema: [
      { name: 'keyId', keyType: 'HASH' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'KeyHashIndex',
        keySchema: [
          { name: 'keyHash', keyType: 'HASH' },
        ],
        projectAll: true,
      },
      {
        name: 'UserCreatedIndex',
        keySchema: [
          { name: 'userId', keyType: 'HASH' },
          { name: 'createdAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
      {
        name: 'OrganizationCreatedIndex',
        keySchema: [
          { name: 'organizationId', keyType: 'HASH' },
          { name: 'createdAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
    ],
    actions: [
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  {
    id: 'OAuthAppsTable',
    envVar: 'OAUTH_APPS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'appId', type: 'S' },
      { name: 'clientId', type: 'S' },
      { name: 'userId', type: 'S' },
      { name: 'createdAt', type: 'N' },
    ],
    keySchema: [
      { name: 'appId', keyType: 'HASH' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'ClientIdIndex',
        keySchema: [
          { name: 'clientId', keyType: 'HASH' },
        ],
        projectAll: true,
      },
      {
        name: 'UserCreatedIndex',
        keySchema: [
          { name: 'userId', keyType: 'HASH' },
          { name: 'createdAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  {
    id: 'OAuthGrantsTable',
    envVar: 'OAUTH_GRANTS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'userId', type: 'S' },
      { name: 'appId', type: 'S' },
    ],
    keySchema: [
      { name: 'userId', keyType: 'HASH' },
      { name: 'appId', keyType: 'RANGE' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'AppGrantedIndex',
        keySchema: [
          { name: 'appId', keyType: 'HASH' },
        ],
        projectAll: true,
      },
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  {
    id: 'OAuthTokensTable',
    envVar: 'OAUTH_TOKENS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'tokenId', type: 'S' },
      { name: 'tokenHash', type: 'S' },
      { name: 'grantKey', type: 'S' },
      { name: 'createdAt', type: 'N' },
    ],
    keySchema: [
      { name: 'tokenId', keyType: 'HASH' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'TokenHashIndex',
        keySchema: [
          { name: 'tokenHash', keyType: 'HASH' },
        ],
        projectAll: true,
      },
      {
        name: 'GrantKeyCreatedIndex',
        keySchema: [
          { name: 'grantKey', keyType: 'HASH' },
          { name: 'createdAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  {
    id: 'OAuthCodesTable',
    envVar: 'OAUTH_CODES_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'codeHash', type: 'S' },
    ],
    keySchema: [
      { name: 'codeHash', keyType: 'HASH' },
    ],
    globalSecondaryIndexes: [
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: false,
  },
  {
    id: 'ProfilesTable',
    envVar: 'PROFILES_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'userId', type: 'S' },
    ],
    keySchema: [
      { name: 'userId', keyType: 'HASH' },
    ],
    globalSecondaryIndexes: [
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: false,
  },
  /**
   *  The questions themselves.
   *
   *  A table of their own rather than a list on anything else, for the reason a
   *  lesson's attachments have one: a question is written, edited, verified and
   *  deleted on its own, and a list stored inside another row would make every
   *  one of those a rewrite of the whole thing — two authors working at once
   *  would overwrite each other, and a long bank would be a 400 KB item limit
   *  away from not saving at all.
   *
   *  A question belongs to a **bank** and names the **lesson** it is about, and
   *  the two indexes are those two questions:
   *
   *  - `BankPositionIndex` is how a bank is read — one query, in the order it
   *    holds them;
   *  - `LessonIndex` answers "everything written about this lesson", which is
   *    read for exactly one thing and cannot be avoided: deleting a lesson. A
   *    question whose lesson is gone points at nothing, so the cascade that
   *    removes a lesson reads this index and takes them with it;
   *  - `SpacePositionIndex` answers "everything written about this *course's*
   *    lessons", which is what a course's own page draws — one read rather than
   *    one per lesson.
   *
   *  What is deliberately *not* indexed is "which quizzes ask this question".
   *  That is the links table's own reverse index, because it is a fact about a
   *  quiz and not about a question.
   */
  {
    id: 'QuestionsTable',
    envVar: 'QUESTIONS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'questionId', type: 'S' },
      { name: 'bankId', type: 'S' },
      { name: 'position', type: 'N' },
      { name: 'lessonContentId', type: 'S' },
      { name: 'lessonSpaceId', type: 'S' },
    ],
    keySchema: [
      { name: 'questionId', keyType: 'HASH' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'BankPositionIndex',
        keySchema: [
          { name: 'bankId', keyType: 'HASH' },
          { name: 'position', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
      {
        name: 'LessonIndex',
        keySchema: [
          { name: 'lessonContentId', keyType: 'HASH' },
        ],
        projectAll: true,
      },
      {
        name: 'SpacePositionIndex',
        keySchema: [
          { name: 'lessonSpaceId', keyType: 'HASH' },
          { name: 'position', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
    ],
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  /**
   *  An organization's question banks.
   *
   *  A bank is a library of questions rather than a course's assessment: the
   *  questions in it are about *lessons*, and which lesson a question is about is
   *  on the question. That is what lets one bank serve several courses, and what
   *  lets a quiz ask a question that was written once and asked by others since.
   *
   *  Keyed by the bank, with `OrganizationCreatedIndex` answering the only list
   *  there is: the banks one organization owns, oldest first.
   */
  {
    id: 'QuestionBanksTable',
    envVar: 'QUESTION_BANKS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'bankId', type: 'S' },
      { name: 'organizationId', type: 'S' },
      { name: 'createdAt', type: 'N' },
    ],
    keySchema: [
      { name: 'bankId', keyType: 'HASH' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'OrganizationCreatedIndex',
        keySchema: [
          { name: 'organizationId', keyType: 'HASH' },
          { name: 'createdAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
    ],
    actions: [
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
  /**
   *  The questions a quiz asks.
   *
   *  A quiz does not own questions — it asks some, and they live in banks. This
   *  table is that relationship and nothing else: which quiz, which question, and
   *  where in the order a learner meets it. Everything a question *is* stays in
   *  `QuestionsTable`, which is what makes one question usable by any number of
   *  quizzes without a single copy of it.
   *
   *  Keyed by the quiz and the question together, so asking the same question
   *  twice in one quiz is one row rather than two — a picker that sends the same
   *  id again is somebody unsure whether the first click worked, and the key
   *  answers that for free.
   *
   *  `QuestionIndex` is the reverse: the quizzes that ask one question, which is
   *  what deleting a question has to walk — a quiz left pointing at a question
   *  that no longer exists is a quiz with a hole nothing can fill.
   */
  {
    id: 'QuizQuestionsTable',
    envVar: 'QUIZ_QUESTIONS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'contentId', type: 'S' },
      { name: 'questionId', type: 'S' },
    ],
    keySchema: [
      { name: 'contentId', keyType: 'HASH' },
      { name: 'questionId', keyType: 'RANGE' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'QuestionIndex',
        keySchema: [
          { name: 'questionId', keyType: 'HASH' },
        ],
        projectAll: true,
      },
    ],
    actions: [
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
    ],
    grantsIndexes: true,
  },
  /**
   *  The times a quiz was sat, and what each one scored.
   *
   *  Keyed by the **quiz**, and by the learner inside it rather than the other
   *  way round, because both questions this table is ever asked are about one
   *  quiz: "what have I scored on this one" is a learner's own prefix of the
   *  partition, and "what becomes of these when the quiz is deleted" is the
   *  partition, read and deleted whole. Keyed by the learner instead, the second
   *  would need an index and the first would too.
   *
   *  A sort key of `${userId}#${attemptId}` is what makes both of those one
   *  query: an attempt id is a ULID, so it sorts by the moment it was made and
   *  "newest first" needs no attribute to order by.
   *
   *  There is deliberately no index. An author reading a class's results would
   *  be one — `contentId` is already the partition, so it would be an index over
   *  a partition key it shares, which is a scan with extra steps.
   */
  {
    id: 'QuizAttemptsTable',
    envVar: 'QUIZ_ATTEMPTS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'contentId', type: 'S' },
      { name: 'attemptKey', type: 'S' },
    ],
    keySchema: [
      { name: 'contentId', keyType: 'HASH' },
      { name: 'attemptKey', keyType: 'RANGE' },
    ],
    globalSecondaryIndexes: [
    ],
    actions: [
      'dynamodb:DeleteItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
    ],
    grantsIndexes: false,
  },
  /**
   *  What a paid course cost, and who paid it.
   *
   *  **Keyed by the Stripe checkout session**, which is the one identifier both
   *  ends of a purchase know: the backend knows it because it is what it asked
   *  Stripe for, and the webhook knows it because Stripe sends the session back
   *  with the event. Nothing else here is unique to one purchase — a person may
   *  buy the same course twice, and a Stripe payment intent can outlive the
   *  attempt that made it — so this is the key that makes a re-delivered event an
   *  update to one row rather than a second sale.
   *
   *  A session is also the unit a refund and an expiry are about: both arrive as
   *  events naming the session, and both are this row changing status rather than
   *  a row appearing somewhere else.
   *
   *  The three indexes are the three questions asked of it, and none of them can
   *  be a scan: what one person has bought (`userId`), who has bought one course
   *  (`spaceId`) — the author's own view of their sales — and what became of one
   *  payment (`stripePaymentIntentId`), which is the one lookup the key cannot
   *  answer: a refund and a failed payment arrive as events naming the *intent*,
   *  and the session that started it is not in them.
   */
  {
    id: 'PaymentsTable',
    envVar: 'PAYMENTS_TABLE',
    billingMode: 'PAY_PER_REQUEST',
    attributeDefinitions: [
      { name: 'paymentId', type: 'S' },
      { name: 'userId', type: 'S' },
      { name: 'spaceId', type: 'S' },
      { name: 'createdAt', type: 'N' },
      { name: 'stripePaymentIntentId', type: 'S' },
    ],
    keySchema: [
      { name: 'paymentId', keyType: 'HASH' },
    ],
    globalSecondaryIndexes: [
      {
        name: 'UserCreatedIndex',
        keySchema: [
          { name: 'userId', keyType: 'HASH' },
          { name: 'createdAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
      {
        name: 'SpaceCreatedIndex',
        keySchema: [
          { name: 'spaceId', keyType: 'HASH' },
          { name: 'createdAt', keyType: 'RANGE' },
        ],
        projectAll: true,
      },
      {
        name: 'PaymentIntentIndex',
        keySchema: [
          { name: 'stripePaymentIntentId', keyType: 'HASH' },
        ],
        projectAll: true,
      },
    ],
    actions: [
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
    ],
    grantsIndexes: true,
  },
];

export const FUNCTIONS: FunctionSpec[] = [
  {
    key: 'create-video',
    entry: 'src/functions/videos/create-video.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"videos","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'list-videos',
    entry: 'src/functions/videos/list-videos.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"videos","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'get-video',
    entry: 'src/functions/videos/get-video.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"videos/{videoId}","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'update-video',
    entry: 'src/functions/videos/update-video.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"videos/{videoId}","method":"PATCH","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'delete-video',
    entry: 'src/functions/videos/delete-video.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"videos/{videoId}","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'stream-video',
    entry: 'src/functions/videos/stream-video.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"videos/{videoId}/stream","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'get-audio',
    entry: 'src/functions/videos/get-audio.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"videos/{videoId}/audio","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'generate-audio',
    entry: 'src/functions/videos/generate-audio.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"videos/{videoId}/audio","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'retry-video',
    entry: 'src/functions/videos/retry-video.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"videos/{videoId}/retry","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'generate-subtitles',
    entry: 'src/functions/videos/generate-subtitles.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"videos/{videoId}/subtitles","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'get-subtitles',
    entry: 'src/functions/videos/get-subtitles.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"videos/{videoId}/subtitles","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'save-subtitles',
    entry: 'src/functions/videos/save-subtitles.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"videos/{videoId}/subtitles","method":"PUT","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'generate-translations',
    entry: 'src/functions/videos/generate-translations.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"videos/{videoId}/subtitles/translations","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'get-thumbnail',
    entry: 'src/functions/videos/get-thumbnail.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"videos/{videoId}/thumbnail","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'upload-thumbnail',
    entry: 'src/functions/videos/upload-thumbnail.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"videos/{videoId}/thumbnail","method":"PUT","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'generate-thumbnail',
    entry: 'src/functions/videos/generate-thumbnail.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"videos/{videoId}/thumbnail/frame","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'create-organization',
    entry: 'src/functions/organizations/create-organization.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"organizations","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'list-organizations',
    entry: 'src/functions/organizations/list-organizations.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"organizations","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'get-organization',
    entry: 'src/functions/organizations/get-organization.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"organizations/{orgId}","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  The roster. Reading it is any member's business — knowing who else is in the
   *  organization is part of being in it — while every change to it is an
   *  admin's: an editor writes courses, they do not decide who is in the room.
   */
  {
    key: 'list-members',
    entry: 'src/functions/organizations/list-members.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"organizations/{orgId}/members","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'invite-member',
    entry: 'src/functions/organizations/invite-member.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"organizations/{orgId}/members","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  A member is addressed by their own id, which is an email address until the
   *  invitation is accepted — hence the path parameter being percent-encoded.
   */
  {
    key: 'update-member-role',
    entry: 'src/functions/organizations/update-member-role.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"organizations/{orgId}/members/{userId}","method":"PATCH","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'remove-member',
    entry: 'src/functions/organizations/remove-member.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"organizations/{orgId}/members/{userId}","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  Sending an outstanding invitation again, to the address it was made to —
   *  the answer to "they never got the email", and to "I gave them the wrong
   *  role", since an offer that has not been accepted is still editable.
   */
  {
    key: 'resend-invitation',
    entry: 'src/functions/organizations/resend-invitation.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"organizations/{orgId}/members/{userId}/invitation","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  Claiming the invitation addressed to the caller's own verified email. Not
   *  under /members, because it is not an admin acting on somebody else: it is
   *  the invited person acting on an offer made to them.
   */
  {
    key: 'accept-invitation',
    entry: 'src/functions/organizations/accept-invitation.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"organizations/{orgId}/invitation","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  The offers addressed to the caller, wherever they came from. The one read a
   *  person who belongs to nothing yet can make, and the only way they can find
   *  out they were invited at all.
   */
  {
    key: 'list-my-invitations',
    entry: 'src/functions/organizations/list-my-invitations.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"me/invitations","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  Spaces (courses) belong to an organization, so creating and listing them is
   *  addressed under the organization. Reading one back is by its own id.
   */
  {
    key: 'create-space',
    entry: 'src/functions/spaces/create-space.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"organizations/{orgId}/spaces","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'list-spaces',
    entry: 'src/functions/spaces/list-spaces.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"organizations/{orgId}/spaces","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'get-space',
    entry: 'src/functions/spaces/get-space.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'get-space-thumbnail',
    entry: 'src/functions/spaces/get-space-thumbnail.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}/thumbnail","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'upload-space-thumbnail',
    entry: 'src/functions/spaces/upload-space-thumbnail.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}/thumbnail","method":"PUT","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'update-space',
    entry: 'src/functions/spaces/update-space.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}","method":"PATCH","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'get-space-stats',
    entry: 'src/functions/spaces/get-space-stats.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}/stats","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  The marketplace catalog: what the studio publishes, served to people who
   *  are not signed in and may never be. These two routes deliberately carry no
   *  authorizer — a catalog behind a login is a catalog nobody reads — and they
   *  expose only what a course says about itself in public.
   */
  {
    key: 'list-catalog-courses',
    entry: 'src/functions/catalog/list-courses.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"catalog/courses","method":"GET","authorized":false}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'get-catalog-course',
    entry: 'src/functions/catalog/get-course.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"catalog/courses/{spaceId}","method":"GET","authorized":false}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  An instructor's public page: who they are, and what they teach here. Public
   *  for the same reason the catalog is — a course page links to it, and the
   *  people following that link are deciding whether to register.
   */
  {
    key: 'get-catalog-instructor',
    entry: 'src/functions/catalog/get-instructor.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"catalog/instructors/{userId}","method":"GET","authorized":false}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  Registering for a listed course, and dropping out of one. The membership is
   *  the course's own, so both live under the space beside the invitations that
   *  create the same row by another route.
   */
  {
    key: 'enroll-in-space',
    entry: 'src/functions/spaces/enroll.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}/enrollment","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'leave-space',
    entry: 'src/functions/spaces/leave.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}/enrollment","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  Who a course is for. Membership is the course's own — an invitation here
   *  names an email address and grants this course, not the organization — so the
   *  roster, the invitations, and the claiming of one all live under the space.
   */
  {
    key: 'list-space-members',
    entry: 'src/functions/space-members/list-members.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}/members","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'list-space-instructors',
    entry: 'src/functions/space-members/list-instructors.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}/instructors","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'invite-space-member',
    entry: 'src/functions/space-members/invite-member.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}/members","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'update-space-member',
    entry: 'src/functions/space-members/update-member.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}/members/{userId}","method":"PATCH","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'remove-space-member',
    entry: 'src/functions/space-members/remove-member.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}/members/{userId}","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'resend-space-invitation',
    entry: 'src/functions/space-members/resend-invitation.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}/members/{userId}/invitation","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'accept-space-invitation',
    entry: 'src/functions/space-members/accept-invitation.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}/invitation","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'list-my-space-invitations',
    entry: 'src/functions/space-members/list-my-invitations.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"me/space-invitations","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'list-my-spaces',
    entry: 'src/functions/spaces/list-my-spaces.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"me/spaces","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  Cohorts — the groups a course's members are run in.
   */
  {
    key: 'list-cohorts',
    entry: 'src/functions/cohorts/list-cohorts.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}/cohorts","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'create-cohort',
    entry: 'src/functions/cohorts/create-cohort.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}/cohorts","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'update-cohort',
    entry: 'src/functions/cohorts/update-cohort.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"cohorts/{cohortId}","method":"PATCH","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'delete-cohort',
    entry: 'src/functions/cohorts/delete-cohort.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"cohorts/{cohortId}","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'add-cohort-member',
    entry: 'src/functions/cohorts/add-member.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"cohorts/{cohortId}/members/{userId}","method":"PUT","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'remove-cohort-member',
    entry: 'src/functions/cohorts/remove-member.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"cohorts/{cohortId}/members/{userId}","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  Rewards — what a course hands over for reaching a milestone.
   */
  {
    key: 'list-rewards',
    entry: 'src/functions/rewards/list-rewards.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}/rewards","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'create-reward',
    entry: 'src/functions/rewards/create-reward.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}/rewards","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'update-reward',
    entry: 'src/functions/rewards/update-reward.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"rewards/{rewardId}","method":"PATCH","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'delete-reward',
    entry: 'src/functions/rewards/delete-reward.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"rewards/{rewardId}","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'grant-reward',
    entry: 'src/functions/rewards/grant-reward.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"rewards/{rewardId}/grants","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'revoke-reward-grant',
    entry: 'src/functions/rewards/revoke-grant.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"rewards/{rewardId}/grants/{userId}","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'list-my-rewards',
    entry: 'src/functions/rewards/list-my-rewards.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"me/rewards","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  Sections — the headings a space's content is published under. Creating and
   *  listing them is addressed under the space; the rest by their own id.
   */
  {
    key: 'create-section',
    entry: 'src/functions/sections/create-section.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}/sections","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'list-sections',
    entry: 'src/functions/sections/list-sections.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}/sections","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'get-section',
    entry: 'src/functions/sections/get-section.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"sections/{sectionId}","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'update-section',
    entry: 'src/functions/sections/update-section.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"sections/{sectionId}","method":"PATCH","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'delete-section',
    entry: 'src/functions/sections/delete-section.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"sections/{sectionId}","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  Content — one piece of a section: a video, its notes, and its files.
   */
  {
    key: 'create-content',
    entry: 'src/functions/contents/create-content.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"sections/{sectionId}/contents","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'list-contents',
    entry: 'src/functions/contents/list-contents.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"sections/{sectionId}/contents","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'get-content',
    entry: 'src/functions/contents/get-content.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'update-content',
    entry: 'src/functions/contents/update-content.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}","method":"PATCH","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'delete-content',
    entry: 'src/functions/contents/delete-content.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  Files attached to a piece of content. The upload is a presigned PUT the
   *  client sends straight to S3; only the reservation passes through the API.
   */
  {
    key: 'upload-content-file',
    entry: 'src/functions/contents/upload-content-file.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/files","method":"PUT","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'list-content-files',
    entry: 'src/functions/contents/list-content-files.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/files","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'get-content-file',
    entry: 'src/functions/contents/get-content-file.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/files/{fileId}","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'delete-content-file',
    entry: 'src/functions/contents/delete-content-file.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/files/{fileId}","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    /**
     *  Where a lesson or a quiz sits in its section — the write a drag performs.
     *
     *  A route of its own rather than a `position` on the content patch, because
     *  a drop is two facts at once (which section, and where in it) and because
     *  the order that results is the *section's*: the server renumbers what
     *  follows the row, from what it currently holds. A client that sent the
     *  whole order would be a client that can lose a row added since it drew the
     *  list.
     */
    key: 'place-content',
    entry: 'src/functions/contents/place-content.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/placement","method":"PUT","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  Question banks: the libraries an organization's questions live in.
   *
   *  A bank is organization property — like the video library, which is what
   *  makes "any member may read it, an editor may change it" the obvious rule —
   *  and a question in one is about a *lesson*. That is what lets a bank serve
   *  several courses, and a quiz ask a question written once and asked by others
   *  since.
   */
  {
    key: 'list-question-banks',
    entry: 'src/functions/banks/list-banks.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"organizations/{orgId}/question-banks","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'create-question-bank',
    entry: 'src/functions/banks/create-bank.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"organizations/{orgId}/question-banks","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'get-question-bank',
    entry: 'src/functions/banks/get-bank.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"banks/{bankId}","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'update-question-bank',
    entry: 'src/functions/banks/update-bank.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"banks/{bankId}","method":"PATCH","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    /**
     *  Deleting a bank takes its questions with it — a bank *is* its questions —
     *  and takes them out of every quiz that was asking them, which is why the
     *  page asks twice.
     */
    key: 'delete-question-bank',
    entry: 'src/functions/banks/delete-bank.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"banks/{bankId}","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  The questions in a bank, and the three ways one arrives: written by hand,
   *  read out of a file, or generated from a lesson.
   *
   *  Every one of them requires the lesson the question is about. That is the
   *  model's rule rather than a validation nicety: a question without a lesson is
   *  a question nobody can tell is still true, and it is the lesson that decides
   *  which course's quiz may ask it.
   */
  {
    key: 'list-bank-questions',
    entry: 'src/functions/questions/list-bank-questions.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"banks/{bankId}/questions","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'create-question',
    entry: 'src/functions/questions/create-question.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"banks/{bankId}/questions","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'import-questions',
    entry: 'src/functions/questions/import-questions.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    description: 'Imports questions from an .xlsx, .csv or .json file',
    http: [{"path":"banks/{bankId}/questions/import","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    /**
     *  Starts an AI generation, and answers before it finishes.
     *
     *  The run is queued: the request writes the state onto the bank and
     *  publishes an event, and `generate-questions` below does the work. It has
     *  to be this way — API Gateway holds a REST request for 29 seconds at the
     *  very most, and a model reading a lesson's transcript takes longer than
     *  that often enough for a synchronous route to be a route that fails on the
     *  lessons worth generating from.
     *
     *  `DELETE` forgets the last run, once its author has read why it failed.
     */
    key: 'request-question-generation',
    entry: 'src/functions/questions/request-question-generation.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    description: 'Queues an AI generation of questions from a lesson',
    http: [{"path":"banks/{bankId}/questions/generation","method":"POST","authorized":true},{"path":"banks/{bankId}/questions/generation","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'verify-questions',
    entry: 'src/functions/questions/verify-questions.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    description: "Verifies a batch of a bank's questions",
    http: [{"path":"banks/{bankId}/questions/verification","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    /**
     *  One question, by its own id.
     *
     *  A question is addressed directly rather than through the bank it lives in
     *  because it is shared: the id is what a quiz holds a reference to, and a
     *  route that went through the bank would be a route that cannot edit a
     *  question from the page asking it.
     *
     *  Reading is not a route: a bank's list is how questions are read, and a
     *  quiz's list is how the ones it asks are.
     */
    key: 'update-question',
    entry: 'src/functions/questions/update-question.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"questions/{questionId}","method":"PATCH","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    /**
     *  Deletes a question from its bank, and out of every quiz asking it. The
     *  answer says how many of them there were.
     */
    key: 'delete-question',
    entry: 'src/functions/questions/delete-question.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"questions/{questionId}","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    /**
     *  A person saying a question is right, or taking that back.
     *
     *  One function, two routes: the same decision in two directions. `PUT`
     *  records who verified it and when; `DELETE` removes the record, which is
     *  what "nobody has checked this" is.
     */
    key: 'verify-question',
    entry: 'src/functions/questions/verify-question.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"questions/{questionId}/verification","method":"PUT","authorized":true},{"path":"questions/{questionId}/verification","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  What a quiz asks.
   *
   *  A quiz owns the reference and the order, and nothing else: adding a question
   *  to a quiz adds an id, removing one removes the row and leaves the question
   *  in its bank. Every route here authorizes as a *write* on the quiz, reads
   *  included, because a quiz's questions carry the answer key.
   */
  {
    /**
     *  Every question about one course's lessons, from every bank.
     *
     *  The course page's own read. Questions carry the answer key, so this asks
     *  for organization membership rather than course membership — a learner
     *  registered for the course is not told what the answers are.
     */
    key: 'list-space-questions',
    entry: 'src/functions/quiz/list-space-questions.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    description: "Every question about a course's lessons",
    http: [{"path":"spaces/{spaceId}/questions","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'list-quiz-questions',
    entry: 'src/functions/quiz/list-quiz-questions.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/questions","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'add-quiz-questions',
    entry: 'src/functions/quiz/add-quiz-questions.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    description: 'Adds questions from banks to a quiz',
    http: [{"path":"contents/{contentId}/questions","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'remove-quiz-question',
    entry: 'src/functions/quiz/remove-quiz-question.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    description: 'Takes a question out of a quiz, leaving it in its bank',
    http: [{"path":"contents/{contentId}/questions/{questionId}","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'place-quiz-question',
    entry: 'src/functions/quiz/place-quiz-question.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/questions/placement","method":"PUT","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'verify-quiz-questions',
    entry: 'src/functions/quiz/verify-quiz-questions.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    description: "Verifies a quiz's questions in a batch",
    http: [{"path":"contents/{contentId}/questions/verification","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  Taking a quiz. The other side of the group above, and the reason the two
   *  can be told apart by their paths: what an author reads carries the answer
   *  key, and what a learner reads is the same questions without it.
   */
  {
    key: 'get-quiz',
    entry: 'src/functions/quiz/get-quiz.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    description: 'A quiz as the learner taking it sees it, without the answers',
    http: [{"path":"contents/{contentId}/quiz","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'check-quiz-answer',
    entry: 'src/functions/quiz/check-quiz-answer.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    description: 'Says whether one answer is right, recording nothing',
    http: [{"path":"contents/{contentId}/quiz/check","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'submit-quiz-attempt',
    entry: 'src/functions/quiz/submit-quiz-attempt.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    description: 'Marks a sitting of a quiz and records the attempt',
    http: [{"path":"contents/{contentId}/quiz/attempts","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    /**
     *  The worker that writes a bank's questions, driven by the event
     *  `request-question-generation` publishes.
     *
     *  Its timeout is the service's longest, because it is the one function whose
     *  whole job is waiting on another service: a model reading a transcript and
     *  writing twenty questions. A route could never give it that.
     */
    key: 'generate-questions',
    entry: 'src/functions/questions/generate-questions.ts',
    handlerExport: 'handler',
    timeout: 120,
    memorySize: 1024,
    description: "Writes a bank's questions from a lesson, with Bedrock",
    environment: {"BEDROCK_MODEL_ID":"us.amazon.nova-lite-v1:0"},
    http: [],
    s3: [],
    eventBridge: [{"source":["play.questions"],"detailType":["Quiz Generation Requested"]}],
  },
  /**
   *  Learner state. Reading the content is all any of these needs: favouriting,
   *  playlisting, and commenting are things a viewer does, not editorial acts.
   */
  {
    key: 'favourite-content',
    entry: 'src/functions/learning/favourite-content.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/favourite","method":"PUT","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'unfavourite-content',
    entry: 'src/functions/learning/unfavourite-content.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/favourite","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'add-to-playlist',
    entry: 'src/functions/learning/add-to-playlist.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/playlist","method":"PUT","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'remove-from-playlist',
    entry: 'src/functions/learning/remove-from-playlist.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/playlist","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'list-favourites',
    entry: 'src/functions/learning/list-favourites.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"me/favourites","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'list-playlist',
    entry: 'src/functions/learning/list-playlist.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"me/playlist","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'list-my-progress',
    entry: 'src/functions/learning/list-my-progress.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"me/progress","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'get-space-progress',
    entry: 'src/functions/learning/get-space-progress.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"spaces/{spaceId}/progress","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  Loops — named stretches of a lesson's video, for hearing a piece again.
   *  Shared with the course; only the learner who made one may move or delete it,
   *  which the key enforces rather than a check.
   */
  {
    key: 'create-loop',
    entry: 'src/functions/loops/create-loop.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/loops","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'list-loops',
    entry: 'src/functions/loops/list-loops.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/loops","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'update-loop',
    entry: 'src/functions/loops/update-loop.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/loops/{loopId}","method":"PATCH","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'delete-loop',
    entry: 'src/functions/loops/delete-loop.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/loops/{loopId}","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  Progress: what a learner has finished. Addressed through the lesson, keyed
   *  by the learner.
   */
  {
    key: 'complete-content',
    entry: 'src/functions/contents/complete-content.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/completion","method":"PUT","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'uncomplete-content',
    entry: 'src/functions/contents/uncomplete-content.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/completion","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'like-loop',
    entry: 'src/functions/loops/like-loop.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/loops/{loopId}/like","method":"PUT","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'unlike-loop',
    entry: 'src/functions/loops/unlike-loop.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/loops/{loopId}/like","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  The discussion on a piece of content. Comments are addressed under their
   *  content because that is the pair the table is keyed by.
   */
  {
    key: 'list-comments',
    entry: 'src/functions/comments/list-comments.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/comments","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'create-comment',
    entry: 'src/functions/comments/create-comment.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/comments","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'update-comment',
    entry: 'src/functions/comments/update-comment.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/comments/{commentId}","method":"PATCH","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'delete-comment',
    entry: 'src/functions/comments/delete-comment.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/comments/{commentId}","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'favourite-comment',
    entry: 'src/functions/comments/favourite-comment.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/comments/{commentId}/favourite","method":"PUT","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'unfavourite-comment',
    entry: 'src/functions/comments/unfavourite-comment.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"contents/{contentId}/comments/{commentId}/favourite","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  API keys — what somebody outside these two apps authenticates with.
   *
   *  Making and revoking one is ordinary account management: it is the caller's
   *  own key, so it needs nothing beyond being signed in. Reading an
   *  organization's keys is an admin's business, which is why those two routes are
   *  addressed under the organization.
   */
  {
    key: 'create-api-key',
    entry: 'src/functions/api-keys/create-api-key.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"me/api-keys","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'list-api-keys',
    entry: 'src/functions/api-keys/list-api-keys.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"me/api-keys","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'revoke-api-key',
    entry: 'src/functions/api-keys/revoke-api-key.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"me/api-keys/{keyId}","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  The person, rather than anything they belong to. A profile is what an
   *  instructor is called on a course page and what the studio's own screens draw
   *  beside a name, so it is addressed like the keys above: under `/me`, with no
   *  id in the path, because the caller's own token is the only id there is.
   */
  {
    key: 'get-my-profile',
    entry: 'src/functions/profiles/get-my-profile.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"me/profile","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'update-my-profile',
    entry: 'src/functions/profiles/update-my-profile.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"me/profile","method":"PUT","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  The photo is an upload like a course cover: this reserves the object and
   *  points the profile at it, and the bytes go from the browser straight to S3.
   */
  {
    key: 'upload-my-profile-photo',
    entry: 'src/functions/profiles/upload-my-profile-photo.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"me/profile/photo","method":"PUT","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'list-organization-api-keys',
    entry: 'src/functions/api-keys/list-organization-api-keys.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"organizations/{orgId}/api-keys","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'revoke-organization-api-key',
    entry: 'src/functions/api-keys/revoke-organization-api-key.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"organizations/{orgId}/api-keys/{keyId}","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  The public API: `/v1`. Read-only, addressed by a credential, and the surface
   *  the docs page describes.
   *
   *  These routes carry **no `authorizer`**, like the two public catalog routes
   *  below, and for the reason written out under `custom:`: a request authorizer
   *  cannot accept a credential from one of two headers. They are not
   *  unauthenticated — each handler's first line resolves the caller and answers a
   *  401 of its own — but the gateway is no longer what refuses a stranger.
   *
   *  They are deliberately few: a curated surface somebody can integrate against
   *  and be held to, rather than every handler this service has opened to a second
   *  kind of caller.
   */
  {
    key: 'get-api-key-identity',
    entry: 'src/functions/public/get-api-identity.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"v1/me","method":"GET","authorized":false}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'get-api-profile',
    entry: 'src/functions/public/get-api-profile.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"v1/me/profile","method":"GET","authorized":false}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'list-public-courses',
    entry: 'src/functions/public/list-public-courses.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"v1/courses","method":"GET","authorized":false}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'get-public-course',
    entry: 'src/functions/public/get-public-course.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"v1/courses/{spaceId}","method":"GET","authorized":false}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'list-organization-courses',
    entry: 'src/functions/public/list-organization-courses.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"v1/organizations/{orgId}/courses","method":"GET","authorized":false}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  A lesson, to a key that may read it: the pieces a page needs to teach with —
   *  the outline it sits in, the lesson itself, its video, its subtitles, and the
   *  attachments beside it.
   *
   *  These are authorized by *access* rather than by publication, which is what
   *  separates them from the catalog routes above. A key reaches what its owner
   *  may read; a key made for an organization reaches everything that
   *  organization owns, published or not. That is what makes it possible to build
   *  the classroom somewhere else.
   */
  {
    key: 'list-course-sections',
    entry: 'src/functions/public/list-course-sections.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"v1/courses/{spaceId}/sections","method":"GET","authorized":false}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'get-lesson',
    entry: 'src/functions/public/get-lesson.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"v1/lessons/{contentId}","method":"GET","authorized":false}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'get-lesson-stream',
    entry: 'src/functions/public/get-lesson-stream.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"v1/lessons/{contentId}/stream","method":"GET","authorized":false}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'get-lesson-subtitles',
    entry: 'src/functions/public/get-lesson-subtitles.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"v1/lessons/{contentId}/subtitles","method":"GET","authorized":false}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'list-lesson-attachments',
    entry: 'src/functions/public/list-lesson-attachments.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"v1/lessons/{contentId}/attachments","method":"GET","authorized":false}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  The learner's own side of a lesson: what they have done with it, and what
   *  they have said about it. These are the only routes under `/v1` that write,
   *  and each is behind a scope of its own — `learning:write` for the two
   *  toggles, `comments:write` for the one that puts somebody's name on
   *  something. See docs/workspace.md for what that costs a consent screen.
   */
  {
    key: 'complete-lesson',
    entry: 'src/functions/public/complete-lesson.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"v1/lessons/{contentId}/completion","method":"PUT","authorized":false},{"path":"v1/lessons/{contentId}/completion","method":"DELETE","authorized":false}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'favourite-lesson',
    entry: 'src/functions/public/favourite-lesson.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"v1/lessons/{contentId}/favourite","method":"PUT","authorized":false},{"path":"v1/lessons/{contentId}/favourite","method":"DELETE","authorized":false}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  The key stays `create-lesson-comment` while the handler serves two methods,
   *  and the rule is the one written down under `custom:`: a function key is the
   *  name of a *deployed* thing, and `serverless-plugin-split-stacks` keeps a
   *  deployed nested stack where it is. Renaming the key here while the old name
   *  was mid-deploy left the service holding two nested stacks for one function —
   *  501 resources, one over CloudFormation's ceiling, which is a deploy that
   *  does not run. The file is `lesson-comments.ts`, which is what the code is.
   */
  {
    key: 'create-lesson-comment',
    entry: 'src/functions/public/lesson-comments.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"v1/lessons/{contentId}/comments","method":"GET","authorized":false},{"path":"v1/lessons/{contentId}/comments","method":"POST","authorized":false}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'get-my-learning',
    entry: 'src/functions/public/get-my-learning.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"v1/me/learning","method":"GET","authorized":false}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  OAuth: letting somebody else's app act as one of our people, with their
   *  consent. Two audiences, and the difference between them is the authorizer.
   *
   *  ## Registration and consent — behind the Cognito authorizer
   *
   *  Everything a person does while signed in to the studio: registering an app,
   *  editing it, reading and ending the authorizations they have granted, and the
   *  two calls the consent screen makes — one to find out what it is being asked
   *  for, one to say yes.
   */
  {
    key: 'oauth-list-apps',
    entry: 'src/functions/oauth/list-apps.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"oauth/apps","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'oauth-create-app',
    entry: 'src/functions/oauth/create-app.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"oauth/apps","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'oauth-get-app',
    entry: 'src/functions/oauth/get-app.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"oauth/apps/{appId}","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'oauth-update-app',
    entry: 'src/functions/oauth/update-app.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"oauth/apps/{appId}","method":"PATCH","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'oauth-delete-app',
    entry: 'src/functions/oauth/delete-app.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"oauth/apps/{appId}","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'oauth-rotate-app-secret',
    entry: 'src/functions/oauth/rotate-app-secret.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"oauth/apps/{appId}/secret","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'oauth-describe-authorization',
    entry: 'src/functions/oauth/describe-authorization.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"oauth/authorization-request","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'oauth-authorize',
    entry: 'src/functions/oauth/authorize.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"oauth/authorize","method":"POST","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'oauth-list-connections',
    entry: 'src/functions/oauth/list-connections.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"oauth/connections","method":"GET","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'oauth-delete-connection',
    entry: 'src/functions/oauth/delete-connection.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"oauth/connections/{appId}","method":"DELETE","authorized":true}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  ## The token endpoint — no authorizer
   *
   *  The one route on this service whose caller is a third party's *backend*. It
   *  authenticates itself: the client id and secret are form parameters or an
   *  HTTP Basic header, checked in the handler, and API Gateway has no opinion
   *  about them. `cors: true` is still set, because a public client — one with no
   *  secret, which is what a browser app is — calls this from a page.
   */
  {
    key: 'oauth-token',
    entry: 'src/functions/oauth/token.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"oauth/token","method":"POST","authorized":false}],
    s3: [],
    eventBridge: [],
  },
  /**
   *  RFC 7009 revocation, for an app that is done with somebody.
   */
  {
    key: 'oauth-revoke',
    entry: 'src/functions/oauth/revoke.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    http: [{"path":"oauth/revoke","method":"POST","authorized":false}],
    s3: [],
    eventBridge: [],
  },
  {
    key: 'process-video',
    entry: 'src/functions/processing/process-video.ts',
    handlerExport: 'handler',
    timeout: 60,
    memorySize: 512,
    http: [],
    s3: [{"bucket":"VideosBucket","events":["s3:ObjectCreated:*"],"prefix":"uploads/"}],
    eventBridge: [],
  },
  {
    key: 'video-processing-complete',
    entry: 'src/functions/processing/video-processing-complete.ts',
    handlerExport: 'handler',
    timeout: 60,
    memorySize: 512,
    http: [],
    s3: [],
    eventBridge: [{"source":["aws.mediaconvert"],"detailType":["MediaConvert Job State Change"],"detail":{"status":["COMPLETE","ERROR","CANCELED"]}}],
  },
  {
    key: 'subtitle-generation-complete',
    entry: 'src/functions/processing/subtitle-generation-complete.ts',
    handlerExport: 'handler',
    timeout: 60,
    memorySize: 512,
    http: [],
    s3: [],
    eventBridge: [{"source":["aws.transcribe"],"detailType":["Transcribe Job State Change"],"detail":{"TranscriptionJobStatus":["COMPLETED","FAILED"]}}],
  },
  /**
   *  Pre sign-up trigger: gives a first-time Google sign-in the same account as an
   *  existing password account with the same verified email. Wired to the user pool
   *  below (see LambdaConfig) and given its own role, because the pool references
   *  this function and a shared role that referenced the pool back would form a
   *  CloudFormation dependency cycle.
   */
  {
    key: 'link-federated-user',
    entry: 'src/functions/auth/link-federated-user.ts',
    handlerExport: 'handler',
    timeout: 10,
    memorySize: 512,
    description: "Links a federated sign-in to the existing account with the same verified email",
    ownRole: true,
    http: [],
    s3: [],
    eventBridge: [],
  },
  /**
   *  Stripe calls this, not a browser, so it has **no API Gateway route** — it
   *  answers on a Lambda function URL published by `PlayPaymentStack`, which is
   *  the URL pasted into the Stripe dashboard. It therefore carries no authorizer
   *  and is public by necessity: the request is authenticated by its
   *  `Stripe-Signature` header, which the handler verifies against this
   *  environment's webhook signing secret before it reads a byte of the body.
   *
   *  Its own role, like the pre sign-up trigger above, because it lives in the
   *  stack that owns the credential it verifies with — see
   *  `src/stacks/payment-stack.ts`.
   */
  {
    key: 'stripe-webhook',
    entry: 'src/functions/payments/stripe-webhook.ts',
    handlerExport: 'handler',
    timeout: 29,
    memorySize: 512,
    description: "Records what Stripe was paid: verifies the event signature, then writes the payment and enrols the buyer",
    ownRole: true,
    http: [],
    s3: [],
    eventBridge: [],
  },
];
