import type { UiBlock } from "@klymbak/protocol";
import { toneClass } from "@klymbak/client";
import { useRenderers } from "../../context";
import { cx } from "../../util";
import { MarkdownContent } from "../MarkdownContent";
import { KlIcon } from "../KlIcon";
import { ActionBar } from "./ActionBar";
import { ChartView } from "./ChartView";
import { DataTable } from "./DataTable";
import { KeyValueList } from "./KeyValueList";
import { MediaGallery } from "./MediaGallery";
import { SourceList } from "./SourceList";
import { StatGrid } from "./StatGrid";

export function UiBlockView({ block }: { block: UiBlock }) {
  const renderers = useRenderers();
  switch (block.type) {
    case "table":
      return <DataTable block={block} />;
    case "stats":
      return <StatGrid block={block} />;
    case "chart":
      return <ChartView block={block} />;
    case "keyvalue":
      return <KeyValueList block={block} />;
    case "media":
      return <MediaGallery block={block} />;
    case "sources":
      return <SourceList block={block} />;
    case "actions":
      return <ActionBar block={block} />;
    case "markdown":
      return (
        <div className="kl-block-md">
          <MarkdownContent source={block.text} />
        </div>
      );
    case "alert":
      return (
        <div className={cx("kl-alert", toneClass(block.tone))} role="status">
          <KlIcon name={block.tone === "success" ? "check" : block.tone === "danger" || block.tone === "warning" ? "alert" : "info"} size={16} />
          <div>
            {block.title && <strong>{block.title}</strong>}
            <p>{block.text}</p>
          </div>
        </div>
      );
  }
  const Custom = block.type === "custom" ? renderers.blocks?.[block.component] : undefined;
  if (Custom && block.type === "custom") return <Custom {...block.props} />;
  return <pre className="kl-block-raw">{JSON.stringify(block, null, 2)}</pre>;
}
