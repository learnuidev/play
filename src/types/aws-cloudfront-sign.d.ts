declare module 'aws-cloudfront-sign' {
  interface SignOptions {
    keypairId: string;
    privateKeyString?: string;
    privateKeyPath?: string;
    policy?: string | object;
    expires?: number;
  }

  export function getSignedUrl(url: string, options: SignOptions): string;
}
