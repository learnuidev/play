function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  tableName: required('VIDEOS_TABLE', process.env.VIDEOS_TABLE),
  bucket: required('VIDEOS_BUCKET', process.env.VIDEOS_BUCKET),
  cloudfrontDomain: required('CLOUDFRONT_DOMAIN', process.env.CLOUDFRONT_DOMAIN),
  cloudfrontKeyPairId: required('CLOUDFRONT_KEY_PAIR_ID', process.env.CLOUDFRONT_KEY_PAIR_ID),
  cloudfrontPrivateKey: Buffer.from(process.env.CLOUDFRONT_PRIVATE_KEY ?? '', 'base64').toString('utf8'),
  mediaconvertRoleArn: required('MEDIACONVERT_ROLE_ARN', process.env.MEDIACONVERT_ROLE_ARN),
  transcribeRoleArn: required('TRANSCRIBE_ROLE_ARN', process.env.TRANSCRIBE_ROLE_ARN),
  subtitleLanguage: process.env.SUBTITLE_LANGUAGE ?? 'en-US',
  streamTtlSeconds: Number(process.env.STREAM_URL_TTL_SECONDS ?? 900),
};
