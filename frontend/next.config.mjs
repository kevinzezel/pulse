/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      { source: '/groups', destination: '/', permanent: false },
    ];
  },
};

export default nextConfig;
