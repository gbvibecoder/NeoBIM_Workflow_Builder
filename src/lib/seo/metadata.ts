// 🔍 SEO HELPER - Reusable metadata generators for pages
import { Metadata } from "next";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://neobim.vercel.app";

interface PageMetadataProps {
  title: string;
  description: string;
  keywords?: string[];
  path?: string;
  ogImage?: string;
  noIndex?: boolean;
}

/**
 * Generate consistent metadata for any page
 * Usage: export const metadata = generatePageMetadata({ ... })
 */
export function generatePageMetadata({
  title,
  description,
  keywords = [],
  path = "",
  ogImage = "/og-image.png",
  noIndex = false,
}: PageMetadataProps): Metadata {
  const fullUrl = `${siteUrl}${path}`;
  
  return {
    title,
    description,
    keywords: keywords.length > 0 ? keywords : undefined,
    
    alternates: {
      canonical: fullUrl,
    },
    
    robots: noIndex
      ? {
          index: false,
          follow: false,
        }
      : {
          index: true,
          follow: true,
        },
    
    openGraph: {
      title,
      description,
      url: fullUrl,
      siteName: "Workflow Builder",
      images: [
        {
          url: `${siteUrl}${ogImage}`,
          width: 1200,
          height: 630,
        },
      ],
      locale: "en_US",
      type: "website",
    },
    
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${siteUrl}${ogImage}`],
    },
  };
}

/**
 * Predefined metadata for common pages
 */
export const pageSEO = {
  home: generatePageMetadata({
    title: "Workflow Builder — AI-Powered Workflows for AEC",
    description:
      "Build AI-powered AEC workflows visually. Drag-and-drop nodes to create pipelines from PDF briefs to 3D massing to concept renders — without writing code.",
    keywords: [
      "AEC workflow builder",
      "AI architecture tool",
      "BIM automation",
      "building design AI",
    ],
    path: "/",
  }),
  
  dashboard: generatePageMetadata({
    title: "Dashboard",
    description: "Manage your AEC workflows and projects",
    path: "/dashboard",
    noIndex: true, // Private page
  }),
  
  workflows: generatePageMetadata({
    title: "My Workflows",
    description: "View and manage your custom AEC workflows",
    path: "/dashboard/workflows",
    noIndex: true,
  }),
  
  templates: generatePageMetadata({
    title: "Workflow Templates",
    description:
      "Pre-built workflow templates for common AEC tasks. Start building in seconds.",
    keywords: ["AEC templates", "workflow templates", "BIM templates"],
    path: "/dashboard/templates",
  }),
  
  community: generatePageMetadata({
    title: "Community Workflows",
    description:
      "Discover and use workflows shared by the Workflow Builder community. Learn from other architects and engineers.",
    keywords: ["AEC community", "shared workflows", "architecture community"],
    path: "/dashboard/community",
  }),
  
  login: generatePageMetadata({
    title: "Sign In",
    description: "Sign in to your Workflow Builder account",
    path: "/login",
    noIndex: true,
  }),
  
  signup: generatePageMetadata({
    title: "Sign Up",
    description: "Create your free Workflow Builder account",
    path: "/signup",
    noIndex: true,
  }),
};

/**
 * Generate JSON-LD structured data for specific content types
 */
export function generateWorkflowSchema(workflow: {
  name: string;
  description: string;
  createdAt: string;
  author?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: workflow.name,
    description: workflow.description,
    datePublished: workflow.createdAt,
    author: workflow.author
      ? {
          "@type": "Person",
          name: workflow.author,
        }
      : undefined,
  };
}

export function generateBreadcrumbSchema(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${siteUrl}${item.url}`,
    })),
  };
}
