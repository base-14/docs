import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: "base14 docs",
  tagline: "Reduce downtime drastically!",
  favicon: "img/favicon.ico",

  // Set the production url of your site here
  url: "https://docs.base14.io",
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: "/",

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: "base-14", // Usually your GitHub org/user name.
  projectName: "docs.base14.io", // Usually your repo name.

  onBrokenLinks: "throw",

  headTags: [
    {
      tagName: "link",
      attributes: {
        rel: "icon",
        type: "image/svg+xml",
        href: "/img/favicon.svg",
      },
    },
    {
      tagName: "link",
      attributes: {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/img/favicon-32x32.png",
      },
    },
    {
      tagName: "link",
      attributes: {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: "/img/favicon-16x16.png",
      },
    },
    {
      tagName: "link",
      attributes: {
        rel: "apple-touch-icon",
        href: "/img/apple-touch-icon.png",
      },
    },
  ],

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "@docusaurus/preset-classic",
      {
        docs: {
          routeBasePath: "/", // Serve the docs at the site's root
          sidebarPath: "./sidebars.ts",
        },
        blog: {
          routeBasePath: "blog",
          showReadingTime: true,
          feedOptions: {
            type: ["rss", "atom"],
            xslt: true,
          },
          blogTitle: "base14 Blog",
          blogDescription:
            "Engineering insights, product updates, and best practices from base14",
          blogSidebarCount: 10,
          blogSidebarTitle: "Recent posts",
          postsPerPage: 10,
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
        gtag: process.env.GOOGLE_ANALYTICS_ID
          ? {
              trackingID: process.env.GOOGLE_ANALYTICS_ID,
              anonymizeIP: true,
            }
          : undefined,
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: "img/base14-social-card.jpg",
    announcementBar: {
      id: "announcement-bar",
      content:
        '🚀 Welcome to base14 Scout documentation! Check out the latest articles on our <a href="https://docs.base14.io/blog" target="_blank" rel="noopener noreferrer" style="color: #FFFFFF; text-decoration: underline;">Blog</a>.',
      backgroundColor: "#047857",
      textColor: "#FFFFFF",
      isCloseable: true,
    },
    colorMode: {
      defaultMode: "light",
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    docs: {
      sidebar: {
        hideable: true,
        autoCollapseCategories: true,
      },
    },
    navbar: {
      title: "base14",
      logo: {
        alt: "Reduce downtime drastically with base14 Scout",
        src: "img/logo.svg",
        srcDark: "img/logo-dark.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "tutorialSidebar",
          position: "left",
          label: "Scout",
        },
        {
          to: "/blog",
          label: "Blog",
          position: "left",
        },
        {
          href: "https://base14.io",
          label: "Home",
          position: "right",
        },
        {
          href: "https://github.com/base-14/docs",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "light",
      links: [
        {
          title: "Docs",
          items: [
            {
              label: "Tutorial",
              to: "/",
            },
          ],
        },
        {
          title: "Legal",
          items: [
            {
              label: "Terms of use",
              href: "https://base14.io/terms-of-service",
            },
            {
              label: "Privacy",
              href: "https://base14.io/privacy",
            },
          ],
        },
        {
          title: "Social",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/base-14",
            },
            {
              label: "X",
              href: "https://twitter.com/base14io",
            },
            {
              label: "LinkedIn",
              href: "https://www.linkedin.com/company/base14-io",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} base14. Built with Docusaurus.`,
    },
    prism: {
      additionalLanguages: ["ruby", "bash"],
      theme: prismThemes.oneLight,
      darkTheme: prismThemes.oneDark,
    },
    // Only enable Algolia if ENABLE_ALGOLIA_CRAWLER is set to 'true'
    ...(process.env.ENABLE_ALGOLIA_CRAWLER === "true" &&
    process.env.ALGOLIA_APP_ID &&
    process.env.ALGOLIA_SEARCH_API_KEY &&
    process.env.ALGOLIA_DOCSEARCH_INDEX_NAME
      ? {
          algolia: {
            appId: process.env.ALGOLIA_APP_ID,
            apiKey: process.env.ALGOLIA_SEARCH_API_KEY,
            indexName: process.env.ALGOLIA_DOCSEARCH_INDEX_NAME,
            contextualSearch: true,
          },
        }
      : {}),
  } satisfies Preset.ThemeConfig,
};
export default config;
