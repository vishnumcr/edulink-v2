import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",

  reactStrictMode: true,

  images: {
    unoptimized: true,
  },

  allowedDevOrigins: ["192.168.1.2"],
};

export default nextConfig;