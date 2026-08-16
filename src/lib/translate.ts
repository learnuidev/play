import {
  TranslateClient,
  TranslateTextCommand,
} from '@aws-sdk/client-translate';
import { parseVtt, serializeVtt } from './vtt';

let client: TranslateClient | undefined;

function getTranslateClient(): TranslateClient {
  if (!client) client = new TranslateClient({});
  return client;
}

export interface TranslationLanguage {
  /** AWS Translate target language code. */
  code: string;
  /** BCP-47 language code used for storage and <track srcLang>. */
  bcp47: string;
  /** Human-readable label. */
  label: string;
}

export const TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  { code: 'zh', bcp47: 'zh-CN', label: 'Mandarin Chinese' },
  { code: 'fr', bcp47: 'fr', label: 'French' },
  { code: 'es', bcp47: 'es', label: 'Spanish' },
];

export function getTranslationLanguage(bcp47: string): TranslationLanguage | undefined {
  return TRANSLATION_LANGUAGES.find((l) => l.bcp47 === bcp47);
}

/**
 * Maps a BCP-47 source language (e.g. 'en-US') to the two-letter code AWS
 * Translate expects (e.g. 'en').
 */
export function toTranslateLanguageCode(bcp47: string | undefined): string {
  if (!bcp47) return 'en';
  return bcp47.split('-')[0].toLowerCase();
}

export async function translateText(
  text: string,
  sourceLanguageCode: string,
  targetLanguageCode: string,
): Promise<string> {
  const res = await getTranslateClient().send(
    new TranslateTextCommand({
      Text: text,
      SourceLanguageCode: sourceLanguageCode,
      TargetLanguageCode: targetLanguageCode,
    }),
  );
  return res.TranslatedText ?? '';
}

/** Runs `fn` over `items` with a bounded number of concurrent workers. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Translates each cue's text into the target language, preserving cue timing
 * and multi-line cue structure. Empty lines are left untouched.
 */
export async function translateVtt(
  content: string,
  sourceLanguageCode: string,
  target: TranslationLanguage,
): Promise<string> {
  const cues = parseVtt(content);

  const translated = await mapWithConcurrency(cues, 15, async (cue) => {
    const lines = cue.text.split('\n');
    const out = await Promise.all(
      lines.map(async (line) => {
        const trimmed = line.trim();
        if (!trimmed) return '';
        return translateText(trimmed, sourceLanguageCode, target.code);
      }),
    );
    return { ...cue, text: out.join('\n') };
  });

  return serializeVtt(translated);
}
