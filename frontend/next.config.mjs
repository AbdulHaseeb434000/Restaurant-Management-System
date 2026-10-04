/** @type {import('next').NextConfig} */
const backend = process.env.BACKEND_URL || "http://localhost:8111";

const nextConfig = {
  output: "standalone",
  // The browser talks to /api/* on the same origin; Next proxies it to FastAPI.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;
