import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "m.media-amazon.com", pathname: "/**" },
      { protocol: "https", hostname: "images-na.ssl-images-amazon.com", pathname: "/**" },
      { protocol: "https", hostname: "images-eu.ssl-images-amazon.com", pathname: "/**" },
      { protocol: "https", hostname: "images-fe.ssl-images-amazon.com", pathname: "/**" },
    ],
  },
};

export default nextConfig;
