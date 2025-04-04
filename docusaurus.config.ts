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
  onBrokenMarkdownLinks: "warn",

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
        blog: false,
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
    colorMode: {
      defaultMode: "light",
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
      theme: prismThemes.oneLight,
      darkTheme: prismThemes.oneDark,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
