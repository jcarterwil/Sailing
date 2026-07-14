import {
  buildReviewPreview,
  type ReviewPreviewRequest,
} from "@/components/replay/review-preview";

self.onmessage = (event: MessageEvent<ReviewPreviewRequest>) => {
  self.postMessage(buildReviewPreview(event.data));
};
