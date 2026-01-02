import webpackPkg from 'next/dist/compiled/webpack/webpack-lib.js';
const { IgnorePlugin } = webpackPkg;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.plugins.push(new IgnorePlugin({ resourceRegExp: /ort\.node\.min\.mjs$/ }));
      config.plugins.push(new IgnorePlugin({ resourceRegExp: /ort\.node\.min\.js$/ }));
    }
    return config;
  },
};

export default nextConfig;
