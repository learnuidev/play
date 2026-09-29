import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { QuestionBank, QuizGeneration } from '../types';
import { env } from './config';
import { documentClient as client } from './dynamodb';

export const QUESTION_BANKS_TABLE = env.questionBanksTableName;

/** An organization's banks, in the order they were made. */
const ORGANIZATION_CREATED_INDEX = 'OrganizationCreatedIndex';

export async function putBank(bank: QuestionBank): Promise<void> {
  await client.send(new PutCommand({ TableName: QUESTION_BANKS_TABLE, Item: bank }));
}

export async function getBank(bankId: string): Promise<QuestionBank | undefined> {
  const res = await client.send(
    new GetCommand({ TableName: QUESTION_BANKS_TABLE, Key: { bankId } }),
  );
  return res.Item as QuestionBank | undefined;
}

export interface UpdateBankPatch {
  name?: string;
  description?: string;
  /**
   * The state of an AI run against this bank.
   *
   * Pass `null` to clear it — what a run that has been read does, so the page
   * stops reporting it. Only `lib/quiz-generation` writes one.
   */
  generation?: QuizGeneration | null;
}

export async function updateBank(bankId: string, patch: UpdateBankPatch): Promise<void> {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ':updatedAt': Date.now() };
  let set = 'SET updatedAt = :updatedAt';
  let remove = '';

  const assign = (field: string, value: unknown) => {
    names[`#${field}`] = field;
    values[`:${field}`] = value;
    set += `, #${field} = :${field}`;
  };

  if (patch.name !== undefined) assign('name', patch.name);
  if (patch.description !== undefined) assign('description', patch.description);

  if (patch.generation !== undefined) {
    if (patch.generation === null) {
      names['#generation'] = 'generation';
      remove = ', #generation';
    } else {
      assign('generation', patch.generation);
    }
  }

  const expression = remove ? `${set} REMOVE ${remove.slice(2)}` : set;

  await client.send(
    new UpdateCommand({
      TableName: QUESTION_BANKS_TABLE,
      Key: { bankId },
      UpdateExpression: expression,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function deleteBankItem(bankId: string): Promise<void> {
  await client.send(new DeleteCommand({ TableName: QUESTION_BANKS_TABLE, Key: { bankId } }));
}

/** Every bank an organization owns, oldest first. */
export async function listBanksByOrganization(organizationId: string): Promise<QuestionBank[]> {
  const banks: QuestionBank[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await client.send(
      new QueryCommand({
        TableName: QUESTION_BANKS_TABLE,
        IndexName: ORGANIZATION_CREATED_INDEX,
        KeyConditionExpression: '#organizationId = :organizationId',
        ExpressionAttributeNames: { '#organizationId': 'organizationId' },
        ExpressionAttributeValues: { ':organizationId': organizationId },
        ScanIndexForward: true,
        Limit: 100,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    banks.push(...((res.Items ?? []) as QuestionBank[]));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return banks;
}

/**
 * Moves a bank's question counter by a delta.
 *
 * `ADD` is atomic and treats a missing attribute as zero, so a counter never
 * needs initializing and two people importing into one bank at the same moment
 * cannot lose one another's increment — the same reasoning as a content's
 * counters. Conditional on the bank existing, because `ADD` would otherwise
 * create a row holding nothing but an id and a count.
 */
export async function addBankQuestionCount(bankId: string, delta: number): Promise<void> {
  if (delta === 0) return;

  try {
    await client.send(
      new UpdateCommand({
        TableName: QUESTION_BANKS_TABLE,
        Key: { bankId },
        UpdateExpression: 'ADD questionCount :delta',
        ConditionExpression: 'attribute_exists(bankId)',
        ExpressionAttributeValues: { ':delta': delta },
      }),
    );
  } catch {
    // The bank is gone, so its counter is gone with it. Nothing to report: the
    // caller is deleting questions out of a bank somebody deleted first.
  }
}
