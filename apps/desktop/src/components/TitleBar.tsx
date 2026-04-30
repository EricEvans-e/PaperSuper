import { FolderOpen, Sparkles } from "lucide-react";
import type { PaperDocument } from "../types";

interface TitleBarProps {
  paper: PaperDocument;
  onOpenPdf: () => void;
  openError: string | null;
}

export function TitleBar({ paper, onOpenPdf, openError }: TitleBarProps) {
  return (
    <header className="titleBar">
      <div className="brandCluster">
        <div className="brandLogo">
          <Sparkles size={18} />
        </div>
        <div>
          <div className="brandName">PaperSuper</div>
          <div className="brandSubline">AI Research IDE</div>
        </div>
      </div>

      <div className="documentChip" title={paper.title}>
        <span className={`sourceDot ${paper.sourceType}`} />
        <span className="documentTitle">{paper.title}</span>
      </div>

      <div className="topActions">
        {openError ? <span className="topError">{openError}</span> : null}
        <button type="button" className="primaryButton" onClick={onOpenPdf}>
          <FolderOpen size={17} />
          <span>打开 PDF</span>
        </button>
      </div>
    </header>
  );
}
