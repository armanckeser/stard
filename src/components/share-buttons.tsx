import { Share2 } from "lucide-react";

// One tap from a result to a post: X's post box filled in, and on a phone the share sheet.

/** The address that opens X's post box with `text` and `url` filled in. */
export const xPostLink = (text: string, url: string): string => `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;

// A desktop browser may have navigator.share too, but there the copy button beside it does the job.
const hasShareSheet = (): boolean => typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches;

export function PostOnX({ text, url, className }: { text: string; url: string; className: string }) {
  return (
    <a href={xPostLink(text, url)} target="_blank" rel="noopener noreferrer" className={className}>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-3.5 fill-current">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
      Post on X
    </a>
  );
}

/** The phone's share sheet with `text` and `url`; nothing on a device without one. */
export function ShareSheet({ text, url, className }: { text: string; url: string; className: string }) {
  if (!hasShareSheet()) return null;
  // Closing the sheet without sharing rejects; nothing needs saying then.
  return (
    <button type="button" className={className} onClick={() => void navigator.share({ text, url }).catch(() => {})}>
      <Share2 className="size-3.5" /> Share
    </button>
  );
}
