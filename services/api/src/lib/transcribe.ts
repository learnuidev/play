import {
  StartTranscriptionJobCommand,
  TranscribeClient,
} from '@aws-sdk/client-transcribe';
import type { LanguageCode } from '@aws-sdk/client-transcribe';
import { env } from './config';

let client: TranscribeClient | undefined;

function getTranscribeClient(): TranscribeClient {
  if (!client) client = new TranscribeClient({});
  return client;
}

export interface TranscribeJob {
  videoId: string;
  inputUrl: string;
  languageCode: LanguageCode;
}

export interface StartTranscribeResult {
  jobName: string;
}

/**
 * Starts an AWS Transcribe job that turns the raw upload into a WebVTT
 * subtitle file. The subtitle (and transcript) land under
 * `subtitles/{videoId}/` in the videos bucket.
 */
export async function startTranscriptionJob({ videoId, inputUrl, languageCode }: TranscribeJob): Promise<StartTranscribeResult> {
  // Job names must be unique, so include a timestamp. The videoId (a UUID)
  // is recoverable from the name by the completion handler.
  const jobName = `play-${videoId}-${Date.now()}`;

  await getTranscribeClient().send(
    new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: languageCode,
      Media: { MediaFileUri: inputUrl },
      OutputBucketName: env.bucket,
      OutputKey: `subtitles/${videoId}/source/`,
      Subtitles: { Formats: ['vtt'], OutputStartIndex: 1 },
      JobExecutionSettings: { DataAccessRoleArn: env.transcribeRoleArn },
    }),
  );

  return { jobName };
}
