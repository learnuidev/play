/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The workspace packages ship `.ts` and `.tsx` rather than a build output, so
  // Next compiles them as if they were part of this app. Only the three this app
  // actually uses: `@play/auth` and `@play/api` are Play's own signed-in client,
  // and this app is deliberately *not* signed in — it is a third party holding
  // an OAuth token, which is the whole point of it existing.
  transpilePackages: ['@play/types', '@play/ui', '@play/learning'],

  experimental: { externalDir: true },
};

export default nextConfig;
