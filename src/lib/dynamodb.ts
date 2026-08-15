import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Video, VideoStatus } from '../types';
import { env } from './config';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

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
  manifestKey?: string;
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
  if (patch.manifestKey !== undefined) {
    names['#manifestKey'] = 'manifestKey';
    values[':manifestKey'] = patch.manifestKey;
    set += ', #manifestKey = :manifestKey';
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

export async function listVideosByOwner(ownerId: string, opts: ListOptions): Promise<ListResult> {
  if (opts.status) {
    const res = await client.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'OwnerStatusIndex',
        KeyConditionExpression: '#owner = :owner AND #status = :status',
        ExpressionAttributeNames: { '#owner': 'ownerId', '#status': 'status' },
        ExpressionAttributeValues: { ':owner': ownerId, ':status': opts.status },
        Limit: opts.limit,
        ExclusiveStartKey: opts.exclusiveStartKey,
      }),
    );
    const videos = (res.Items ?? []) as Video[];
    videos.sort((a, b) => b.createdAt - a.createdAt);
    return { videos, lastEvaluatedKey: res.LastEvaluatedKey };
  }

  const res = await client.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'OwnerCreatedIndex',
      KeyConditionExpression: '#owner = :owner',
      ExpressionAttributeNames: { '#owner': 'ownerId' },
      ExpressionAttributeValues: { ':owner': ownerId },
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
