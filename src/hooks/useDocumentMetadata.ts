import { useEffect } from "react";

/**
 * Sets the document title and meta description for a route, restoring the
 * previous values on unmount.
 *
 * The site is a single static index.html with one title and one description, so
 * there was no per-route metadata before this. This uses plain DOM APIs and
 * introduces no dependency or metadata framework — it updates the tags the page
 * already ships with.
 *
 * Note this runs client-side, so it helps crawlers that execute JavaScript and
 * anyone reading the tab title. Prerendering would be required for crawlers that
 * do not run JS.
 */
export function useDocumentMetadata(title: string, description: string): void {
  useEffect(() => {
    const previousTitle = document.title;
    const tag = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = tag?.getAttribute("content") ?? null;

    document.title = title;
    tag?.setAttribute("content", description);

    return () => {
      document.title = previousTitle;
      if (previousDescription !== null) tag?.setAttribute("content", previousDescription);
    };
  }, [title, description]);
}
