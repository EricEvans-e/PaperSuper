import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Languages, LoaderCircle, RotateCcw, X } from "lucide-react";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
import type { AiContextItem, ModelConfig, PaperDocument } from "../types";
import { makeId } from "../utils";

const parseIdFromHash = () =>
  document.location.hash.slice("#highlight-".length);

const resetHash = () => {
  document.location.hash = "";
};

const DEFAULT_PDF_SCALE = 1;
const MIN_PDF_SCALE = 0.5;
const MAX_PDF_SCALE = 2.5;
const PDF_SCALE_STEP = 0.1;
const CLICK_CONTEXT_BEFORE_CHARS = 180;
const CLICK_CONTEXT_AFTER_CHARS = 260;
const TRANSLATION_MENU_WIDTH = 150;
const TRANSLATION_POPUP_WIDTH = 360;
const TRANSLATION_POPUP_MIN_HEIGHT = 220;
const MAX_TRANSLATION_CONTEXT_CHARS = 18_000;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const normalizePdfScale = (value: number) =>
  Number(clamp(Math.round(value * 100) / 100, MIN_PDF_SCALE, MAX_PDF_SCALE).toFixed(2));

interface PdfReaderPaneProps {
  paper: PaperDocument;
  pdfUrl: string;
  contextItems: AiContextItem[];
  highlights: IHighlight[];
  modelConfig: ModelConfig;
  onHighlightsChange: Dispatch<SetStateAction<IHighlight[]>>;
  onAddContext: (
    context: Pick<AiContextItem, "text" | "highlightId" | "pageNumber">,
  ) => void;
  onRemoveContextHighlight: (highlightId: string) => void;
  onClearContextHighlights: () => void;
}

interface PaperTextPage {
  pageNumber: number;
  text: string;
}

interface OverlayAnchor {
  x: number;
  y: number;
}

interface HighlightActionMenu {
  anchor: OverlayAnchor;
  highlightId: string;
  highlightIds: string[];
  pageNumber?: number;
  sourceText: string;
}

interface TranslationPopupState {
  anchor: OverlayAnchor;
  highlightId: string;
  highlightIds: string[];
  pageNumber?: number;
  sourceText: string;
  content: string;
  error: string | null;
  status: "loading" | "done" | "error";
}

const HighlightPopup = ({ comment }: Pick<IHighlight, "comment">) => {
  if (!comment.text || comment.text === "AI Context") {
    return null;
  }

  return <div className="Highlight__popup">{comment.text}</div>;
};

const isTextLayerSpan = (element: Element | null): element is HTMLElement =>
  Boolean(element && element instanceof HTMLElement && element.closest(".textLayer"));

interface TextFragment {
  span: HTMLElement;
  node: Text;
  text: string;
}

interface TextBoundary {
  fragmentIndex: number;
  offset: number;
}

const sentenceEndPattern = /[.!?。！？;；:：]/;
const closingMarks = new Set([
  "\"",
  "'",
  ")",
  "]",
  "}",
  "”",
  "’",
  "）",
  "】",
  "》",
  "」",
  "』",
]);

const getTextNode = (span: HTMLElement) =>
  Array.from(span.childNodes).find(
    (node): node is Text => node.nodeType === Node.TEXT_NODE,
  );

const getTextFragments = (textLayer: Element): TextFragment[] =>
  Array.from(textLayer.querySelectorAll("span"))
    .filter((span): span is HTMLElement => span instanceof HTMLElement)
    .map((span) => {
      const node = getTextNode(span);
      return node && node.data.trim()
        ? {
            span,
            node,
            text: node.data,
          }
        : null;
    })
    .filter(Boolean) as TextFragment[];

const documentFromSpan = (span: HTMLElement) =>
  span.ownerDocument as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };

const getClickedTextOffset = (
  clickedSpan: HTMLElement,
  clientX: number,
  clientY: number,
) => {
  const textNode = getTextNode(clickedSpan);
  if (!textNode) {
    return 0;
  }

  const doc = documentFromSpan(clickedSpan);
  const caretRange = doc.caretRangeFromPoint?.(clientX, clientY);
  if (caretRange && clickedSpan.contains(caretRange.startContainer)) {
    if (caretRange.startContainer === textNode) {
      return clamp(caretRange.startOffset, 0, textNode.data.length);
    }

    return caretRange.startOffset <= 0 ? 0 : textNode.data.length;
  }

  const caretPosition = doc.caretPositionFromPoint?.(clientX, clientY);
  if (caretPosition && clickedSpan.contains(caretPosition.offsetNode)) {
    if (caretPosition.offsetNode === textNode) {
      return clamp(caretPosition.offset, 0, textNode.data.length);
    }

    return caretPosition.offset <= 0 ? 0 : textNode.data.length;
  }

  const rect = clickedSpan.getBoundingClientRect();
  if (rect.width <= 0) {
    return 0;
  }

  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  return clamp(Math.round(textNode.data.length * ratio), 0, textNode.data.length);
};

const trimStartBoundary = (
  fragments: TextFragment[],
  start: TextBoundary,
  end: TextBoundary,
): TextBoundary => {
  for (let index = start.fragmentIndex; index <= end.fragmentIndex; index += 1) {
    const fragment = fragments[index];
    const from = index === start.fragmentIndex ? start.offset : 0;
    const to = index === end.fragmentIndex ? end.offset : fragment.text.length;

    for (let offset = from; offset < to; offset += 1) {
      if (!/\s/.test(fragment.text[offset])) {
        return { fragmentIndex: index, offset };
      }
    }
  }

  return start;
};

const trimEndBoundary = (
  fragments: TextFragment[],
  start: TextBoundary,
  end: TextBoundary,
): TextBoundary => {
  for (let index = end.fragmentIndex; index >= start.fragmentIndex; index -= 1) {
    const fragment = fragments[index];
    const from = index === start.fragmentIndex ? start.offset : 0;
    const to = index === end.fragmentIndex ? end.offset : fragment.text.length;

    for (let offset = to - 1; offset >= from; offset -= 1) {
      if (!/\s/.test(fragment.text[offset])) {
        return { fragmentIndex: index, offset: offset + 1 };
      }
    }
  }

  return end;
};

const boundaryIsBefore = (start: TextBoundary, end: TextBoundary) =>
  start.fragmentIndex < end.fragmentIndex ||
  (start.fragmentIndex === end.fragmentIndex && start.offset < end.offset);

const findSentenceStart = (
  fragments: TextFragment[],
  clickedIndex: number,
  clickedOffset: number,
): TextBoundary => {
  let scanned = 0;

  for (let index = clickedIndex; index >= 0; index -= 1) {
    const text = fragments[index].text;
    const from = index === clickedIndex ? clickedOffset - 1 : text.length - 1;

    for (let offset = from; offset >= 0; offset -= 1) {
      if (sentenceEndPattern.test(text[offset])) {
        return { fragmentIndex: index, offset: offset + 1 };
      }

      scanned += 1;
      if (scanned >= CLICK_CONTEXT_BEFORE_CHARS) {
        return { fragmentIndex: index, offset };
      }
    }
  }

  return { fragmentIndex: 0, offset: 0 };
};

const includeClosingMarks = (
  fragments: TextFragment[],
  end: TextBoundary,
): TextBoundary => {
  let { fragmentIndex, offset } = end;

  while (fragmentIndex < fragments.length) {
    const text = fragments[fragmentIndex].text;

    if (offset >= text.length) {
      const nextFragment = fragments[fragmentIndex + 1];
      if (!nextFragment || !nextFragment.text || !closingMarks.has(nextFragment.text[0])) {
        break;
      }
      fragmentIndex += 1;
      offset = 1;
      continue;
    }

    if (!closingMarks.has(text[offset])) {
      break;
    }

    offset += 1;
  }

  return { fragmentIndex, offset };
};

const findSentenceEnd = (
  fragments: TextFragment[],
  clickedIndex: number,
  clickedOffset: number,
): TextBoundary => {
  let scanned = 0;

  for (let index = clickedIndex; index < fragments.length; index += 1) {
    const text = fragments[index].text;
    const from = index === clickedIndex ? clickedOffset : 0;

    for (let offset = from; offset < text.length; offset += 1) {
      scanned += 1;

      if (sentenceEndPattern.test(text[offset])) {
        return includeClosingMarks(fragments, {
          fragmentIndex: index,
          offset: offset + 1,
        });
      }

      if (scanned >= CLICK_CONTEXT_AFTER_CHARS) {
        return { fragmentIndex: index, offset: offset + 1 };
      }
    }
  }

  const lastFragmentIndex = fragments.length - 1;
  return {
    fragmentIndex: lastFragmentIndex,
    offset: fragments[lastFragmentIndex].text.length,
  };
};

const selectClickedTextContext = (
  target: EventTarget | null,
  clientX: number,
  clientY: number,
) => {
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

  const fragments = getTextFragments(textLayer);
  const clickedIndex = fragments.findIndex(({ span }) => span === clickedSpan);

  if (clickedIndex < 0) {
    return;
  }

  const clickedOffset = getClickedTextOffset(clickedSpan, clientX, clientY);
  const rawStart = findSentenceStart(fragments, clickedIndex, clickedOffset);
  const rawEnd = findSentenceEnd(fragments, clickedIndex, clickedOffset);
  const start = trimStartBoundary(fragments, rawStart, rawEnd);
  const end = trimEndBoundary(fragments, start, rawEnd);
  const safeStart = boundaryIsBefore(start, end)
    ? start
    : { fragmentIndex: clickedIndex, offset: 0 };
  const safeEnd = boundaryIsBefore(start, end)
    ? end
    : {
        fragmentIndex: clickedIndex,
        offset: fragments[clickedIndex].text.length,
      };
  const startFragment = fragments[safeStart.fragmentIndex];
  const endFragment = fragments[safeEnd.fragmentIndex];

  if (!startFragment || !endFragment) {
    return;
  }

  const selection = window.getSelection();
  const range = document.createRange();
  range.setStart(startFragment.node, safeStart.offset);
  range.setEnd(endFragment.node, safeEnd.offset);
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

const areaPositionMatches = (
  current: ScaledPosition,
  next: ScaledPosition,
) => {
  const tolerance = 0.5;
  const currentRect = current.boundingRect;
  const nextRect = next.boundingRect;

  return (
    current.pageNumber === next.pageNumber &&
    Math.abs(currentRect.x1 - nextRect.x1) <= tolerance &&
    Math.abs(currentRect.y1 - nextRect.y1) <= tolerance &&
    Math.abs(currentRect.x2 - nextRect.x2) <= tolerance &&
    Math.abs(currentRect.y2 - nextRect.y2) <= tolerance
  );
};

interface NormalizedBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

interface NormalizedRect extends NormalizedBox {}

interface NormalizedHighlightBounds extends NormalizedBox {
  highlight: IHighlight;
  text: string;
  pageNumber: number;
  rects: NormalizedRect[];
}

const compareNormalizedRectReadingOrder = (
  first: NormalizedRect,
  second: NormalizedRect,
) => {
  const lineThreshold = Math.max(first.height, second.height) * 0.65;
  if (Math.abs(first.centerY - second.centerY) <= Math.max(lineThreshold, 0.01)) {
    return first.left - second.left;
  }

  return first.top - second.top;
};

const normalizeScaledRect = (
  rect: ScaledPosition["boundingRect"],
): NormalizedRect => {
  const width = rect.width || 1;
  const height = rect.height || 1;
  const x1 = rect.x1 / width;
  const x2 = rect.x2 / width;
  const y1 = rect.y1 / height;
  const y2 = rect.y2 / height;
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  const rectWidth = right - left;
  const rectHeight = bottom - top;

  return {
    left,
    right,
    top,
    bottom,
    width: rectWidth,
    height: rectHeight,
    centerX: left + rectWidth / 2,
    centerY: top + rectHeight / 2,
  };
};

const getNormalizedHighlightBounds = (
  highlight: IHighlight,
): NormalizedHighlightBounds | null => {
  const text = highlight.content.text?.trim();
  if (
    !text ||
    highlight.comment.text !== "AI Context" ||
    highlight.position.rects.length === 0
  ) {
    return null;
  }

  const rects = highlight.position.rects
    .map(normalizeScaledRect)
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort(compareNormalizedRectReadingOrder);
  if (rects.length === 0) {
    return null;
  }

  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    highlight,
    text,
    pageNumber: highlight.position.pageNumber,
    rects,
    left,
    right,
    top,
    bottom,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
};

const horizontalOverlap = (first: NormalizedBox, second: NormalizedBox) =>
  Math.min(first.right, second.right) - Math.max(first.left, second.left);

const verticalOverlap = (first: NormalizedBox, second: NormalizedBox) =>
  Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);

const isSameTranslationColumn = (
  first: NormalizedHighlightBounds,
  second: NormalizedHighlightBounds,
) => {
  if (first.pageNumber !== second.pageNumber) {
    return false;
  }

  const overlap = horizontalOverlap(first, second);
  const minWidth = Math.min(first.width, second.width);
  const overlapRatio = minWidth > 0 ? overlap / minWidth : 0;
  const centerDistance = Math.abs(first.centerX - second.centerX);
  const leftDistance = Math.abs(first.left - second.left);
  const rightDistance = Math.abs(first.right - second.right);
  const clearlyDifferentColumns =
    centerDistance > 0.34 &&
    ((first.centerX < 0.48 && second.centerX > 0.52) ||
      (second.centerX < 0.48 && first.centerX > 0.52));

  if (clearlyDifferentColumns) {
    return false;
  }

  return (
    overlapRatio >= 0.04 ||
    centerDistance <= 0.28 ||
    leftDistance <= 0.14 ||
    rightDistance <= 0.14
  );
};

const compareReadingOrder = (
  first: NormalizedHighlightBounds,
  second: NormalizedHighlightBounds,
) => {
  const firstStart = first.rects[0];
  const secondStart = second.rects[0];

  return compareNormalizedRectReadingOrder(firstStart, secondStart);
};

const rectsAreOnSameLine = (first: NormalizedRect, second: NormalizedRect) => {
  const overlapY = verticalOverlap(first, second);
  const minHeight = Math.min(first.height, second.height);
  const lineHeight = Math.max(first.height, second.height);

  return (
    overlapY >= minHeight * 0.35 ||
    Math.abs(first.centerY - second.centerY) <= Math.max(lineHeight * 0.65, 0.01)
  );
};

const areAdjacentForTranslation = (
  previous: NormalizedHighlightBounds,
  next: NormalizedHighlightBounds,
) => {
  if (!isSameTranslationColumn(previous, next)) {
    return false;
  }

  const previousEnd = previous.rects[previous.rects.length - 1];
  const nextStart = next.rects[0];
  const sameLine = rectsAreOnSameLine(previousEnd, nextStart);
  const horizontalGap = nextStart.left - previousEnd.right;

  if (sameLine) {
    return horizontalGap >= -0.1 && horizontalGap <= 0.22;
  }

  const verticalGap = nextStart.top - previousEnd.bottom;
  const lineHeight = Math.max(previousEnd.height, nextStart.height);
  const relaxedLineGap = Math.max(lineHeight * 4.2, 0.08);
  const hasLineReset =
    nextStart.left <= previousEnd.right + 0.22 ||
    Math.abs(nextStart.left - previous.left) <= 0.18 ||
    horizontalOverlap(previous, nextStart) >= Math.min(previous.width, nextStart.width) * 0.03;

  return verticalGap >= -lineHeight * 0.65 && verticalGap <= relaxedLineGap && hasLineReset;
};

const getMergedTranslationTarget = (
  clickedHighlightId: string,
  highlights: IHighlight[],
) => {
  const clicked = highlights.find((highlight) => highlight.id === clickedHighlightId);
  const clickedBounds = clicked ? getNormalizedHighlightBounds(clicked) : null;

  if (!clicked || !clickedBounds) {
    return null;
  }

  const columnHighlights = highlights
    .map(getNormalizedHighlightBounds)
    .filter(
      (bounds): bounds is NormalizedHighlightBounds => bounds !== null,
    )
    .filter(
      (bounds) =>
        bounds.pageNumber === clickedBounds.pageNumber &&
        isSameTranslationColumn(bounds, clickedBounds),
    )
    .sort(compareReadingOrder);
  const clickedIndex = columnHighlights.findIndex(
    (bounds) => bounds.highlight.id === clickedHighlightId,
  );

  if (clickedIndex < 0) {
    return {
      highlightIds: [clicked.id],
      pageNumber: clicked.position.pageNumber,
      sourceText: clickedBounds.text,
    };
  }

  let startIndex = clickedIndex;
  let endIndex = clickedIndex;

  while (
    startIndex > 0 &&
    areAdjacentForTranslation(
      columnHighlights[startIndex - 1],
      columnHighlights[startIndex],
    )
  ) {
    startIndex -= 1;
  }

  while (
    endIndex < columnHighlights.length - 1 &&
    areAdjacentForTranslation(
      columnHighlights[endIndex],
      columnHighlights[endIndex + 1],
    )
  ) {
    endIndex += 1;
  }

  const mergedHighlights = columnHighlights.slice(startIndex, endIndex + 1);

  return {
    highlightIds: mergedHighlights.map(({ highlight }) => highlight.id),
    pageNumber: clicked.position.pageNumber,
    sourceText: mergedHighlights.map(({ text }) => text).join("\n"),
  };
};

const normalizeExtractedText = (text: string) =>
  text.replace(/\s+/g, " ").trim();

const clipText = (text: string, maxLength: number) =>
  text.length > maxLength ? `${text.slice(0, maxLength).trim()}\n...` : text;

const buildTranslationPaperContext = (
  paperTextPages: PaperTextPage[],
  pageNumber?: number,
) => {
  if (paperTextPages.length === 0) {
    return "No extracted full-paper text is available yet.";
  }

  const selectedPage = pageNumber
    ? paperTextPages.find((page) => page.pageNumber === pageNumber)
    : null;
  const firstPages = paperTextPages.slice(0, 3);
  const remainingPages = paperTextPages.filter(
    (page) =>
      page.pageNumber !== selectedPage?.pageNumber &&
      !firstPages.some((firstPage) => firstPage.pageNumber === page.pageNumber),
  );
  const orderedPages = [
    ...(selectedPage ? [selectedPage] : []),
    ...firstPages,
    ...remainingPages,
  ];
  let context = "";

  for (const page of orderedPages) {
    const next = `[Page ${page.pageNumber}]\n${page.text}\n\n`;
    if (context.length + next.length > MAX_TRANSLATION_CONTEXT_CHARS) {
      const remaining = MAX_TRANSLATION_CONTEXT_CHARS - context.length;
      if (remaining > 600) {
        context += clipText(next, remaining);
      }
      break;
    }
    context += next;
  }

  return context.trim();
};

const buildTranslationPrompt = ({
  paperTitle,
  sourceText,
  paperContext,
}: {
  paperTitle: string;
  sourceText: string;
  paperContext: string;
}) =>
  [
    "请将论文中的选中内容翻译成自然、准确的中文。",
    "",
    "要求：",
    "- 结合论文标题、论文上下文和已有选区上下文统一术语。",
    "- 保留公式、变量名、引用编号和必要的英文术语。",
    "- 固定技术术语默认保留英文原词，例如 token、cache、GPU、KV cache、attention；必要时可以在首次出现时补充中文解释。",
    "- 不要逐字硬翻；优先让中文读起来像科研论文。",
    "- 如果某个术语需要保留英文，可以使用“中文（English）”。",
    "- 只输出翻译结果；如确有必要，可在末尾加一小段“术语说明”。",
    "",
    `论文标题：${paperTitle || "Untitled PDF"}`,
    "",
    "选中内容：",
    "```text",
    sourceText,
    "```",
    "",
    "可用论文上下文：",
    "```text",
    paperContext,
    "```",
  ].join("\n");

function PdfTextExtractor({
  pdfDocument,
  onTextReady,
}: {
  pdfDocument: PDFDocumentProxy;
  onTextReady: (pages: PaperTextPage[]) => void;
}) {
  useEffect(() => {
    let cancelled = false;

    const extract = async () => {
      const pages: PaperTextPage[] = [];

      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        if (cancelled) {
          return;
        }

        const page = await pdfDocument.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const text = normalizeExtractedText(
          textContent.items
            .map((item) =>
              typeof (item as { str?: unknown }).str === "string"
                ? (item as { str: string }).str
                : "",
            )
            .filter(Boolean)
            .join(" "),
        );

        if (text) {
          pages.push({ pageNumber, text });
        }
      }

      if (!cancelled) {
        onTextReady(pages);
      }
    };

    onTextReady([]);
    void extract();

    return () => {
      cancelled = true;
    };
  }, [onTextReady, pdfDocument]);

  return null;
}

export function PdfReaderPane({
  paper,
  pdfUrl,
  contextItems,
  highlights,
  modelConfig,
  onHighlightsChange,
  onAddContext,
  onRemoveContextHighlight,
  onClearContextHighlights,
}: PdfReaderPaneProps) {
  const scrollViewerTo = useRef<(highlight: IHighlight) => void>(() => {});
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pdfSurfaceRef = useRef<HTMLDivElement | null>(null);
  const suppressBlankClickUntilRef = useRef(0);
  const [highlightActionMenu, setHighlightActionMenu] =
    useState<HighlightActionMenu | null>(null);
  const [paperTextPages, setPaperTextPages] = useState<PaperTextPage[]>([]);
  const [pdfScale, setPdfScale] = useState<number | "auto">("auto");
  const [translationPopup, setTranslationPopup] =
    useState<TranslationPopupState | null>(null);

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

  useEffect(() => {
    setHighlightActionMenu(null);
    setTranslationPopup(null);
    setPaperTextPages([]);
  }, [pdfUrl]);

  const getOverlayAnchor = useCallback(
    (clientX: number, clientY: number, width: number, minHeight = 80) => {
      const surfaceRect = pdfSurfaceRef.current?.getBoundingClientRect();
      if (!surfaceRect) {
        return { x: clientX, y: clientY };
      }

      return {
        x: clamp(clientX - surfaceRect.left, 8, Math.max(8, surfaceRect.width - width - 8)),
        y: clamp(
          clientY - surfaceRect.top,
          8,
          Math.max(8, surfaceRect.height - minHeight - 8),
        ),
      };
    },
    [],
  );

  const addHighlight = (highlight: NewHighlight) => {
    const id = makeId();
    onHighlightsChange((items) => [{ ...highlight, id }, ...items]);
    return id;
  };

  const addContextHighlight = (
    position: ScaledPosition,
    content: Content,
    commentText: string,
  ) => {
    const text = content.text?.trim();
    const isAreaContext = position.rects.length === 0;
    const contextText =
      text && text.length > 0
        ? text
        : `No extractable PDF text was found in the selected region on page ${position.pageNumber}.`;

    const existingHighlight = highlights.find((highlight) => {
      if (
        highlight.position.pageNumber !== position.pageNumber ||
        highlight.comment.text !== commentText
      ) {
        return false;
      }

      if (isAreaContext) {
        return areaPositionMatches(highlight.position, position);
      }

      return text ? highlight.content.text?.trim() === text : false;
    });

    if (existingHighlight) {
      onRemoveContextHighlight(existingHighlight.id);
      return;
    }

    const highlightId = addHighlight({
      content,
      position,
      comment: { text: commentText, emoji: "" },
    });

    onAddContext({
      text: contextText,
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
      (items) => items.map((highlight) =>
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

  const startTranslation = async (menu: HighlightActionMenu) => {
    const createdAt = new Date().toISOString();
    const mergedHighlightIds = new Set(menu.highlightIds);
    const selectedContext: AiContextItem = {
      id: `translation-${menu.highlightId}`,
      text: menu.sourceText,
      highlightId: menu.highlightId,
      pageNumber: menu.pageNumber,
      createdAt,
    };
    const paperContext = buildTranslationPaperContext(
      paperTextPages,
      menu.pageNumber,
    );
    const prompt = buildTranslationPrompt({
      paperTitle: paper.title,
      sourceText: menu.sourceText,
      paperContext,
    });
    const contextForTranslation = [
      selectedContext,
      ...contextItems
        .filter((item) => !item.highlightId || !mergedHighlightIds.has(item.highlightId))
        .slice(0, 8),
    ];
    const popupAnchor = getOverlayAnchor(
      menu.anchor.x + (pdfSurfaceRef.current?.getBoundingClientRect().left ?? 0),
      menu.anchor.y + (pdfSurfaceRef.current?.getBoundingClientRect().top ?? 0),
      TRANSLATION_POPUP_WIDTH,
      TRANSLATION_POPUP_MIN_HEIGHT,
    );

    setHighlightActionMenu(null);
    setTranslationPopup({
      anchor: popupAnchor,
      highlightId: menu.highlightId,
      highlightIds: menu.highlightIds,
      pageNumber: menu.pageNumber,
      sourceText: menu.sourceText,
      content: "",
      error: null,
      status: "loading",
    });

    try {
      const response = await window.paperSuper?.sendAiMessage({
        config: modelConfig,
        paperTitle: paper.title,
        contextItems: contextForTranslation,
        messages: [
          {
            id: makeId(),
            role: "user",
            content: prompt,
            createdAt,
          },
        ],
      });

      setTranslationPopup((current) =>
        current?.highlightId === menu.highlightId
          ? {
              ...current,
              content: response?.content || "No translation returned.",
              error: null,
              status: "done",
            }
          : current,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Translation request failed";
      setTranslationPopup((current) =>
        current?.highlightId === menu.highlightId
          ? {
              ...current,
              content: "",
              error: message,
              status: "error",
            }
          : current,
      );
    }
  };

  const handlePdfWheel = (event: React.WheelEvent<HTMLElement>) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    setPdfScale((currentScale) => {
      const baseScale =
        typeof currentScale === "number" ? currentScale : DEFAULT_PDF_SCALE;
      const direction = event.deltaY < 0 ? 1 : -1;
      return normalizePdfScale(baseScale + direction * PDF_SCALE_STEP);
    });
  };

  const pdfScaleValue =
    typeof pdfScale === "number" ? pdfScale.toFixed(2) : pdfScale;
  const pdfScaleLabel =
    typeof pdfScale === "number" ? `${Math.round(pdfScale * 100)}%` : "Auto";

  return (
    <section className="pdfPane">
      <div className="paneHeader">
        <div>
          <div className="sectionEyebrow">PDF</div>
          <h1 title={paper.title}>{paper.title}</h1>
        </div>
        <div className="paneMeta">
          <span>Zoom {pdfScaleLabel}</span>
          <span>{highlights.length} highlights</span>
        </div>
      </div>

      <div
        className="pdfSurface"
        ref={pdfSurfaceRef}
        onWheel={handlePdfWheel}
        onPointerDown={(event) => {
          pointerStartRef.current = {
            x: event.clientX,
            y: event.clientY,
          };
        }}
        onClick={(event) => {
          setHighlightActionMenu(null);
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

          if (Date.now() < suppressBlankClickUntilRef.current) {
            suppressBlankClickUntilRef.current = 0;
            return;
          }

          if (isPdfBlankClick(event)) {
            onClearContextHighlights();
            return;
          }

          selectClickedTextContext(event.target, event.clientX, event.clientY);
        }}
      >
        {highlightActionMenu ? (
          <div
            className="highlightActionMenu"
            style={{
              left: highlightActionMenu.anchor.x,
              top: highlightActionMenu.anchor.y,
            }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <button
              type="button"
              className="highlightActionButton"
              onClick={() => void startTranslation(highlightActionMenu)}
            >
              <Languages size={14} />
              <span>翻译</span>
            </button>
          </div>
        ) : null}

        {translationPopup ? (
          <div
            className="translationPopup"
            style={{
              left: translationPopup.anchor.x,
              top: translationPopup.anchor.y,
              maxHeight: `min(520px, calc(100% - ${translationPopup.anchor.y + 8}px))`,
            }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <div className="translationPopupHeader">
              <div className="translationPopupTitle">
                {translationPopup.status === "loading" ? (
                  <LoaderCircle size={14} className="spinIcon" />
                ) : (
                  <Languages size={14} />
                )}
                <span>翻译</span>
              </div>
              <div className="translationPopupActions">
                <button
                  type="button"
                  className="textIconButton"
                  aria-label="Regenerate translation"
                  disabled={translationPopup.status === "loading"}
                  onClick={() =>
                    void startTranslation({
                      anchor: translationPopup.anchor,
                      highlightId: translationPopup.highlightId,
                      highlightIds: translationPopup.highlightIds,
                      pageNumber: translationPopup.pageNumber,
                      sourceText: translationPopup.sourceText,
                    })
                  }
                >
                  <RotateCcw size={13} />
                </button>
                <button
                  type="button"
                  className="textIconButton"
                  aria-label="Close translation"
                  onClick={() => setTranslationPopup(null)}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            <div className="translationScroll">
              <div className="translationSource">
                {clipText(translationPopup.sourceText, 220)}
              </div>

              <div className="translationContent markdownBody">
                {translationPopup.status === "loading" ? (
                  <span className="streamingCursor">正在结合论文上下文翻译...</span>
                ) : translationPopup.status === "error" ? (
                  <span className="translationError">{translationPopup.error}</span>
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {translationPopup.content}
                  </ReactMarkdown>
                )}
              </div>
            </div>
          </div>
        ) : null}

        <PdfLoader
          key={pdfUrl}
          url={pdfUrl}
          workerSrc={pdfWorkerUrl}
          beforeLoad={<div className="pdfState">Loading PDF</div>}
          errorMessage={<div className="pdfState error">PDF failed to load</div>}
        >
          {(pdfDocument) => (
            <>
              <PdfTextExtractor
                pdfDocument={pdfDocument}
                onTextReady={setPaperTextPages}
              />
              <PdfHighlighter
                pdfDocument={pdfDocument}
                pdfScaleValue={pdfScaleValue}
                enableAreaSelection={(event) => {
                  const target = event.target;
                  return (
                    event.altKey &&
                    target instanceof Element &&
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
                  const isAreaSelection = position.rects.length === 0;

                  if (isAreaSelection) {
                    suppressBlankClickUntilRef.current = Date.now() + 300;
                  }

                  if (isAreaSelection) {
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
                  _screenshot,
                  isScrolledTo,
                ) => {
                  const isTextHighlight = highlight.position.rects.length > 0;
                  const isAiContextHighlight = highlight.comment.text === "AI Context";
                  const removeContextHighlight = (event?: React.MouseEvent) => {
                    if (!isAiContextHighlight || (event && event.button !== 0)) {
                      return;
                    }

                    event?.stopPropagation();
                    event?.preventDefault();
                    setHighlightActionMenu(null);
                    setTranslationPopup((current) =>
                      current?.highlightIds.includes(highlight.id) ? null : current,
                    );
                    onRemoveContextHighlight(highlight.id);
                  };
                  const showHighlightMenu = (event: React.MouseEvent) => {
                    if (!isAiContextHighlight) {
                      return;
                    }

                    const translationTarget = getMergedTranslationTarget(
                      highlight.id,
                      highlights,
                    );
                    if (!translationTarget?.sourceText.trim()) {
                      return;
                    }

                    event.preventDefault();
                    event.stopPropagation();
                    setHighlightActionMenu({
                      anchor: getOverlayAnchor(
                        event.clientX,
                        event.clientY,
                        TRANSLATION_MENU_WIDTH,
                      ),
                      highlightId: highlight.id,
                      highlightIds: translationTarget.highlightIds,
                      pageNumber: translationTarget.pageNumber,
                      sourceText: translationTarget.sourceText,
                    });
                  };

                  const component = isTextHighlight ? (
                    <Highlight
                      isScrolledTo={isScrolledTo}
                      position={highlight.position}
                      comment={highlight.comment}
                      onClick={removeContextHighlight}
                      onContextMenu={showHighlightMenu}
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
                          {},
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
            </>
          )}
        </PdfLoader>
      </div>
    </section>
  );
}
