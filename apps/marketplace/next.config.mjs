/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Same source-only workspace packages as the studio: `@play/*` ships `.ts`
  // and `.tsx`, so Next compiles them as if they were part of this app.
  transpilePackages: ['@play/types', '@play/ui', '@play/api', '@play/auth', '@play/learning'],

  experimental: { externalDir: true },
};

export default nextConfig;
