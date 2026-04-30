import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityBar } from "./components/ActivityBar";
import { AiChatPanel } from "./components/AiChatPanel";
import { PdfReaderPane } from "./components/PdfReaderPane";
import { TitleBar } from "./components/TitleBar";
import { Workbench } from "./components/Workbench";
import type { IHighlight } from "./pdf-highlighter";
import type {
  ActivityId,
  AiContextItem,
  AiMessage,
  ModelConfig,
  PaperDocument,
} from "./types";
import { makeId } from "./utils";

const SAMPLE_PDF_URL = "https://arxiv.org/pdf/1708.08021";
const STORAGE_MODEL_CONFIG = "papersuper:model-config";

const defaultModelConfig: ModelConfig = {
  provider: "openai-chat",
  apiBase: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  maxTokens: 1200,
};

const readStoredModelConfig = (): ModelConfig => {
  try {
    const raw = localStorage.getItem(STORAGE_MODEL_CONFIG);
    const stored = raw ? { ...defaultModelConfig, ...JSON.parse(raw) } : defaultModelConfig;
    const provider =
      stored.provider === "openai-responses" || stored.provider === "anthropic"
        ? stored.provider
        : "openai-chat";

    return {
      ...stored,
      provider,
      maxTokens: Number(stored.maxTokens) || defaultModelConfig.maxTokens,
    };
  } catch {
    return defaultModelConfig;
  }
};

const createSamplePaper = (): PaperDocument => ({
  id: "sample-attention",
  title: "Attention Is All You Need",
  sourceType: "sample",
  url: SAMPLE_PDF_URL,
  openedAt: new Date().toISOString(),
});

export function App() {
  const [activity, setActivity] = useState<ActivityId>("ai");
  const [paper, setPaper] = useState<PaperDocument>(() => createSamplePaper());
  const [pdfUrl, setPdfUrl] = useState(SAMPLE_PDF_URL);
  const [highlights, setHighlights] = useState<IHighlight[]>([]);
  const [contextItems, setContextItems] = useState<AiContextItem[]>([]);
  const [messages, setMessages] = useState<AiMessage[]>(() => [
    {
      id: makeId(),
      role: "assistant",
      content: "PaperSuper is ready. Select PDF text to attach context, then ask in the chat panel.",
      createdAt: new Date().toISOString(),
      isLocal: true,
    },
  ]);
  const [modelConfig, setModelConfig] = useState<ModelConfig>(() =>
    readStoredModelConfig(),
  );
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [openError, setOpenError] = useState<string | null>(null);

  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_MODEL_CONFIG, JSON.stringify(modelConfig));
  }, [modelConfig]);

  useEffect(
    () => () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    },
    [],
  );

  const openPdfFile = async () => {
    setOpenError(null);

    try {
      const result = await window.paperSuper?.openPdfFile();
      if (!result) {
        return;
      }

      const blobUrl = URL.createObjectURL(
        new Blob([result.data], { type: "application/pdf" }),
      );

      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }

      objectUrlRef.current = blobUrl;
      setPdfUrl(blobUrl);
      setPaper({
        id: makeId(),
        title: result.fileName.replace(/\.pdf$/i, ""),
        sourceType: "file",
        fileName: result.fileName,
        url: blobUrl,
        openedAt: new Date().toISOString(),
      });
      setHighlights([]);
      setContextItems([]);
      setActivity("ai");
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "打开失败");
    }
  };

  const addContextItem = ({
    text,
    image,
    highlightId,
    pageNumber,
  }: Pick<AiContextItem, "text" | "image" | "highlightId" | "pageNumber">) => {
    setContextItems((items) => [
      {
        id: makeId(),
        text,
        image,
        highlightId,
        pageNumber,
        createdAt: new Date().toISOString(),
      },
      ...items,
    ]);
    setActivity("ai");
  };

  const removeContextHighlight = (highlightId: string) => {
    setContextItems((items) =>
      items.filter((item) => item.highlightId !== highlightId),
    );
    setHighlights((items) =>
      items.filter((highlight) => highlight.id !== highlightId),
    );
  };

  const clearContextHighlights = () => {
    const contextHighlightIds = new Set(
      contextItems
        .map((item) => item.highlightId)
        .filter((id): id is string => Boolean(id)),
    );
    const aiContextHighlightIds = new Set(
      highlights
        .filter((highlight) => highlight.comment.text === "AI Context")
        .map((highlight) => highlight.id),
    );

    if (contextHighlightIds.size === 0 && aiContextHighlightIds.size === 0) {
      return;
    }

    setContextItems([]);
    setHighlights((items) =>
      items.filter(
        (highlight) =>
          !contextHighlightIds.has(highlight.id) &&
          !aiContextHighlightIds.has(highlight.id),
      ),
    );
  };

  const workspaceStyle = useMemo(
    () => ({
      gridTemplateColumns: isChatOpen
        ? "minmax(300px, 340px) minmax(0, 1fr) minmax(280px, 360px)"
        : "minmax(0, 1fr) minmax(280px, 360px)",
    }),
    [isChatOpen],
  );

  return (
    <div className="appShell">
      <ActivityBar
        activeActivity={activity}
        isChatOpen={isChatOpen}
        onChange={setActivity}
        onToggleChat={() => setIsChatOpen((open) => !open)}
      />
      <div className="appMain">
        <TitleBar paper={paper} onOpenPdf={openPdfFile} openError={openError} />
        <main className="workspace threeZoneWorkspace" style={workspaceStyle}>
          {isChatOpen ? (
            <AiChatPanel
              paper={paper}
              contextItems={contextItems}
              messages={messages}
              modelConfig={modelConfig}
              onMessagesChange={setMessages}
            />
          ) : null}
          <PdfReaderPane
            paper={paper}
            pdfUrl={pdfUrl}
            highlights={highlights}
            onHighlightsChange={setHighlights}
            onAddContext={addContextItem}
            onRemoveContextHighlight={removeContextHighlight}
            onClearContextHighlights={clearContextHighlights}
          />
          <Workbench
            activity={activity}
            paper={paper}
            highlights={highlights}
            modelConfig={modelConfig}
            onModelConfigChange={setModelConfig}
            onOpenPdf={openPdfFile}
          />
        </main>
      </div>
    </div>
  );
}
