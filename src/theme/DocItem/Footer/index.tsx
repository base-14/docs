import React, { type ReactNode } from "react";
import Footer from "@theme-original/DocItem/Footer";
import type FooterType from "@theme/DocItem/Footer";
import type { WrapperProps } from "@docusaurus/types";
import { useDoc } from "@docusaurus/plugin-content-docs/client";
import Feedback from "@site/src/components/Feedback";
import DocCTA from "@site/src/components/DocCTA";

type Props = WrapperProps<typeof FooterType>;

export default function FooterWrapper(props: Props): ReactNode {
  const { metadata } = useDoc();

  const pageId = metadata.permalink || metadata.id || "unknown";

  return (
    <>
      <Footer {...props} />
      <DocCTA />
      <Feedback resource={pageId} />
    </>
  );
}
