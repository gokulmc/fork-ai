// Server component — emits structured data for search engines (Organization +
// WebSite + SoftwareApplication). Rendered once in the root layout.
const SITE_URL = 'https://forkai.in';
const DESCRIPTION = 'A branching research workspace — ask once, branch forever.';

const graph = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: 'fork ai',
      legalName: 'CURIOSTEM LEARNING PRIVATE LIMITED',
      url: SITE_URL,
      logo: `${SITE_URL}/mark-168.png`,
      email: 'support@forkai.in',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Erode',
        addressRegion: 'Tamil Nadu',
        addressCountry: 'IN',
      },
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      name: 'fork ai',
      url: SITE_URL,
      description: DESCRIPTION,
      publisher: { '@id': `${SITE_URL}/#organization` },
    },
    {
      '@type': 'SoftwareApplication',
      name: 'fork ai',
      applicationCategory: 'EducationApplication',
      operatingSystem: 'Web, iOS, Android',
      url: SITE_URL,
      description:
        'fork ai is an AI research workspace. Ask a question, get a structured answer split into sections, then branch any section into a child node or highlight a passage to ask a follow-up — every branch becomes a node on a live mind map.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
  ],
};

export function JsonLd() {
  return (
    <script
      type="application/ld+json"
      // Safe: static, app-authored JSON — no user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
