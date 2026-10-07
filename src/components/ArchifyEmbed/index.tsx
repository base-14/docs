import React from "react";
import BrowserOnly from "@docusaurus/BrowserOnly";
import { useColorMode } from "@docusaurus/theme-common";
import styles from "./styles.module.css";

/**
 * Embeds a self-contained Archify diagram page from `static/` so it reads as
 * part of the doc rather than a box inside it.
 *
 * An Archify export is a whole HTML page with its own scripts and styles, so
 * it cannot be inlined into MDX without its CSS leaking into the site. An
 * iframe keeps it isolated, but a plain one has a fixed height (an inner
 * scrollbar under the page's own) and its own theme (a dark diagram on a
 * light page). The file is served from the same origin, so both are fixed
 * from here: the frame is sized to its document, and the site's color mode
 * is written to the `html[data-theme]` attribute the diagram themes from.
 */
interface Props {
  /** Path under `static/`, e.g. `/diagrams/collector-topology/k8s.html`. */
  src: string;
  /** Names the frame for screen readers. */
  title: string;
}

/**
 * The first opaque background at or above `el`, i.e. what shows through it.
 * Translucent layers (the site's glass panels) are skipped rather than
 * blended; they are faint enough that the opaque color is what reads.
 */
function backgroundBehind(el: Element): string {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    const alpha = /^rgba\(.*,\s*([\d.]+)\)$/.exec(color)?.[1];
    if (color && color !== "transparent" && (alpha === undefined || Number(alpha) === 1)) {
      return color;
    }
  }
  return getComputedStyle(document.documentElement).backgroundColor;
}

function Frame({ src, title }: Props) {
  const { colorMode } = useColorMode();
  const ref = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState<number>();
  // Read inside the load handler, which closes over the first render's value.
  const mode = React.useRef(colorMode);
  mode.current = colorMode;

  const applyTheme = React.useCallback(() => {
    const frame = ref.current;
    const root = frame?.contentDocument?.documentElement;
    if (!frame || !root) {
      return;
    }
    root.dataset.theme = mode.current;
    // Archify's palettes are its own (warm paper, near-black ink), so the
    // diagram would sit on the page as a differently colored slab. Painting
    // its page, panels and label masks with whatever the site shows behind
    // the frame makes it blend in, and follows custom.css without copying it.
    const background = backgroundBehind(frame);
    for (const name of ["--bg", "--panel", "--mask"]) {
      root.style.setProperty(name, background);
    }
  }, []);

  React.useEffect(() => {
    // Docusaurus writes the new theme to `<html>` in its own effect, which runs
    // after this one (parents' effects run after their children's), so the
    // site's new background is only readable a frame later.
    const id = requestAnimationFrame(applyTheme);
    return () => cancelAnimationFrame(id);
  }, [colorMode, applyTheme]);

  // Owned by the effect so the observer is dropped on unmount; `onLoad` only
  // bumps this to (re)attach it to whichever document is now in the frame.
  const [loads, setLoads] = React.useState(0);

  React.useEffect(() => {
    const doc = ref.current?.contentDocument;
    const win = ref.current?.contentWindow;
    if (!loads || !doc?.body || !win) {
      return undefined;
    }
    // The frame is sized to fit, so its own scrollbars only ever show up for a
    // sub-pixel remainder, and then steal width and reflow the diagram.
    doc.documentElement.style.overflow = "hidden";
    doc.body.style.overflow = "hidden";
    // Not `scrollHeight`: Archify gives its body `min-height: 100vh`, so the
    // document is never shorter than the frame and the frame could only grow.
    // The bottom of the in-flow content is the real height.
    const measure = () => {
      const body = doc.body;
      let bottom = 0;
      for (const child of Array.from(body.children)) {
        const position = win.getComputedStyle(child).position;
        if (position !== "fixed" && position !== "absolute") {
          bottom = Math.max(bottom, child.getBoundingClientRect().bottom);
        }
      }
      const padding = parseFloat(win.getComputedStyle(body).paddingBottom) || 0;
      setHeight(Math.ceil(bottom + win.scrollY + padding));
    };
    measure();
    // The frame's own constructor, so the observer lives in the realm of the
    // elements it watches. The body alone is not enough: held at 100vh, it
    // does not resize when the content inside it does.
    const observer = new (win as typeof window).ResizeObserver(measure);
    observer.observe(doc.body);
    for (const child of Array.from(doc.body.children)) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  }, [loads]);

  return (
    <>
      <iframe
        ref={ref}
        className={styles.frame}
        src={src}
        title={title}
        loading="lazy"
        style={height ? { height } : undefined}
        onLoad={() => {
          applyTheme();
          setLoads((n) => n + 1);
        }}
      />
      <a className={styles.open} href={src} target="_blank" rel="noopener">
        Open diagram in a new tab
      </a>
    </>
  );
}

export default function ArchifyEmbed(props: Props): React.JSX.Element {
  // The frame's document only exists in the browser, and so does the color
  // mode it has to be told about.
  return (
    <BrowserOnly fallback={<div className={styles.placeholder} />}>
      {() => <Frame {...props} />}
    </BrowserOnly>
  );
}
