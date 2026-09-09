import React from "react";
import styles from "./styles.module.css";

export default function DocCTA() {
  return (
    <aside className={styles.cta} aria-label="base14 Scout">
      <p className={styles.text}>
        Send this telemetry to <strong>base14 Scout</strong>, an
        OpenTelemetry-native observability platform with signal-based pricing.
      </p>
      <div className={styles.actions}>
        <a
          className={styles.primary}
          href="https://base14.io/contact"
          target="_blank"
          rel="noopener"
        >
          Book a 15-minute demo
        </a>
        <a
          className={styles.secondary}
          href="https://base14.io/pricing"
          target="_blank"
          rel="noopener"
        >
          See pricing
        </a>
      </div>
    </aside>
  );
}
