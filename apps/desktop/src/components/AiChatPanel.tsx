import { Bot, Send } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  AiContextItem,
  AiMessage,
  AiStreamEvent,
  ModelConfig,
  PaperDocument,
} from "../types";
import { makeId } from "../utils";

interface AiChatPanelProps {
  paper: PaperDocument;
  contextItems: AiContextItem[];
  messages: AiMessage[];
  modelConfig: ModelConfig;
  onMessagesChange: Dispatch<SetStateAction<AiMessage[]>>;
}

export function AiChatPanel({
  paper,
  contextItems,
  messages,
  modelConfig,
  onMessagesChange,
}: AiChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = window.paperSuper?.onAiStreamEvent((event) => {
      handleStreamEvent(event);
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  const handleStreamEvent = (event: AiStreamEvent) => {
    if (event.requestId !== activeRequestIdRef.current) {
      return;
    }

    if (event.type === "delta") {
      onMessagesChange((currentMessages) =>
        currentMessages.map((message) =>
          message.id === event.requestId
            ? { ...message, content: `${message.content}${event.delta}` }
            : message,
        ),
      );
      return;
    }

    if (event.type === "done") {
      activeRequestIdRef.current = null;
      setIsSending(false);
      return;
    }

    activeRequestIdRef.current = null;
    setIsSending(false);
    setSendError(event.error);
    onMessagesChange((currentMessages) =>
      currentMessages.map((message) =>
        message.id === event.requestId
          ? {
              ...message,
              content: message.content
                ? `${message.content}\n\nRequest interrupted: ${event.error}`
                : `Request failed: ${event.error}`,
              isLocal: true,
            }
          : message,
      ),
    );
  };

  const submitMessage = async () => {
    const content = draft.trim();
    if (!content || isSending) {
      return;
    }

    const createdAt = new Date().toISOString();
    const userMessage: AiMessage = {
      id: makeId(),
      role: "user",
      content,
      createdAt,
    };
    const assistantMessage: AiMessage = {
      id: makeId(),
      role: "assistant",
      content: "",
      createdAt,
    };
    const requestMessages = [...messages, userMessage];
    const nextMessages = [...requestMessages, assistantMessage];

    onMessagesChange(nextMessages);
    setDraft("");
    setSendError(null);
    setIsSending(true);
    activeRequestIdRef.current = assistantMessage.id;

    try {
      await window.paperSuper?.sendAiMessageStream(assistantMessage.id, {
        config: modelConfig,
        paperTitle: paper.title,
        contextItems,
        messages: requestMessages,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI request failed";
      setSendError(message);
      activeRequestIdRef.current = null;
      setIsSending(false);
      onMessagesChange((currentMessages) =>
        currentMessages.map((existingMessage) =>
          existingMessage.id === assistantMessage.id
            ? {
                ...existingMessage,
                content: `Request failed: ${message}`,
                isLocal: true,
              }
            : existingMessage,
        ),
      );
    }
  };

  return (
    <section className="card chatCard rightChatPanel">
      <div className="chatHeader">
        <div className="chatTitleBlock">
          <Bot size={14} />
          <div>
            <div className="cardTitle">AI Chat</div>
            <div className="cardMeta">{modelConfig.model || "No model configured"}</div>
          </div>
        </div>
        <span>{isSending ? "Streaming" : "Ready"}</span>
      </div>

      <div className="messageList">
        {messages.map((message) => (
          <div className={`message ${message.role}`} key={message.id}>
            <div className="messageRole">
              {message.role === "assistant" ? "PaperSuper" : "You"}
            </div>
            <div className="messageContent markdownBody">
              {message.role === "assistant" ? (
                message.content ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content}
                  </ReactMarkdown>
                ) : (
                  <span className="streamingCursor">Generating...</span>
                )
              ) : (
                message.content
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="chatComposer">
        <textarea
          value={draft}
          disabled={isSending}
          placeholder="Ask about the current paper..."
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              submitMessage();
            }
          }}
        />
        <button
          type="button"
          className="primaryIconButton"
          disabled={isSending}
          onClick={submitMessage}
          aria-label="Send message"
        >
          <Send size={15} />
        </button>
      </div>

      <div className={sendError ? "composerHint error" : "composerHint"}>
        {isSending
          ? "Requesting model..."
          : sendError
            ? sendError
            : `${contextItems.length} context item${contextItems.length === 1 ? "" : "s"}`}
      </div>
    </section>
  );
}
