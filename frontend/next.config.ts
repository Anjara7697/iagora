import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Image de production minimale (voir frontend/Dockerfile) : serveur Node autonome.
  output: "standalone",
};

export default nextConfig;
