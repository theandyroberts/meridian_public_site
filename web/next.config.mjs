/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [{source: '/composite-review/media/:path*', destination: 'https://platelabstudio.com/composite-review/media/:path*'}];
  },
  transpilePackages: ["@platelab/shared"],
};

export default nextConfig;
