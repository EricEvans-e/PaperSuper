import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  PaperTextPage,
} from "./types";
import { makeId } from "./utils";

// ===== 顶层配置常量 =====
// 这一段定义应用启动时会用到的默认值和布局边界。
const SAMPLE_PDF_URL = "https://arxiv.org/pdf/1708.08021";
const STORAGE_MODEL_CONFIG = "papersuper:model-config";
const STORAGE_WORKSPACE_LAYOUT = "papersuper:workspace-layout";

const DEFAULT_CHAT_WIDTH = 340;
const DEFAULT_RIGHT_WIDTH = 340;
const MIN_CHAT_WIDTH = 180;
const CHAT_AUTO_COLLAPSE_WIDTH = 120;
const CHAT_REOPEN_WIDTH = MIN_CHAT_WIDTH;
const MAX_CHAT_WIDTH = 820;
const MIN_PDF_WIDTH = 320;
const MIN_RIGHT_WIDTH = 220;
const MAX_RIGHT_WIDTH = 820;
const SPLIT_HANDLE_WIDTH = 6;

// ===== 结构化本地存储数据 =====
// workspace 布局会整体持久化到 localStorage，所以先定义一份清晰的结构。
interface WorkspaceLayout {
  isChatOpen: boolean;
  chatWidth: number;
  rightWidth: number;
}

// ===== 默认模型配置 =====
// 首次打开应用、或 localStorage 里没有可用配置时，使用这份默认值。
const defaultModelConfig: ModelConfig = {
  provider: "openai-chat",
  apiBase: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  maxTokens: 8400,
};

// ===== 初始化辅助函数 =====
// 这些函数在真正进入组件之前，负责把“默认值 / 本地存储 / 示例数据”整理成可用状态。
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

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

const readStoredWorkspaceLayout = (): WorkspaceLayout => {
  try {
    const raw = localStorage.getItem(STORAGE_WORKSPACE_LAYOUT);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      isChatOpen:
        typeof parsed.isChatOpen === "boolean" ? parsed.isChatOpen : true,
      chatWidth: clamp(
        Number(parsed.chatWidth) || DEFAULT_CHAT_WIDTH,
        MIN_CHAT_WIDTH,
        MAX_CHAT_WIDTH,
      ),
      rightWidth: clamp(
        Number(parsed.rightWidth) || DEFAULT_RIGHT_WIDTH,
        MIN_RIGHT_WIDTH,
        MAX_RIGHT_WIDTH,
      ),
    };
  } catch {
    return {
      isChatOpen: true,
      chatWidth: DEFAULT_CHAT_WIDTH,
      rightWidth: DEFAULT_RIGHT_WIDTH,
    };
  }
};

// ===== App 组件主体 =====
// 这一部分开始进入 React 组件：状态、effect、事件处理和最终渲染都在这里。
export function App() {
  // ===== 状态初始化 =====
  // 这里集中声明整个 renderer 顶层最核心的状态。
  const storedLayout = useMemo(() => readStoredWorkspaceLayout(), []);
  const [activity, setActivity] = useState<ActivityId>("ai");
  const [paper, setPaper] = useState<PaperDocument>(() => createSamplePaper());
  const [pdfUrl, setPdfUrl] = useState(SAMPLE_PDF_URL);
  const [highlights, setHighlights] = useState<IHighlight[]>([]);
  const [contextItems, setContextItems] = useState<AiContextItem[]>([]);
  // 这里保存“整篇论文按页提取后的文本”。
  // 后面翻译、AI Workbench、VisualLab 生成时，不只看当前选区，也会从这里裁剪一段论文级上下文送给 AI。
  const [paperTextPages, setPaperTextPages] = useState<PaperTextPage[]>([]);
  const [messages, setMessages] = useState<AiMessage[]>(() => [
    {
      id: makeId(),
      role: "assistant",
      content: "PaperSuper is ready. Click, select, or Alt-drag PDF text to attach context, then ask in the chat panel.",
      createdAt: new Date().toISOString(),
      isLocal: true,
    },
  ]);
  const [modelConfig, setModelConfig] = useState<ModelConfig>(() =>
    readStoredModelConfig(),
  );
  const [isChatOpen, setIsChatOpen] = useState<boolean>(storedLayout.isChatOpen);
  const [chatWidth, setChatWidth] = useState<number>(storedLayout.chatWidth);
  const [rightWidth, setRightWidth] = useState<number>(storedLayout.rightWidth);
  const [openError, setOpenError] = useState<string | null>(null);

  const workspaceRef = useRef<HTMLElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  // ===== 副作用：持久化与全局监听 =====
  // 这一组 useEffect 负责把状态同步到 localStorage，并注册/清理全局事件。
  useEffect(() => {
    localStorage.setItem(STORAGE_MODEL_CONFIG, JSON.stringify(modelConfig));
  }, [modelConfig]);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_WORKSPACE_LAYOUT,
      JSON.stringify({ isChatOpen, chatWidth, rightWidth }),
    );
  }, [chatWidth, isChatOpen, rightWidth]);

  useEffect(
    () => () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const handleZoomShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      const code = event.code;
      const isZoomIn =
        key === "+" ||
        key === "=" ||
        key === "plus" ||
        code === "Equal" ||
        code === "NumpadAdd";
      const isZoomOut =
        key === "-" || code === "Minus" || code === "NumpadSubtract";
      const isZoomReset = key === "0" || code === "Digit0" || code === "Numpad0";

      if (!isZoomIn && !isZoomOut && !isZoomReset) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (isZoomIn) {
        void window.paperSuper?.adjustUiZoom("in");
        return;
      }

      if (isZoomOut) {
        void window.paperSuper?.adjustUiZoom("out");
        return;
      }

      void window.paperSuper?.adjustUiZoom("reset");
    };

    window.addEventListener("keydown", handleZoomShortcut, true);
    return () => {
      window.removeEventListener("keydown", handleZoomShortcut, true);
    };
  }, []);

  // ===== 事件处理与状态变更函数 =====
  // 这一组函数是 App 的“动作层”：打开 PDF、增删上下文、清空高亮、拖拽布局等。
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
    highlightId,
    pageNumber,
  }: Pick<AiContextItem, "text" | "highlightId" | "pageNumber">) => {
    setContextItems((items) => [
      {
        id: makeId(),
        text,
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

  const handlePaperTextReady = useCallback((pages: PaperTextPage[]) => {
    setPaperTextPages(pages);
  }, []);

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

  const handleLeftResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = workspaceRef.current;
    if (!container) {
      return;
    }

    const startX = event.clientX;
    const startWidth = chatWidth;
    const containerWidth = container.getBoundingClientRect().width;
    const maxWidth =
      containerWidth - rightWidth - MIN_PDF_WIDTH - SPLIT_HANDLE_WIDTH * 2;
    let isCollapsedDuringDrag = false;

    const move = (pointerEvent: PointerEvent) => {
      const nextWidth = startWidth + pointerEvent.clientX - startX;
      if (nextWidth <= CHAT_AUTO_COLLAPSE_WIDTH) {
        isCollapsedDuringDrag = true;
        setChatWidth(MIN_CHAT_WIDTH);
        setIsChatOpen(false);
        return;
      }

      if (isCollapsedDuringDrag && nextWidth < CHAT_REOPEN_WIDTH) {
        return;
      }

      isCollapsedDuringDrag = false;
      setIsChatOpen(true);
      setChatWidth(clamp(nextWidth, MIN_CHAT_WIDTH, Math.min(MAX_CHAT_WIDTH, maxWidth)));
    };

    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.classList.remove("isResizingColumns");
    };

    document.body.classList.add("isResizingColumns");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const handleRightResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = workspaceRef.current;
    if (!container) {
      return;
    }

    const startX = event.clientX;
    const startWidth = rightWidth;
    const containerWidth = container.getBoundingClientRect().width;
    const leftBlockWidth = isChatOpen ? chatWidth + SPLIT_HANDLE_WIDTH : 0;
    const maxWidth =
      containerWidth - leftBlockWidth - MIN_PDF_WIDTH - SPLIT_HANDLE_WIDTH;

    const move = (pointerEvent: PointerEvent) => {
      const nextWidth = startWidth - (pointerEvent.clientX - startX);
      setRightWidth(clamp(nextWidth, MIN_RIGHT_WIDTH, Math.min(MAX_RIGHT_WIDTH, maxWidth)));
    };

    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.classList.remove("isResizingColumns");
    };

    document.body.classList.add("isResizingColumns");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const workspaceStyle = useMemo(
    () => ({
      gridTemplateColumns: isChatOpen
        ? `${chatWidth}px ${SPLIT_HANDLE_WIDTH}px minmax(${MIN_PDF_WIDTH}px, 1fr) ${SPLIT_HANDLE_WIDTH}px ${rightWidth}px`
        : `minmax(${MIN_PDF_WIDTH}px, 1fr) ${SPLIT_HANDLE_WIDTH}px ${rightWidth}px`,
    }),
    [chatWidth, isChatOpen, rightWidth],
  );

  // ===== 渲染结构 =====
  // App 本身不做复杂展示细节，它主要负责把状态和回调分发给各个子组件。
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
        <main
          className="workspace threeZoneWorkspace"
          style={workspaceStyle}
          ref={workspaceRef}
        >
          {isChatOpen ? (
            <AiChatPanel
              paper={paper}
              contextItems={contextItems}
              messages={messages}
              modelConfig={modelConfig}
              onMessagesChange={setMessages}
            />
          ) : null}
          {isChatOpen ? (
            <div
              className="workspaceSplitHandle"
              role="separator"
              aria-label="Resize AI chat and PDF panes"
              aria-orientation="vertical"
              onPointerDown={handleLeftResizeStart}
            />
          ) : null}
          <PdfReaderPane
            paper={paper}
            pdfUrl={pdfUrl}
            contextItems={contextItems}
            highlights={highlights}
            modelConfig={modelConfig}
            onHighlightsChange={setHighlights}
            onAddContext={addContextItem}
            onPaperTextReady={handlePaperTextReady}
            onRemoveContextHighlight={removeContextHighlight}
            onClearContextHighlights={clearContextHighlights}
          />
          <div
            className="workspaceSplitHandle"
            role="separator"
            aria-label="Resize PDF and right workbench panes"
            aria-orientation="vertical"
            onPointerDown={handleRightResizeStart}
          />
          <Workbench
            activity={activity}
            contextItems={contextItems}
            paper={paper}
            paperTextPages={paperTextPages}
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
