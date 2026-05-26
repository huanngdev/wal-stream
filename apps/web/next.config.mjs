/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@workspace/ui", "@workspace/shared"],
  serverExternalPackages: ["@mysten/sui"],
}

export default nextConfig
