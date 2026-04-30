import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useCallback, useEffect, useRef } from "react";
import {
  AreaHighlight,
  Highlight,
  PdfHighlighter,
  PdfLoader,
  Popup,
} from "../pdf-highlighter";
import type {
  Content,
  IHighlight,
  NewHighlight,
  ScaledPosition,
} from "../pdf-highlighter";
import type { AiContextItem, PaperDocument } from "../types";
import { makeId } from "../utils";

const parseIdFromHash = () =>
  document.location.hash.slice("#highlight-".length);

const resetHash = () => {
  document.location.hash = "";
};

interface PdfReaderPaneProps {
  paper: PaperDocument;
  pdfUrl: string;
  highlights: IHighlight[];
  onHighlightsChange: (highlights: IHighlight[]) => void;
  onAddContext: (
    context: Pick<AiContextItem, "text" | "image" | "highlightId" | "pageNumber">,
  ) => void;
  onRemoveContextHighlight: (highlightId: string) => void;
  onClearContextHighlights: () => void;
}

const HighlightPopup = ({ comment }: Pick<IHighlight, "comment">) => {
  if (!comment.text || comment.text === "AI Context") {
    return null;
  }

  return <div className="Highlight__popup">{comment.text}</div>;
};

const isTextLayerSpan = (element: Element | null): element is HTMLElement =>
  Boolean(element && element instanceof HTMLElement && element.closest(".textLayer"));

const selectClickedTextContext = (target: EventTarget | null) => {
  if (!(target instanceof Element)) {
    return;
  }

  const clickedSpan = target.closest(".textLayer span");
  if (!isTextLayerSpan(clickedSpan)) {
    return;
  }

  const textLayer = clickedSpan.closest(".textLayer");
  if (!textLayer) {
    return;
  }

  const spans = Array.from(textLayer.querySelectorAll("span"))
    .filter((span): span is HTMLElement => span instanceof HTMLElement)
    .filter((span) => span.textContent?.trim());

  if (spans.length === 0) {
    return;
  }

  const clickedRect = clickedSpan.getBoundingClientRect();
  const clickedCenterY = clickedRect.top + clickedRect.height / 2;
  const lineGroups: HTMLElement[][] = [];

  for (const span of spans) {
    const rect = span.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    const existingLine = lineGroups.find((line) => {
      const firstRect = line[0].getBoundingClientRect();
      const firstCenterY = firstRect.top + firstRect.height / 2;
      return Math.abs(firstCenterY - centerY) <= 4;
    });

    if (existingLine) {
      existingLine.push(span);
    } else {
      lineGroups.push([span]);
    }
  }

  lineGroups.sort((a, b) => {
    const aTop = a[0].getBoundingClientRect().top;
    const bTop = b[0].getBoundingClientRect().top;
    return aTop - bTop;
  });

  const clickedLineIndex = lineGroups.findIndex((line) =>
    line.some((span) => {
      const rect = span.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      return Math.abs(centerY - clickedCenterY) <= 4;
    }),
  );

  if (clickedLineIndex < 0) {
    return;
  }

  const contextLines = lineGroups
    .slice(Math.max(0, clickedLineIndex - 1), clickedLineIndex + 2)
    .map((line) =>
      line.sort(
        (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left,
      ),
    );
  const flatSpans = contextLines.flat();
  const firstSpan = flatSpans[0];
  const lastSpan = flatSpans[flatSpans.length - 1];

  if (!firstSpan || !lastSpan) {
    return;
  }

  const selection = window.getSelection();
  const range = document.createRange();
  range.setStart(firstSpan, 0);
  range.setEnd(lastSpan, lastSpan.childNodes.length);
  selection?.removeAllRanges();
  selection?.addRange(range);
};

const isPdfBlankClick = (event: React.MouseEvent<HTMLElement>) => {
  if (!(event.target instanceof Element)) {
    return false;
  }

  if (
    event.target.closest(".textLayer span") ||
    event.target.closest(".Highlight") ||
    event.target.closest("#PdfHighlighter__tip-container")
  ) {
    return false;
  }

  return Boolean(event.target.closest(".page") || event.target.closest(".pdfViewer"));
};

export function PdfReaderPane({
  paper,
  pdfUrl,
  highlights,
  onHighlightsChange,
  onAddContext,
  onRemoveContextHighlight,
  onClearContextHighlights,
}: PdfReaderPaneProps) {
  const scrollViewerTo = useRef<(highlight: IHighlight) => void>(() => {});
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  const getHighlightById = useCallback(
    (id: string) => highlights.find((highlight) => highlight.id === id),
    [highlights],
  );

  const scrollToHighlightFromHash = useCallback(() => {
    const highlight = getHighlightById(parseIdFromHash());
    if (highlight) {
      scrollViewerTo.current(highlight);
    }
  }, [getHighlightById]);

  useEffect(() => {
    window.addEventListener("hashchange", scrollToHighlightFromHash, false);
    return () => {
      window.removeEventListener(
        "hashchange",
        scrollToHighlightFromHash,
        false,
      );
    };
  }, [scrollToHighlightFromHash]);

  const addHighlight = (highlight: NewHighlight) => {
    const id = makeId();
    onHighlightsChange([{ ...highlight, id }, ...highlights]);
    return id;
  };

  const addContextHighlight = (
    position: ScaledPosition,
    content: Content,
    commentText: string,
  ) => {
    const text = content.text?.trim();
    const contextText =
      text && text.length > 0
        ? text
        : `Page ${position.pageNumber} visual region capture`;

    const duplicateHighlight = text
      ? highlights.some(
          (highlight) =>
            highlight.position.pageNumber === position.pageNumber &&
            highlight.comment.text === commentText &&
            highlight.content.text?.trim() === text,
        )
      : false;

    if (duplicateHighlight) {
      const existingHighlight = highlights.find(
        (highlight) =>
          highlight.position.pageNumber === position.pageNumber &&
          highlight.comment.text === commentText &&
          highlight.content.text?.trim() === text,
      );

      if (existingHighlight) {
        onRemoveContextHighlight(existingHighlight.id);
      }
      return;
    }

    const highlightId = addHighlight({
      content,
      position,
      comment: { text: commentText, emoji: "" },
    });

    onAddContext({
      text: contextText,
      image: content.image,
      highlightId,
      pageNumber: position.pageNumber,
    });
  };

  const updateHighlight = (
    highlightId: string,
    position: Partial<ScaledPosition>,
    content: Partial<Content>,
  ) => {
    onHighlightsChange(
      highlights.map((highlight) =>
        highlight.id === highlightId
          ? {
              ...highlight,
              position: { ...highlight.position, ...position },
              content: { ...highlight.content, ...content },
            }
          : highlight,
      ),
    );
  };

  return (
    <section className="pdfPane">
      <div className="paneHeader">
        <div>
          <div className="sectionEyebrow">PDF</div>
          <h1 title={paper.title}>{paper.title}</h1>
        </div>
        <div className="paneMeta">
          <span>{highlights.length} highlights</span>
        </div>
      </div>

      <div
        className="pdfSurface"
        onPointerDown={(event) => {
          pointerStartRef.current = {
            x: event.clientX,
            y: event.clientY,
          };
        }}
        onClick={(event) => {
          const pointerStart = pointerStartRef.current;
          pointerStartRef.current = null;

          if (pointerStart) {
            const movedX = Math.abs(event.clientX - pointerStart.x);
            const movedY = Math.abs(event.clientY - pointerStart.y);
            if (movedX > 5 || movedY > 5) {
              return;
            }
          }

          const selectionText = window.getSelection()?.toString().trim();
          if (selectionText) {
            return;
          }

          if (isPdfBlankClick(event)) {
            onClearContextHighlights();
            return;
          }

          selectClickedTextContext(event.target);
        }}
      >
        <PdfLoader
          key={pdfUrl}
          url={pdfUrl}
          workerSrc={pdfWorkerUrl}
          beforeLoad={<div className="pdfState">Loading PDF</div>}
          errorMessage={<div className="pdfState error">PDF failed to load</div>}
        >
          {(pdfDocument) => (
            <PdfHighlighter
              pdfDocument={pdfDocument}
              enableAreaSelection={(event) => {
                if (event.altKey) {
                  return true;
                }

                const target = event.target;
                return (
                  target instanceof Element &&
                  !target.closest(".textLayer") &&
                  Boolean(target.closest(".page"))
                );
              }}
              onScrollChange={resetHash}
              scrollRef={(scrollTo) => {
                scrollViewerTo.current = scrollTo;
                scrollToHighlightFromHash();
              }}
              onSelectionFinished={(
                position,
                content,
                hideTipAndSelection,
                transformSelection,
              ) => {
                if (content.image) {
                  transformSelection();
                }

                addContextHighlight(position, content, "AI Context");
                window.getSelection()?.removeAllRanges();
                window.setTimeout(() => hideTipAndSelection(), 0);
                return null;
              }}
              highlightTransform={(
                highlight,
                index,
                setTip,
                hideTip,
                viewportToScaled,
                screenshot,
                isScrolledTo,
              ) => {
                const isTextHighlight = !highlight.content?.image;
                const isAiContextHighlight = highlight.comment.text === "AI Context";
                const removeContextHighlight = (event?: React.MouseEvent) => {
                  if (isAiContextHighlight) {
                    event?.stopPropagation();
                    event?.preventDefault();
                    onRemoveContextHighlight(highlight.id);
                  }
                };

                const component = isTextHighlight ? (
                  <Highlight
                    isScrolledTo={isScrolledTo}
                    position={highlight.position}
                    comment={highlight.comment}
                    onClick={removeContextHighlight}
                    onMouseDown={removeContextHighlight}
                  />
                ) : (
                  <AreaHighlight
                    isScrolledTo={isScrolledTo}
                    highlight={highlight}
                    onClick={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                      removeContextHighlight();
                    }}
                    onChange={(boundingRect) => {
                      updateHighlight(
                        highlight.id,
                        { boundingRect: viewportToScaled(boundingRect) },
                        { image: screenshot(boundingRect) },
                      );
                    }}
                  />
                );

                const popupContent = <HighlightPopup comment={highlight.comment} />;

                return (
                  <Popup
                    popupContent={popupContent}
                    onMouseOver={(popupContent) =>
                      popupContent ? setTip(highlight, () => popupContent) : undefined
                    }
                    onMouseOut={hideTip}
                    key={index}
                  >
                    {component}
                  </Popup>
                );
              }}
              highlights={highlights}
            />
          )}
        </PdfLoader>
      </div>
    </section>
  );
}
