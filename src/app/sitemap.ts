import { MetadataRoute } from 'next';
import { PREBUILT_WORKFLOWS } from '@/constants/prebuilt-workflows';

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://buildflow.vercel.app';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[→+]/g, 'to')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export default function sitemap(): MetadataRoute.Sitemap {
  const currentDate = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: siteUrl,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${siteUrl}/login`,
      lastModified: currentDate,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${siteUrl}/register`,
      lastModified: currentDate,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${siteUrl}/demo`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${siteUrl}/contact`,
      lastModified: currentDate,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${siteUrl}/book-demo`,
      lastModified: currentDate,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${siteUrl}/privacy`,
      lastModified: currentDate,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${siteUrl}/terms`,
      lastModified: currentDate,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${siteUrl}/workflows`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      url: `${siteUrl}/pricing`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${siteUrl}/forgot-password`,
      lastModified: currentDate,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${siteUrl}/blog`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      url: `${siteUrl}/templates`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
  ];

  // Generate a sitemap entry for each workflow template
  const templateRoutes: MetadataRoute.Sitemap = PREBUILT_WORKFLOWS.map((w) => ({
    url: `${siteUrl}/templates/${slugify(w.name)}`,
    lastModified: currentDate,
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }));

  return [...staticRoutes, ...templateRoutes];
}
