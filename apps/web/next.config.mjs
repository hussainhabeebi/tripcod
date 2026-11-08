/** @type {import('next').NextConfig} */
const nextConfig = {
  // Hotel occupancy / guest rules are shared with the API as TypeScript source.
  transpilePackages: ["@tripcod/suppliers"],
};

export default nextConfig;
