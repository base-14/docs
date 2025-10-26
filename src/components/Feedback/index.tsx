import React, { useState } from "react";
import styles from "./styles.module.css";

interface FeedbackProps {
  resource: string;
}

export default function Feedback({ resource }: FeedbackProps) {
  const [feedback, setFeedback] = useState<"yes" | "no" | null>(null);
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleFeedback = (helpful: "yes" | "no") => {
    setFeedback(helpful);

    if (typeof window !== "undefined" && window.gtag) {
      window.gtag("event", "page_feedback", {
        page_path: resource,
        helpful: helpful,
        event_category: "engagement",
        event_label: resource,
      });
    }

    if (helpful === "no") {
      setShowComment(true);
    } else {
      setSubmitted(true);
    }
  };

  const handleCommentSubmit = () => {
    if (comment.trim() && typeof window !== "undefined" && window.gtag) {
      window.gtag("event", "page_feedback_comment", {
        page_path: resource,
        comment: comment,
        event_category: "engagement",
        event_label: resource,
      });
    }
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className={styles.feedbackContainer}>
        <p className={styles.thankYou}>Thank you for your feedback!</p>
      </div>
    );
  }

  return (
    <div className={styles.feedbackContainer}>
      <div className={styles.feedbackQuestion}>Was this page helpful?</div>

      {!showComment ? (
        <div className={styles.feedbackButtons}>
          <button
            className={`${styles.feedbackButton} ${
              feedback === "yes" ? styles.selected : ""
            }`}
            onClick={() => handleFeedback("yes")}
            aria-label="Yes, this page was helpful"
          >
            Yes
          </button>
          <button
            className={`${styles.feedbackButton} ${
              feedback === "no" ? styles.selected : ""
            }`}
            onClick={() => handleFeedback("no")}
            aria-label="No, this page was not helpful"
          >
            No
          </button>
        </div>
      ) : (
        <div className={styles.commentSection}>
          <textarea
            className={styles.commentInput}
            placeholder="What can we improve? (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
          />
          <button className={styles.submitButton} onClick={handleCommentSubmit}>
            Submit
          </button>
        </div>
      )}
    </div>
  );
}
