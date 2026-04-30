import {
  Bot,
  ChevronRight,
  FileText,
  KeyRound,
  Sparkle,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useRef, useState } from "react";
import type { IHighlight } from "../pdf-highlighter";
import type {
  ActivityId,
  AiContextItem,
  AiMessage,
  AiProvider,
  ModelConfig,
  PaperDocument,
} from "../types";
import { formatTime } from "../utils";
import { AiChatPanel } from "./AiChatPanel";

interface WorkbenchProps {
  activity: ActivityId;
  paper: PaperDocument;
  highlights: IHighlight[];
  contextItems: AiContextItem[];
  messages: AiMessage[];
  modelConfig: ModelConfig;
  onMessagesChange: Dispatch<SetStateAction<AiMessage[]>>;
  onModelConfigChange: (config: ModelConfig) => void;
  onOpenPdf: () => void;
}

const jumpToHighlight = (highlight: IHighlight) => {
  document.location.hash = `highlight-${highlight.id}`;
};

export function Workbench({
  activity,
  paper,
  highlights,
  contextItems,
  messages,
  modelConfig,
  onMessagesChange,
  onModelConfigChange,
  onOpenPdf,
}: WorkbenchProps) {
  const [chatHeight, setChatHeight] = useState(320);
  const dockRef = useRef<HTMLElement>(null);

  const handleChatResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = chatHeight;

    const move = (pointerEvent: PointerEvent) => {
      const dockHeight = dockRef.current?.getBoundingClientRect().height ?? 720;
      const maxHeight = Math.max(260, dockHeight - 190);
      const nextHeight = startHeight - (pointerEvent.clientY - startY);
      setChatHeight(Math.min(maxHeight, Math.max(240, nextHeight)));
    };

    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.classList.remove("isResizingChat");
    };

    document.body.classList.add("isResizingChat");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const renderActivePanel = () => {
    if (activity === "paper") {
      return (
        <PaperPanel
          paper={paper}
          highlights={highlights}
          onOpenPdf={onOpenPdf}
        />
      );
    }

    if (activity === "settings") {
      return (
        <SettingsPanel
          modelConfig={modelConfig}
          onModelConfigChange={onModelConfigChange}
        />
      );
    }

    return (
      <AiPanel
        paper={paper}
        modelConfig={modelConfig}
      />
    );
  };

  return (
    <aside
      className="workbenchDock"
      ref={dockRef}
      style={{
        gridTemplateRows: `minmax(0, 1fr) 8px ${chatHeight}px`,
      }}
    >
      <div className="workbenchTopSlot">{renderActivePanel()}</div>
      <div
        className="workbenchChatResizeHandle"
        role="separator"
        aria-orientation="horizontal"
        onPointerDown={handleChatResizeStart}
      />
      <AiChatPanel
        paper={paper}
        contextItems={contextItems}
        messages={messages}
        modelConfig={modelConfig}
        onMessagesChange={onMessagesChange}
      />
    </aside>
  );
}

function PaperPanel({
  paper,
  highlights,
  onOpenPdf,
}: Pick<WorkbenchProps, "paper" | "highlights" | "onOpenPdf">) {
  return (
    <aside className="workbenchPanel">
      <PanelHeader eyebrow="Paper" title="Paper" icon={FileText} />
      <div className="card paperCard">
        <div className="paperTitle">{paper.title}</div>
        <div className="metaGrid">
          <span>Source</span>
          <strong>{paper.sourceType === "file" ? "Local PDF" : "Sample PDF"}</strong>
          <span>Opened</span>
          <strong>{formatTime(paper.openedAt)}</strong>
          <span>Highlights</span>
          <strong>{highlights.length}</strong>
        </div>
        <button type="button" className="primaryButton wide" onClick={onOpenPdf}>
          <FileText size={16} />
          <span>Open PDF</span>
        </button>
      </div>

      <AnnotationList highlights={highlights} />
    </aside>
  );
}

function AiPanel({
  paper,
  modelConfig,
}: Pick<
  WorkbenchProps,
  "paper" | "modelConfig"
>) {
  return (
    <aside className="workbenchPanel">
      <PanelHeader
        eyebrow="AI Cockpit"
        title="AI Workspace"
        icon={Bot}
        badge={modelConfig.model || "No model"}
      />

      <section className="summaryGrid">
        <div className="summaryCard">
          <Sparkle size={16} />
          <div>
            <strong>Current Paper</strong>
            <span>{paper.title}</span>
          </div>
        </div>
        <div className="summaryCard">
          <ChevronRight size={16} />
          <div>
            <strong>Provider</strong>
            <span>{providerLabel(modelConfig.provider)}</span>
          </div>
        </div>
      </section>
    </aside>
  );
}

function SettingsPanel({
  modelConfig,
  onModelConfigChange,
}: Pick<WorkbenchProps, "modelConfig" | "onModelConfigChange">) {
  const updateProvider = (provider: AiProvider) => {
    const defaults = providerDefaults[provider];
    onModelConfigChange({
      ...modelConfig,
      provider,
      apiBase: defaults.apiBase,
      model: defaults.model,
    });
  };

  return (
    <aside className="workbenchPanel">
      <PanelHeader eyebrow="Settings" title="Model Settings" icon={KeyRound} />
      <section className="card settingsCard">
        <label className="fieldLabel" htmlFor="provider">
          Provider
        </label>
        <select
          id="provider"
          className="textInput"
          value={modelConfig.provider}
          onChange={(event) => updateProvider(event.target.value as AiProvider)}
        >
          <option value="openai-chat">OpenAI Chat Completions</option>
          <option value="openai-responses">OpenAI Responses</option>
          <option value="anthropic">Anthropic Messages</option>
        </select>

        <label className="fieldLabel" htmlFor="api-base">
          API Base
        </label>
        <input
          id="api-base"
          className="textInput"
          value={modelConfig.apiBase}
          onChange={(event) =>
            onModelConfigChange({ ...modelConfig, apiBase: event.target.value })
          }
        />

        <label className="fieldLabel" htmlFor="api-key">
          API Key
        </label>
        <input
          id="api-key"
          className="textInput"
          type="password"
          value={modelConfig.apiKey}
          onChange={(event) =>
            onModelConfigChange({ ...modelConfig, apiKey: event.target.value })
          }
        />

        <label className="fieldLabel" htmlFor="model-name">
          Model
        </label>
        <input
          id="model-name"
          className="textInput"
          value={modelConfig.model}
          onChange={(event) =>
            onModelConfigChange({ ...modelConfig, model: event.target.value })
          }
        />

        <label className="fieldLabel" htmlFor="max-tokens">
          Max Tokens
        </label>
        <input
          id="max-tokens"
          className="textInput"
          type="number"
          min={128}
          max={128000}
          value={modelConfig.maxTokens}
          onChange={(event) =>
            onModelConfigChange({
              ...modelConfig,
              maxTokens: Number(event.target.value) || 1200,
            })
          }
        />
      </section>
    </aside>
  );
}

const providerDefaults: Record<
  AiProvider,
  Pick<ModelConfig, "apiBase" | "model">
> = {
  "openai-chat": {
    apiBase: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  "openai-responses": {
    apiBase: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
  },
  anthropic: {
    apiBase: "https://api.anthropic.com",
    model: "claude-3-5-sonnet-latest",
  },
};

const providerLabel = (provider: AiProvider) => {
  if (provider === "openai-responses") {
    return "OpenAI Responses";
  }

  if (provider === "anthropic") {
    return "Anthropic Messages";
  }

  return "OpenAI Chat";
};

function AnnotationList({ highlights }: { highlights: IHighlight[] }) {
  return (
    <section className="card annotationCard">
      <div className="cardTitle">Highlights</div>
      <div className="annotationList">
        {highlights.length === 0 ? (
          <div className="emptyState">No highlights</div>
        ) : (
          highlights.map((highlight) => (
            <button
              type="button"
              className="annotationItem"
              key={highlight.id}
              onClick={() => jumpToHighlight(highlight)}
            >
              <strong>{highlight.comment.text}</strong>
              {highlight.content.text ? (
                <span>{highlight.content.text.slice(0, 130).trim()}</span>
              ) : (
                <span>Area highlight</span>
              )}
              <em>Page {highlight.position.pageNumber}</em>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function PanelHeader({
  eyebrow,
  title,
  icon: Icon,
  badge,
}: {
  eyebrow: string;
  title: string;
  icon: typeof Bot;
  badge?: string;
}) {
  return (
    <div className="panelHeader">
      <div className="panelTitleBlock">
        <div className="panelIcon">
          <Icon size={18} />
        </div>
        <div>
          <div className="sectionEyebrow">{eyebrow}</div>
          <h2>{title}</h2>
        </div>
      </div>
      {badge ? <span className="panelBadge">{badge}</span> : null}
    </div>
  );
}
