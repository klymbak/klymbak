import { useMemo } from "react";
import { renderMarkdown } from "@klymbak/client";
import { cx } from "../util";

export function MarkdownContent({ source, streaming }: { source: string; streaming?: boolean }) {
  // markdown-it runs with html disabled, so model output cannot inject markup.
  const html = useMemo(() => renderMarkdown(source), [source]);
  return <div className={cx("kl-md", streaming && "kl-md--streaming")} dangerouslySetInnerHTML={{ __html: html }} />;
}
