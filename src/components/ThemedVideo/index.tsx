import React from "react";
import BrowserOnly from "@docusaurus/BrowserOnly";
import { useColorMode } from "@docusaurus/theme-common";
import styles from "./styles.module.css";

/**
 * The video counterpart to `@theme/ThemedImage`, which has none.
 *
 * A screen recording carries its own background, so a dark clip on a light
 * page is a black rectangle in the middle of the text - the same problem
 * `ThemedImage` exists to solve for stills, and the reason every k8X
 * screenshot in these docs is captured twice.
 */
interface Sources {
  light: string;
  dark: string;
}

interface Props {
  sources: Sources;
  posters?: Sources;
  /** Described for screen readers, and shown if the browser refuses the file. */
  label: string;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function Player({ sources, posters, label }: Props) {
  const { colorMode } = useColorMode();
  const dark = colorMode === "dark";
  // A silent looping clip is decoration until someone asks for it, so honor
  // the reduced-motion setting: poster frame plus controls, nothing moving.
  const [autoPlay] = React.useState(() => !prefersReducedMotion());
  // Carried across the remount below. The two clips are the same tour filmed
  // twice, frame for frame, so a reader who toggles the theme mid-play should
  // land where they left off rather than back at the first tab.
  const at = React.useRef({ time: 0, paused: !autoPlay });

  return (
    <video
      // Remount on theme change. Swapping `src` on a playing element holds the
      // last decoded frame until the new file buffers, so the dark clip's final
      // frame sits on the light page for as long as the load takes.
      key={colorMode}
      className={styles.video}
      src={dark ? sources.dark : sources.light}
      poster={dark ? posters?.dark : posters?.light}
      aria-label={label}
      autoPlay={autoPlay}
      loop
      muted
      playsInline
      controls
      // `metadata` is the honest value only when nothing autoplays; a browser
      // asked to autoplay fetches the file whatever this says.
      preload={autoPlay ? "auto" : "metadata"}
      onTimeUpdate={(e) => {
        at.current.time = e.currentTarget.currentTime;
      }}
      onPlay={() => {
        at.current.paused = false;
      }}
      onPause={() => {
        at.current.paused = true;
      }}
      onLoadedMetadata={(e) => {
        const v = e.currentTarget;
        v.currentTime = at.current.time;
        if (at.current.paused) {
          v.pause();
        }
      }}
    >
      {label}
    </video>
  );
}

export default function ThemedVideo(props: Props): React.JSX.Element {
  // `useColorMode` is client-only, and rendering the light clip on the server
  // would hand a dark reader a flash of the wrong one on hydration.
  return (
    <BrowserOnly fallback={<div className={styles.placeholder} />}>
      {() => <Player {...props} />}
    </BrowserOnly>
  );
}
