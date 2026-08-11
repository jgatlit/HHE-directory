import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Inter, Playfair_Display } from 'next/font/google';
import './globals.css';

// Theme D type system (cms.chem.dev/hhe-directory): Inter = body/sans,
// Playfair Display = display serif (practitioner names + page headings).
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});
const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
});
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
});

const SITE = 'https://naturalhealthpros.com';
const TITLE = 'Natural Health Pros — Natural Health Professional Directory';
const DESCRIPTION =
  'Find trained holistic health professionals — coaches, nutritional counselors, gut health and energy medicine practitioners — and book directly. Every practitioner has formal training in their specialty.';

/*
 * metadataBase resolves the relative OG image URL against the canonical host;
 * without it a shared link points at the deployment URL.
 *
 * No `title.template` here on purpose: /search and the profile pages already
 * spell out "· Natural Health Pros" in their own title strings, and a template
 * would apply on top of those and suffix them twice.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: 'Natural Health Pros',
  keywords: [
    'holistic health directory',
    'holistic health coach',
    'therapeutic nutrition',
    'gut health practitioner',
    'energy medicine',
    'virtual wellness sessions',
  ],
  // No `url` and no `alternates.canonical` at this level — both are per-route
  // facts, and set here they would point every page at the home page. The
  // landing page declares its own; see src/app/page.tsx.
  openGraph: {
    type: 'website',
    siteName: 'Natural Health Pros',
    title: TITLE,
    description: DESCRIPTION,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  category: 'health',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable} ${geistMono.variable}`}>
      {/* The landing page's full-bleed ambient layers overshoot the viewport
          during their scrub; without this the page gains a horizontal scrollbar. */}
      <body className="overflow-x-hidden font-sans antialiased">{children}</body>
    </html>
  );
}
