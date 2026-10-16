import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: { cpus: 2 },
  outputFileTracingIncludes: { '/*': ['./drizzle/*.sql'] },
};

export default nextConfig;
