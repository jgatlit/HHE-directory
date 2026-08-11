/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Practitioner headshots live in the public Vercel Blob store; the landing
    // page's directory rail runs them through next/image.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.public.blob.vercel-storage.com',
      },
    ],
  },
};

export default nextConfig;
