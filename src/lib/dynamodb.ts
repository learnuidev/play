import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { AudioStatus, SubtitleStatus, SubtitleTranslation, Video, VideoStatus } from '../types';
import { env } from './config';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/** Shared document client, so every repository talks to DynamoDB the same way. */
export const documentClient = client;

export const TABLE = env.tableName;

export async function putVideo(video: Video): Promise<void> {
  await client.send(new PutCommand({ TableName: TABLE, Item: video }));
}

export async function getVideo(videoId: string): Promise<Video | undefined> {
  const res = await client.send(
    new GetCommand({ TableName: TABLE, Key: { videoId } }),
  );
  return res.Item as Video | undefined;
}

export interface UpdateVideoPatch {
  status?: VideoStatus;
  title?: string;
  description?: string;
  size?: number;
  width?: number;
  height?: number;
  duration?: number;
  aspectRatio?: string;
  resolutionTier?: string;
  manifestKey?: string;
  audioKey?: string;
  audioStatus?: AudioStatus;
  subtitleStatus?: SubtitleStatus;
  subtitleKey?: string;
  subtitleLanguage?: string;
  /** Full translations map, keyed by BCP-47 code. Pass `null` to remove. */
  translations?: Record<string, SubtitleTranslation> | null;
  thumbnailKey?: string;
}

export async function updateVideo(videoId: string, patch: UpdateVideoPatch): Promise<void> {
  const now = Date.now();

  let set = 'SET updatedAt = :updatedAt';
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ':updatedAt': now };

  if (patch.status !== undefined) {
    names['#status'] = 'status';
    values[':status'] = patch.status;
    set += ', #status = :status';
  }
  if (patch.title !== undefined) {
    names['#title'] = 'title';
    values[':title'] = patch.title;
    set += ', #title = :title';
  }
  if (patch.description !== undefined) {
    names['#description'] = 'description';
    values[':description'] = patch.description;
    set += ', #description = :description';
  }
  if (patch.size !== undefined) {
    names['#size'] = 'size';
    values[':size'] = patch.size;
    set += ', #size = :size';
  }
  if (patch.width !== undefined) {
    names['#width'] = 'width';
    values[':width'] = patch.width;
    set += ', #width = :width';
  }
  if (patch.height !== undefined) {
    names['#height'] = 'height';
    values[':height'] = patch.height;
    set += ', #height = :height';
  }
  if (patch.duration !== undefined) {
    names['#duration'] = 'duration';
    values[':duration'] = patch.duration;
    set += ', #duration = :duration';
  }
  if (patch.aspectRatio !== undefined) {
    names['#aspectRatio'] = 'aspectRatio';
    values[':aspectRatio'] = patch.aspectRatio;
    set += ', #aspectRatio = :aspectRatio';
  }
  if (patch.resolutionTier !== undefined) {
    names['#resolutionTier'] = 'resolutionTier';
    values[':resolutionTier'] = patch.resolutionTier;
    set += ', #resolutionTier = :resolutionTier';
  }
  if (patch.manifestKey !== undefined) {
    names['#manifestKey'] = 'manifestKey';
    values[':manifestKey'] = patch.manifestKey;
    set += ', #manifestKey = :manifestKey';
  }
  if (patch.audioKey !== undefined) {
    names['#audioKey'] = 'audioKey';
    values[':audioKey'] = patch.audioKey;
    set += ', #audioKey = :audioKey';
  }
  if (patch.audioStatus !== undefined) {
    names['#audioStatus'] = 'audioStatus';
    values[':audioStatus'] = patch.audioStatus;
    set += ', #audioStatus = :audioStatus';
  }
  if (patch.subtitleStatus !== undefined) {
    names['#subtitleStatus'] = 'subtitleStatus';
    values[':subtitleStatus'] = patch.subtitleStatus;
    set += ', #subtitleStatus = :subtitleStatus';
  }
  if (patch.subtitleKey !== undefined) {
    names['#subtitleKey'] = 'subtitleKey';
    values[':subtitleKey'] = patch.subtitleKey;
    set += ', #subtitleKey = :subtitleKey';
  }
  if (patch.subtitleLanguage !== undefined) {
    names['#subtitleLanguage'] = 'subtitleLanguage';
    values[':subtitleLanguage'] = patch.subtitleLanguage;
    set += ', #subtitleLanguage = :subtitleLanguage';
  }
  if (patch.translations === null) {
    names['#translations'] = 'translations';
    set += ' REMOVE #translations';
  } else if (patch.translations !== undefined) {
    names['#translations'] = 'translations';
    values[':translations'] = patch.translations;
    set += ', #translations = :translations';
  }
  if (patch.thumbnailKey !== undefined) {
    names['#thumbnailKey'] = 'thumbnailKey';
    values[':thumbnailKey'] = patch.thumbnailKey;
    set += ', #thumbnailKey = :thumbnailKey';
  }

  await client.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { videoId },
      UpdateExpression: set,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function deleteVideoItem(videoId: string): Promise<void> {
  await client.send(new DeleteCommand({ TableName: TABLE, Key: { videoId } }));
}

export interface ListResult {
  videos: Video[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface ListOptions {
  status?: VideoStatus;
  limit: number;
  exclusiveStartKey?: Record<string, unknown>;
}

/**
 * Queries videos through an owner or organization index.
 *
 * Both key spaces carry the same pair of indexes — `{Prefix}StatusIndex` for
 * status filtering and `{Prefix}CreatedIndex` for chronological listing — so
 * the query only differs by index and key name.
 */
async function listVideosByIndex(
  keyName: 'ownerId' | 'organizationId',
  indexPrefix: 'Owner' | 'Organization',
  keyValue: string,
  opts: ListOptions,
): Promise<ListResult> {
  if (opts.status) {
    const res = await client.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: `${indexPrefix}StatusIndex`,
        KeyConditionExpression: '#key = :key AND #status = :status',
        ExpressionAttributeNames: { '#key': keyName, '#status': 'status' },
        ExpressionAttributeValues: { ':key': keyValue, ':status': opts.status },
        Limit: opts.limit,
        ExclusiveStartKey: opts.exclusiveStartKey,
      }),
    );
    // This index is ordered by status, not time, so order the page here.
    const videos = (res.Items ?? []) as Video[];
    videos.sort((a, b) => b.createdAt - a.createdAt);
    return { videos, lastEvaluatedKey: res.LastEvaluatedKey };
  }

  const res = await client.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: `${indexPrefix}CreatedIndex`,
      KeyConditionExpression: '#key = :key',
      ExpressionAttributeNames: { '#key': keyName },
      ExpressionAttributeValues: { ':key': keyValue },
      Limit: opts.limit,
      ExclusiveStartKey: opts.exclusiveStartKey,
      ScanIndexForward: false,
    }),
  );

  return {
    videos: (res.Items ?? []) as Video[],
    lastEvaluatedKey: res.LastEvaluatedKey,
  };
}

/** Videos uploaded by a user, across every organization they uploaded to. */
export function listVideosByOwner(ownerId: string, opts: ListOptions): Promise<ListResult> {
  return listVideosByIndex('ownerId', 'Owner', ownerId, opts);
}

/** Videos that belong to an organization, newest first. */
export function listVideosByOrganization(organizationId: string, opts: ListOptions): Promise<ListResult> {
  return listVideosByIndex('organizationId', 'Organization', organizationId, opts);
}
