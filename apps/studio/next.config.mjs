/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * The packages are source, not builds: `@play/*` ships `.ts`/`.tsx` and no
   * `dist/`, so Next has to compile them as if they were part of this app. That
   * is deliberate — one TypeScript program across the app and its packages means
   * a change to a shared component is a change the app's typecheck sees.
   */
  transpilePackages: ['@play/types', '@play/ui', '@play/api', '@play/auth', '@play/learning'],

  // The packages live outside this app's directory, which webpack allows only
  // when the app says so.
  experimental: { externalDir: true },
};

export default nextConfig;
