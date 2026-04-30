import {
  Bot,
  FileText,
  KeyRound,
} from "lucide-react";
import type { IHighlight } from "../pdf-highlighter";
import type {
  ActivityId,
  AiProvider,
  ModelConfig,
  PaperDocument,
} from "../types";
import { formatTime } from "../utils";

interface WorkbenchProps {
  activity: ActivityId;
  paper: PaperDocument;
  highlights: IHighlight[];
  modelConfig: ModelConfig;
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
  modelConfig,
  onModelConfigChange,
  onOpenPdf,
}: WorkbenchProps) {
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

    return <AiPanel modelConfig={modelConfig} />;
  };

  return (
    <aside className="workbenchDock reservedDock">
      <div className="workbenchTopSlot">{renderActivePanel()}</div>
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
          <FileText size={14} />
          <span>Open PDF</span>
        </button>
      </div>

      <AnnotationList highlights={highlights} />
    </aside>
  );
}

function AiPanel({
  modelConfig,
}: Pick<WorkbenchProps, "modelConfig">) {
  return (
    <aside className="workbenchPanel">
      <PanelHeader
        eyebrow="AI Cockpit"
        title="AI Workspace"
        icon={Bot}
        badge={modelConfig.model || "No model"}
      />
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
          <Icon size={15} />
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
