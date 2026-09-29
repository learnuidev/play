/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * The console is *not* a Play product surface.
   *
   * The studio and the marketplace draw with `@play/ui` because they are the
   * same product seen from two sides. This app is the room the operator stands
   * in — it reads the repository, runs `aws` and `cdk`, and starts the other
   * three apps. Sharing the product's primitives would tie an internal tool to
   * a design that is meant to move as the product moves, and would drag the
   * package graph (Radix, Amplify, the aliases) into a tool that has no
   * business rendering a lesson.
   *
   * So: no `transpilePackages`, no `@play/*` imports, one self-contained app.
   */
};

export default nextConfig;
