import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  AiMessage,
  AiContextItem,
  ModelConfig,
  PaperDocument,
  PaperTextPage,
  SvgFacet,
  VisualEdge,
  VisualDiagramType,
  VisualElement,
  VisualElementKind,
  VisualHtmlDemo,
  VisualMechanismBrief,
  VisualMechanismOperation,
  VisualMechanismRegion,
  VisualMechanismScene,
  VisualMechanismSceneKind,
  VisualMechanismStepSpec,
  VisualMechanismUnit,
  VisualMechanismUnitPlacement,
  VisualNode,
  VisualNodeTone,
  VisualParameter,
  VisualPrincipleAnnotation,
  VisualPrincipleDiagram,
  VisualPrincipleDiagramKind,
  VisualPrincipleRegion,
  VisualPrincipleRelation,
  VisualPrincipleRelationType,
  VisualSemanticFlow,
  VisualSemanticObject,
  VisualSemanticSpec,
  VisualSemanticTemplate,
  VisualSimulationModel,
  VisualSpec,
} from "../types";
import { log } from "../log";
import { makeId, parseModelJsonObject } from "../utils";
import {
  computeVisualSimulation,
  type VisualSimulationState,
} from "../visualSimulation";

interface VisualLabProps {
  contextItems: AiContextItem[];
  modelConfig: ModelConfig;
  paper: PaperDocument;
  paperTextPages: PaperTextPage[];
  specOverride?: VisualSpec;
  hideGenerate?: boolean;
}

type VisualViewMode = "structured" | "html" | "svg";
type VisualSpecBase = Omit<VisualSpec, "htmlDemo">;

const allowedKinds = new Set<VisualSpec["kind"]>([
  "concept-flow",
  "mechanism-animation",
  "equation-playground",
  "comparison",
  "architecture",
  "matrix",
  "geometry",
  "timeline",
]);
const allowedDiagramTypes = new Set<VisualDiagramType>([
  "structure",
  "mechanism",
  "equation",
  "matrix",
  "comparison",
  "timeline",
  "geometry",
]);
const allowedSemanticTemplates = new Set<VisualSemanticTemplate>([
  "memory-prefetch-pipeline",
  "memory-hierarchy",
  "attention-matrix",
  "model-architecture",
  "equation-transform",
  "comparison-tradeoff",
  "timeline-stage",
  "generic-mechanism",
]);
const allowedSimulationModels = new Set<VisualSimulationModel>([
  "generic-flow",
  "kv-cache-layout",
  "attention-flow",
  "memory-transfer",
  "pipeline",
]);
const allowedTones = new Set<VisualNodeTone>([
  "blue",
  "green",
  "amber",
  "rose",
  "neutral",
]);
const allowedElementKinds = new Set<VisualElementKind>([
  "rect",
  "circle",
  "text",
  "formula",
  "matrix",
  "layer",
  "bracket",
  "annotation",
  "bar",
  "axis",
  "arrow",
]);
const allowedSceneKinds = new Set<VisualMechanismSceneKind>([
  "layout-transform",
  "dataflow",
  "matrix-computation",
  "architecture-assembly",
  "state-transition",
  "comparison-mechanism",
  "geometric-process",
  "generic-mechanism",
]);
const allowedMechanismOperations = new Set<VisualMechanismOperation>([
  "move",
  "pair",
  "merge",
  "split",
  "reorder",
  "broadcast",
  "filter",
  "accumulate",
  "lookup",
  "transform",
  "compare",
  "compute",
]);
const allowedPrincipleDiagramKinds = new Set<VisualPrincipleDiagramKind>([
  "structure-map",
  "mechanism-map",
  "matrix-map",
  "equation-map",
  "comparison-map",
  "timeline-map",
  "geometry-map",
]);
const allowedPrincipleRelationTypes = new Set<VisualPrincipleRelationType>([
  "causes",
  "depends-on",
  "transfers",
  "transforms",
  "predicts",
  "compares",
  "contains",
]);

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const SCENE_CANVAS_WIDTH = 700;
const SCENE_CANVAS_HEIGHT = 360;

const clip = (text: string, maxLength: number) =>
  text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;

const safeString = (value: unknown, fallback: string, maxLength = 80) => {
  const text = typeof value === "string" ? value.trim() : "";
  return clip(text || fallback, maxLength);
};

const safeLongString = (value: unknown, fallback: string, maxLength = 30_000) => {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, maxLength);
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const scriptJson = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

const safeId = (value: unknown, fallback: string) => {
  const text = typeof value === "string" ? value.trim() : "";
  const normalized = text
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);

  return normalized || fallback;
};

const parameterDefaults = (parameters: VisualParameter[]) =>
  Object.fromEntries(
    parameters.map((parameter) => [parameter.id, parameter.defaultValue]),
  ) as Record<string, number>;

const nodeById = (nodes: VisualNode[], id: string) =>
  nodes.find((node) => node.id === id);

const normalizedValue = (
  parameter: VisualParameter,
  values: Record<string, number>,
) => {
  const value = values[parameter.id] ?? parameter.defaultValue;
  if (parameter.max === parameter.min) {
    return 0.5;
  }

  return clamp((value - parameter.min) / (parameter.max - parameter.min), 0, 1);
};

const elementParameterValue = (
  element: VisualElement,
  parameters: VisualParameter[],
  values: Record<string, number>,
) => {
  const parameter = element.parameterId
    ? parameters.find((item) => item.id === element.parameterId)
    : undefined;

  return parameter ? normalizedValue(parameter, values) : 0.5;
};

const clipContext = (text: string, maxLength: number) =>
  text.length > maxLength ? `${text.slice(0, maxLength).trim()}\n...` : text;

const buildPaperContextExcerpt = (
  paperTextPages: PaperTextPage[],
  pageNumber?: number,
) => {
  if (paperTextPages.length === 0) {
    return "No extracted paper text is available yet.";
  }

  const selectedPage = pageNumber
    ? paperTextPages.find((page) => page.pageNumber === pageNumber)
    : undefined;
  const neighborPages = pageNumber
    ? paperTextPages.filter(
        (page) =>
          page.pageNumber >= pageNumber - 1 && page.pageNumber <= pageNumber + 1,
      )
    : [];
  const firstPages = paperTextPages.slice(0, 2);
  const orderedPages = [
    ...(selectedPage ? [selectedPage] : []),
    ...neighborPages,
    ...firstPages,
  ].filter(
    (page, index, pages) =>
      pages.findIndex((item) => item.pageNumber === page.pageNumber) === index,
  );

  return clipContext(
    orderedPages
      .map((page) => `[Page ${page.pageNumber}]\n${page.text}`)
      .join("\n\n"),
    12_000,
  );
};

const buildVisualPrompt = ({
  activeContext,
  paper,
  paperContext,
}: {
  activeContext: AiContextItem;
  paper: PaperDocument;
  paperContext: string;
}) =>
  [
    "You generate safe interactive visualizations for PaperSuper.",
    "Return ONLY valid JSON. Do not wrap it in Markdown. Do not include comments.",
    "JSON validity is mandatory: every array/object element must be separated by commas, no trailing commas, no unescaped newlines inside strings, and all string values must use double quotes.",
    "The JSON must include ONLY the structured VisualSpec track. Do not include HTML, CSS, JavaScript, SVG markup, executable code, or htmlDemo in this JSON.",
    "PaperSuper will generate the interactive HTML/SVG/JS code in a separate raw-HTML step after this JSON is parsed.",
    "The JSON must match this TypeScript shape:",
    "{",
    '  "title": string,',
    '  "kind": "mechanism-animation" | "concept-flow" | "equation-playground" | "comparison" | "architecture" | "matrix" | "geometry" | "timeline",',
    '  "diagramType": "structure" | "mechanism" | "equation" | "matrix" | "comparison" | "timeline" | "geometry",',
    '  "diagramPurpose": string,',
    '  "readerTakeaway": string,',
    '  "semantic": {"template": "memory-prefetch-pipeline" | "memory-hierarchy" | "attention-matrix" | "model-architecture" | "equation-transform" | "comparison-tradeoff" | "timeline-stage" | "generic-mechanism", "problem": string, "mechanism": string[], "keyObjects": [{"id": string, "label": string, "role": string, "detail": string}], "flows": [{"from": string, "to": string, "label": string, "detail": string}], "takeaway": string},',
    '  "mechanismBrief": {"mechanismName": string, "coreProblem": string, "keyObjects": [{"id": string, "label": string, "role": string, "evidence": string}], "causalChain": string[], "learningGoal": string, "takeaway": string},',
    '  "principleDiagram": {"title": string, "diagramKind": "structure-map" | "mechanism-map" | "matrix-map" | "equation-map" | "comparison-map" | "timeline-map" | "geometry-map", "centralClaim": string, "regions": [{"id": string, "label": string, "role": string, "detail": string, "x": number, "y": number, "width": number, "height": number, "tone": "blue" | "green" | "amber" | "rose" | "neutral"}], "relations": [{"id": string, "from": string, "to": string, "label": string, "detail": string, "relationType": "causes" | "depends-on" | "transfers" | "transforms" | "predicts" | "compares" | "contains"}], "annotations": [{"id": string, "targetId": string, "label": string, "detail": string, "x": number, "y": number, "tone": "blue" | "green" | "amber" | "rose" | "neutral"}], "takeaway": string},',
    '  "scene": {"title": string, "sceneKind": "layout-transform" | "dataflow" | "matrix-computation" | "architecture-assembly" | "state-transition" | "comparison-mechanism" | "geometric-process" | "generic-mechanism", "purpose": string, "regions": [{"id": string, "label": string, "role": string, "x": number, "y": number, "width": number, "height": number, "tone": "blue" | "green" | "amber" | "rose" | "neutral"}], "units": [{"id": string, "label": string, "kind": string, "regionId": string, "lane": number, "index": number, "tone": "blue" | "green" | "amber" | "rose" | "neutral", "pairWith": string, "value": string, "detail": string}], "steps": [{"id": string, "title": string, "description": string, "operation": "move" | "pair" | "merge" | "split" | "reorder" | "broadcast" | "filter" | "accumulate" | "lookup" | "transform" | "compare" | "compute", "activeUnitIds": string[], "fromRegionId": string, "toRegionId": string, "resultUnitIds": string[], "placements": [{"unitId": string, "regionId": string, "lane": number, "index": number, "hidden": boolean}], "parameterEffects": string[]}], "takeaway": string},',
    '  "summary": string,',
    '  "nodes": [{"id": string, "label": string, "detail": string, "x": number, "y": number, "tone": "blue" | "green" | "amber" | "rose" | "neutral"}],',
    '  "edges": [{"id": string, "from": string, "to": string, "label": string, "strength": number}],',
    '  "visualElements": [{"id": string, "kind": "rect" | "circle" | "text" | "formula" | "matrix" | "layer" | "bracket" | "annotation" | "bar" | "axis" | "arrow", "label": string, "detail": string, "x": number, "y": number, "width": number, "height": number, "radius": number, "tone": "blue" | "green" | "amber" | "rose" | "neutral", "value": number, "rows": number, "cols": number, "cells": number[], "points": [{"x": number, "y": number}], "targetId": string, "parameterId": string}],',
    '  "parameters": [{"id": string, "label": string, "min": number, "max": number, "step": number, "defaultValue": number, "unit": string}],',
    '  "steps": [{"id": string, "title": string, "description": string, "focusNodeIds": string[], "focusElementIds": string[]}],',
    '  "simulation": {"model": "kv-cache-layout" | "attention-flow" | "memory-transfer" | "pipeline" | "generic-flow", "description": string}',
    "}",
    "",
    "Design requirements:",
    "- Convert the selected paper passage into a clear teaching diagram, not a decorative dashboard.",
    "- The reader should understand the core idea in 3 seconds: what objects exist, how they relate, and what changes.",
    "- All user-visible text should be Simplified Chinese, while important terms such as token, KV cache, GPU kernel, attention, softmax, query, key, value, interleaving should stay in English when clearer.",
    "- Choose the diagram form from the passage. Use structure for model/component architecture, mechanism for data transformation, matrix for attention/tensor/table mechanisms, equation for formulas, comparison for ablations/tradeoffs, geometry for spatial methods, and timeline for stages.",
    "- Set diagramPurpose to one plain Chinese sentence describing why this diagram exists.",
    "- Set readerTakeaway to one plain Chinese sentence the reader should remember after seeing the diagram.",
    "- Always fill semantic first. semantic is the source of truth; coordinates are secondary fallback data.",
    "- Always fill mechanismBrief. It must explain the mechanism before drawing: core problem, real objects, causal chain, and learning goal.",
    "- Always fill principleDiagram. It is the static principle image shown before animation. It must reveal structure and mechanism, not merely list steps.",
    "- Always fill scene. scene is the playable animation used by the local renderer. It must explain the mechanism with regions, tangible units, and step-by-step state changes.",
    "- The correct output order is: mechanismBrief -> principleDiagram -> scene -> parameters -> simulation.",
    "- Do not output only a flowchart. A flowchart says what happens next; scene must show how the structure changes internally.",
    "- principleDiagram should be a compact 原理图/结构图/示意图: use regions for real objects or substructures, relations for causal/transform/predict/transfer links, annotations for why each link matters.",
    "- principleDiagram.regions should be 3 to 6 major objects. Do not make regions named Step 1, Step 2, Step 3.",
    "- principleDiagram.relations must encode mechanism logic such as prediction, dependency, transformation, containment, transfer, comparison, or causal effect.",
    "- For each scene, identify concrete objects from the paper as units: tokens, KV blocks, matrix rows/columns, cache pages, modules, states, particles, features, queues, or equations. Avoid generic 'step 1' units.",
    "- Use regions to show before/action/after or source/operator/result. For structure papers, use regions for modules/layers/subsystems. For matrix papers, use regions for operands, score space, and output. For memory/layout papers, use regions for original layout, rearrangement, and optimized layout.",
    "- Steps must describe visible mechanism changes. Use operations such as pair, merge, split, reorder, lookup, compute, broadcast, or accumulate when appropriate.",
    "- If the selected passage is about KV cache interleaving/consolidation, scene must show separated K lane and V lane first, then token-wise K_i + V_i pairing, then compact [K_i|V_i] interleaved units. This is a structure/mechanism animation, not a left-to-right process chart.",
    "- If the selected passage is about speculative prefetching, principleDiagram must show history of KV block selections -> temporal locality predictor -> predicted critical KV blocks -> SSD/host transfer -> GPU memory before self-attention, including hit/miss intuition.",
    "- For any other paper topic, generalize the same idea: choose a visual metaphor that exposes the underlying mechanism, then animate the meaningful units as they combine, move, compare, split, or update.",
    "- scene.regions use the same 700 x 360 SVG canvas. Keep x/y/width/height inside the visible area and leave room for labels.",
    "- scene.units should include 6 to 14 units when the mechanism has repeated objects, so sliders and animation can visibly change density, focus, or speed.",
    "- scene.steps should have 3 to 5 teaching steps. placements are optional but useful to show units changing region/lane/index after each step.",
    "- Choose semantic.template from the mechanism, not from generic style. Use memory-prefetch-pipeline for SSD/host/GPU memory/KV cache prefetching; memory-hierarchy for cache/storage layers; attention-matrix for query/key/value attention weights; model-architecture for module structure; equation-transform for formula derivations; comparison-tradeoff for alternatives; timeline-stage for staged procedures.",
    "- semantic.keyObjects must contain the real objects in the paper, not generic 'Concept' placeholders.",
    "- semantic.flows must name the real transfer, dependency, prediction, or transformation between objects.",
    "- Nodes are only for essential objects. Use 3 to 5 nodes in most cases. Avoid naming every minor step as a node.",
    "- visualElements are for the explanatory drawing layer. Use them to draw the actual structure, matrix, tensor layout, equation schematic, comparison panel, or spatial layout.",
    "- Prefer one dominant diagram. Do not mix a flowchart, metrics dashboard, GPU timeline, cache blocks, and formula panel unless the passage explicitly needs all of them.",
    "- Coordinates use a 700 x 360 SVG canvas. Keep x between 70 and 630, y between 70 and 290.",
    "- visualElements also use the same 700 x 360 canvas. Keep elements within the visible canvas and avoid overlaps. Use width/height/radius appropriate to the kind.",
    "- Edges show data flow, dependency, transformation, or comparison. strength is 0.2 to 1.",
    "- Parameters must be meaningful knobs from the passage. Use 1 to 3 sliders only. If no meaningful parameter exists, use one gentle scale/emphasis slider.",
    "- Parameter changes should update the principle diagram and animation directly, such as matrix intensity, layer count, block count, predicted span, object size, highlighted region, occupancy, or latency hiding.",
    "- Parameter changes should also affect scene visually: visible unit count, spacing, animation speed, highlighted span, merge strength, or matrix density.",
    "- Steps must form a short explanation path. Use 2 to 4 steps and focus existing node ids and/or visualElement ids.",
    "- Avoid decorative grids, generic metrics, fake GPU utilization, moving packets, and unrelated performance cards unless they are directly required by the selected passage.",
    "- Keep labels compact. detail strings should be short.",
    "- Use inline SVG or ordinary HTML/CSS shapes; do not rely on external icon fonts or images.",
    "- Do not include htmlDemo. The later raw-HTML code-generation step will write the actual interactive SVG/HTML/JS visualization from this VisualSpec.",
    "",
    `Paper title: ${paper.title || "Untitled PDF"}`,
    `Selected page: ${activeContext.pageNumber || "unknown"}`,
    "Selected passage:",
    activeContext.text,
    "",
    "Paper context excerpt:",
    paperContext,
  ].join("\n");

const buildVisualHtmlPrompt = ({
  activeContext,
  paper,
  paperContext,
  spec,
}: {
  activeContext: AiContextItem;
  paper: PaperDocument;
  paperContext: string;
  spec: VisualSpec;
}) =>
  [
    // B 模式的核心：这里不是让模型返回 JSON，而是让模型直接写一段
    // 可运行的 HTML/SVG/JS 课件代码；后面会先做安全/完整性检查，再放进 iframe。
    "You are writing the visual code for PaperSuper Visual Lab.",
    "Return ONLY a self-contained HTML BODY fragment. Do not return JSON. Do not wrap in Markdown unless using a single ```html fenced block.",
    "The fragment may include inline <style>, ordinary HTML, inline <svg>, and inline <script>.",
    "The fragment must not include <!doctype>, <html>, <head>, <body>, external resources, images, web fonts, script src, fetch, WebSocket, import, eval, new Function, navigation, forms, localStorage, sessionStorage, or document.cookie.",
    "It runs inside iframe sandbox='allow-scripts' with no network access and no PaperSuper API access.",
    "Goal: AI writes nearly all visualization code. Make the visualization mechanism-first, not a flowchart.",
    "Layout: compact right-side panel, no hero banner, no oversized icons, no decorative dashboard.",
    "Required parts:",
    "- One dominant principle/mechanism drawing using SVG or DOM shapes.",
    "- 1 to 3 range sliders.",
    "- 2 to 3 live indicators.",
    "- A recalc() function. Every slider must call recalc(), and recalc() must visibly update geometry, highlights, metrics, or animation state.",
    "- A small step/takeaway line.",
    "If the mechanism is KV interleaving/consolidation, draw separated K cache and V cache rows on top, animated K_i/V_i pairing in the middle, and an interleaved [K_i|V_i] row on the bottom.",
    "For other mechanisms, choose an analogous structural animation: tensor reshape, attention matrix weighting, module assembly, state transition, geometric transform, memory transfer, or equation transformation.",
    "Use Simplified Chinese for UI text, but keep technical terms like token, KV cache, attention, softmax, query, key, value, GPU, interleaving when clearer.",
    "Keep all CSS scoped to this fragment. Avoid broad body styles except margin/font/background if needed.",
    "",
    `Paper title: ${paper.title || "Untitled PDF"}`,
    `Selected page: ${activeContext.pageNumber || "unknown"}`,
    "Selected passage:",
    activeContext.text,
    "",
    "Paper context excerpt:",
    paperContext,
    "",
    "Structured VisualSpec to implement as code:",
    JSON.stringify({
      title: spec.title,
      diagramType: spec.diagramType,
      diagramPurpose: spec.diagramPurpose,
      readerTakeaway: spec.readerTakeaway,
      semantic: spec.semantic,
      mechanismBrief: spec.mechanismBrief,
      principleDiagram: spec.principleDiagram,
      scene: spec.scene,
      summary: spec.summary,
      parameters: spec.parameters,
      steps: spec.steps,
      simulation: spec.simulation,
    }),
  ].join("\n");

const extractHtmlFragment = (text: string) => {
  // 兼容模型直接返回 HTML 或 ```html 代码块；这里仅做外壳剥离，
  // 真正的“能不能展示”交给 normalizeHtmlDemo 和 iframe sandbox 决定。
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  if (!candidate) {
    throw new Error("AI 没有返回 HTML 可视化代码。");
  }

  return candidate
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\/?html[^>]*>/gi, "")
    .replace(/<\/?head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<\/?body[^>]*>/gi, "")
    .trim();
};

// --- SVG Diagram Track ---

const SVG_MAX_LENGTH = 120_000;

const SVG_ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "rect",
  "circle",
  "ellipse",
  "path",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "pattern",
  "marker",
  "filter",
  "feGaussianBlur",
  "feMerge",
  "feMergeNode",
  "feDropShadow",
  "feColorMatrix",
  "feFlood",
  "feComposite",
  "clipPath",
  "mask",
  "use",
  "symbol",
  "title",
  "desc",
  "switch",
  "a",
]);

const SVG_ALLOWED_ATTRS = new Set([
  "xmlns",
  "xmlns:xlink",
  "viewbox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "transform",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "text-decoration",
  "letter-spacing",
  "word-spacing",
  "alignment-baseline",
  "baseline-shift",
  "dx",
  "dy",
  "rotate",
  "textLength",
  "lengthadjust",
  "startoffset",
  "method",
  "spacing",
  "href",
  "xlink:href",
  "type",
  "result",
  "in",
  "in2",
  "stddeviation",
  "values",
  "gradientunits",
  "gradienttransform",
  "spreadmethod",
  "offset",
  "stop-color",
  "stop-opacity",
  "patternunits",
  "patterntransform",
  "markerwidth",
  "markerheight",
  "refx",
  "refy",
  "orient",
  "markerunits",
  "marker-end",
  "marker-start",
  "marker-mid",
  "fill-rule",
  "clip-rule",
  "vector-effect",
  "shape-rendering",
  "clip-path",
  "clippathunits",
  "maskunits",
  "maskcontentunits",
  "flood-color",
  "flood-opacity",
  "operator",
  "k1",
  "k2",
  "k3",
  "k4",
  "display",
  "visibility",
  "overflow",
  "color",
  "cursor",
  "filter",
  "mask",
  "clip-path",
  "id",
  "class",
  "style",
  "preserveaspectratio",
  "version",
  "baseprofile",
  "role",
  "aria-label",
]);

/** Fix common AI-generated SVG issues that break strict XML parsing. */
const preprocessSvgForXml = (svg: string): string => {
  let result = svg;

  // Replace HTML entities that are invalid in XML
  result = result.replace(/&nbsp;/gi, "&#160;");
  result = result.replace(/&mdash;/gi, "&#8212;");
  result = result.replace(/&ndash;/gi, "&#8211;");
  result = result.replace(/&lsquo;/gi, "&#8216;");
  result = result.replace(/&rsquo;/gi, "&#8217;");
  result = result.replace(/&ldquo;/gi, "&#8220;");
  result = result.replace(/&rdquo;/gi, "&#8221;");
  result = result.replace(/&hellip;/gi, "&#8230;");
  result = result.replace(/&copy;/gi, "&#169;");
  result = result.replace(/&reg;/gi, "&#174;");
  result = result.replace(/&trade;/gi, "&#8482;");

  // Escape bare & that is not already an XML entity or numeric reference
  // Matches & not followed by: valid entity name + ; or # + digits + ;
  result = result.replace(/&(?!#[0-9]+;|#x[0-9a-fA-F]+;|[a-zA-Z][a-zA-Z0-9]*;)/g, "&amp;");

  // Remove XML/DOCTYPE declarations that AI sometimes adds
  result = result.replace(/<\?xml[^>]*\?>/gi, "");
  result = result.replace(/<!DOCTYPE[^>]*>/gi, "");

  return result;
};

const SVG_EVENT_ATTR_RE =
  /^on[a-z]|^xmlns:xlink$|^data-|^aria-|^tabindex|^focusable/i;

const sanitizeSvg = (raw: string): string | null => {
  if (!raw || raw.length > SVG_MAX_LENGTH) {
    if (raw && raw.length > SVG_MAX_LENGTH) {
      log.warn("SVG", "SVG rejected: too large", { length: raw.length, max: SVG_MAX_LENGTH });
    }
    return null;
  }

  const trimmed = preprocessSvgForXml(raw.trim());
  if (!/<svg[\s>]/i.test(trimmed)) {
    log.warn("SVG", "SVG rejected: no <svg> element found");
    return null;
  }

  try {
    // Extract just the <svg>...</svg> to avoid double-wrapping
    const svgOnlyMatch = trimmed.match(/<svg[\s\S]*<\/svg>/i);
    const svgSource = svgOnlyMatch ? svgOnlyMatch[0] : trimmed;

    // Ensure xmlns is present for standalone parsing
    const withNs = svgSource.includes("xmlns=")
      ? svgSource
      : svgSource.replace(/<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');

    const parser = new DOMParser();
    const doc = parser.parseFromString(withNs, "image/svg+xml");
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      const errorText = parseError.textContent?.slice(0, 200) ?? "unknown";
      log.warn("SVG", "SVG rejected: XML parse error", { detail: errorText });
      return null;
    }

    const innerSvg = doc.documentElement;
    if (!innerSvg || innerSvg.tagName.toLowerCase() !== "svg") {
      log.warn("SVG", "SVG rejected: no <svg> element after parse");
      return null;
    }

    let removedElements = 0;
    let removedAttrs = 0;

    const walkAndClean = (node: Element) => {
      const tagName = node.tagName.toLowerCase();
      if (!SVG_ALLOWED_ELEMENTS.has(tagName)) {
        removedElements++;
        node.remove();
        return;
      }

      const attrsToRemove: string[] = [];
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase();
        if (
          SVG_EVENT_ATTR_RE.test(name) ||
          (!SVG_ALLOWED_ATTRS.has(name) && !name.startsWith("aria-") && !name.startsWith("data-"))
        ) {
          attrsToRemove.push(attr.name);
        }
      }
      for (const name of attrsToRemove) {
        removedAttrs++;
        node.removeAttribute(name);
      }

      if (tagName === "a") {
        const href = node.getAttribute("href") || node.getAttribute("xlink:href") || "";
        if (
          href.startsWith("javascript:") ||
          href.startsWith("data:text/html") ||
          href.includes("://")
        ) {
          node.removeAttribute("href");
          node.removeAttribute("xlink:href");
        }
      }
    };

    const allElements = innerSvg.querySelectorAll("*");
    for (let i = allElements.length - 1; i >= 0; i--) {
      walkAndClean(allElements[i]);
    }

    const serializer = new XMLSerializer();
    const result = serializer.serializeToString(innerSvg);

    if (result.length > SVG_MAX_LENGTH) {
      log.warn("SVG", "SVG rejected: sanitized result too large", { length: result.length });
      return null;
    }

    log.debug("SVG", "SVG sanitized OK", {
      inputLen: raw.length,
      outputLen: result.length,
      removedElements,
      removedAttrs,
    });
    return result;
  } catch (error) {
    log.warn("SVG", "SVG rejected: exception during sanitize", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const extractSvgDiagram = (text: string): string | null => {
  const fenced = text.match(/```(?:svg)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  if (!candidate) {
    return null;
  }
  const svgMatch = candidate.match(/<svg[\s\S]*<\/svg>/i);
  return sanitizeSvg(svgMatch ? svgMatch[0] : candidate);
};

const buildSvgExplanationPrompt = ({
  activeContext,
  paper,
  paperContext,
  spec,
}: {
  activeContext: AiContextItem;
  paper: PaperDocument;
  paperContext: string;
  spec: VisualSpec;
}) =>
  [
    "You are a scientific principle explainer for PaperSuper, a PDF research IDE.",
    "Your job is to write a clear, structured explanation of a principle diagram AND the underlying technical concept from the paper.",
    "Write in Markdown format. Use Simplified Chinese for explanations, keep English for technical terms.",
    "",
    "## Output Structure",
    "",
    "Your response MUST follow this exact structure with these three H2 sections:",
    "",
    "### Section 1: 图解说明",
    "Explain what the diagram shows:",
    "- What each major region/area represents (e.g. off-chip memory, on-chip compute, GPU HBM)",
    "- What the arrows and data flows mean (solid = primary flow, dashed = secondary/cached, dotted = control signal)",
    "- What the color coding signifies (red = bottleneck, green = optimized, blue = information, amber = cache/memory)",
    "- Key quantitative annotations if present (dimensions, bandwidths, latencies)",
    "- The metric panel or summary box contents",
    "",
    "### Section 2: 核心原理",
    "Explain the underlying technical principle in accessible language:",
    "- What problem does this mechanism solve?",
    "- How does it work step by step?",
    "- What are the key objects/concepts involved and how do they interact?",
    "- What is the insight or innovation compared to naive approaches?",
    "",
    "### Section 3: 关键要点",
    "Summarize as 3-5 bullet points:",
    "- Each point should be one concise sentence",
    "- Focus on the most important takeaways a reader should remember",
    "- Include quantitative details where available",
    "",
    "## Writing Guidelines",
    "",
    "- Be precise and technical, but explain concepts clearly",
    "- Use analogies sparingly and only when they genuinely help",
    "- Reference specific elements from the diagram when explaining",
    "- Keep the total response under 800 words",
    "- Use Markdown formatting: ## headers, - bullet points, **bold** for emphasis, `code` for technical terms",
    "",
    `Paper title: ${paper.title || "Untitled PDF"}`,
    `Selected page: ${activeContext.pageNumber || "unknown"}`,
    "Selected passage:",
    activeContext.text,
    "",
    "Paper context excerpt:",
    paperContext,
    "",
    "Structured diagram data for reference:",
    JSON.stringify({
      title: spec.title,
      diagramType: spec.diagramType,
      diagramPurpose: spec.diagramPurpose,
      readerTakeaway: spec.readerTakeaway,
      mechanismBrief: spec.mechanismBrief,
      principleDiagram: spec.principleDiagram,
      scene: spec.scene,
      summary: spec.summary,
    }),
  ].join("\n");

const buildSvgFacetsPrompt = ({
  activeContext,
  paper,
  paperContext,
  spec,
}: {
  activeContext: AiContextItem;
  paper: PaperDocument;
  paperContext: string;
  spec: VisualSpec;
}) =>
  [
    "You are a scientific illustration planner for PaperSuper, a PDF research IDE.",
    "Analyze the paper concept below and identify 3-4 DISTINCT visual facets (aspects) that would each benefit from a separate, focused SVG diagram.",
    "Return ONLY a JSON array. No Markdown fencing, no explanation text.",
    "",
    "## Output Format",
    "",
    'Return a JSON array: `[{"title": "...", "focus": "..."}, ...]`',
    "- title: short Chinese label for the tab (2-4 chars, e.g. '整体架构', '数据流', '性能瓶颈', '计算过程')",
    "- focus: one-sentence description of what this facet's SVG should depict",
    "",
    "## Guidelines",
    "",
    "- Each facet should be a DISTINCT perspective on the same concept, not overlapping views",
    "- Facet 1 should be the 'big picture' / structural overview",
    "- Other facets should zoom into specific mechanisms, data flows, performance trade-offs, or mathematical relationships",
    "- Order from most宏观 to most微观",
    "- Use Chinese for titles, English for technical terms in focus descriptions",
    "",
    `Paper title: ${paper.title || "Untitled PDF"}`,
    `Selected page: ${activeContext.pageNumber || "unknown"}`,
    "Selected passage:",
    activeContext.text,
    "",
    "Paper context excerpt:",
    paperContext,
    "",
    "Structured data for reference:",
    JSON.stringify({
      title: spec.title,
      diagramType: spec.diagramType,
      diagramPurpose: spec.diagramPurpose,
      readerTakeaway: spec.readerTakeaway,
      mechanismBrief: spec.mechanismBrief,
      principleDiagram: spec.principleDiagram,
      scene: spec.scene,
      summary: spec.summary,
    }),
  ].join("\n");

const buildFacetSvgPrompt = ({
  activeContext,
  paper,
  paperContext,
  spec,
  facetTitle,
  facetFocus,
  facetIndex,
  totalFacets,
}: {
  activeContext: AiContextItem;
  paper: PaperDocument;
  paperContext: string;
  spec: VisualSpec;
  facetTitle: string;
  facetFocus: string;
  facetIndex: number;
  totalFacets: number;
}) =>
  [
    "You are a scientific illustration engine for PaperSuper, a PDF research IDE.",
    `Generate a SINGLE inline <svg> element that serves as a focused diagram for the "${facetTitle}" facet of a paper concept.`,
    "Return ONLY the <svg>...</svg> element. No JSON, no Markdown fencing, no explanation text outside the SVG.",
    "",
    `## Facet Focus (facet ${facetIndex + 1} of ${totalFacets})`,
    "",
    `**Title:** ${facetTitle}`,
    `**Focus:** ${facetFocus}`,
    "",
    "Your diagram should ONLY depict the aspect described above. Do NOT try to show everything — go deep on this one facet.",
    "",
    "## Design Principles",
    "",
    "1. SPATIAL SEMANTICS — use contrasting fill colors and bordered regions to represent physical or logical boundaries.",
    "2. NESTED CONTAINMENT — if a concept belongs to a larger structure, place it inside a larger bordered region.",
    "3. MULTIPLE ARROW STYLES — use different colors, dash patterns, and stroke widths to distinguish data flows:",
    "   • solid bold arrow = primary data flow",
    "   • dashed arrow = secondary / cached / broadcast flow",
    "   • dotted thin arrow = information / control signal",
    "   • color: red tones for bottleneck/waste, green for optimized path, blue for information, amber for cache/memory",
    "4. QUANTITATIVE ANNOTATIONS — include concrete numbers where available.",
    "5. TEXT LABELS — place descriptive labels directly adjacent to elements. Use both English and Chinese where helpful.",
    "6. GRADIENT AND DEPTH — use subtle linearGradient fills on background regions to suggest layering.",
    "7. TENSOR SHAPES — draw tensors/matrices as nested rectangles with shape annotations like [B, T, H].",
    "8. CLEAN COMPOSITION — leave adequate spacing. The diagram should look like a published paper figure.",
    "",
    "## SVG Conventions",
    "",
    "- Use viewBox to define your coordinate space (typical: 960x540 or 1200x700).",
    "- Use <defs> for reusable gradients, markers (arrowheads), and filters.",
    "- Use <marker> for arrowheads with ids like 'arrowHead', 'arrowRed', 'arrowGreen'.",
    "- Use font-family='system-ui, sans-serif' for clean text rendering.",
    "- Keep total SVG under 80KB. Prefer clean geometry over excessive path data.",
    "- Use Chinese for explanatory labels. Keep English for technical terms.",
    "",
    `Paper title: ${paper.title || "Untitled PDF"}`,
    `Selected page: ${activeContext.pageNumber || "unknown"}`,
    "Selected passage:",
    activeContext.text,
    "",
    "Paper context excerpt:",
    paperContext,
    "",
    "Structured data for reference:",
    JSON.stringify({
      title: spec.title,
      diagramType: spec.diagramType,
      diagramPurpose: spec.diagramPurpose,
      readerTakeaway: spec.readerTakeaway,
      mechanismBrief: spec.mechanismBrief,
      principleDiagram: spec.principleDiagram,
      scene: spec.scene,
      summary: spec.summary,
    }),
  ].join("\n");

// HTML/JS 轨道只进入 iframe sandbox；这里的 fallback 也保持自包含，方便和结构化轨道对比效果。
const isKvInterleavingSpec = (spec: VisualSpecBase) => {
  const sourceText = [
    spec.title,
    spec.summary,
    spec.diagramPurpose,
    spec.readerTakeaway,
    spec.semantic?.template,
    spec.semantic?.problem,
    spec.semantic?.takeaway,
    spec.mechanismBrief?.mechanismName,
    spec.mechanismBrief?.coreProblem,
    spec.mechanismBrief?.takeaway,
    spec.scene?.title,
    spec.scene?.purpose,
    spec.scene?.takeaway,
    ...(spec.semantic?.mechanism ?? []),
    ...(spec.semantic?.keyObjects.map((object) => object.label) ?? []),
    ...(spec.semantic?.flows.map((flow) => `${flow.label} ${flow.detail ?? ""}`) ?? []),
    ...(spec.scene?.regions.map((region) => `${region.label} ${region.role}`) ?? []),
    ...(spec.scene?.units.map((unit) => `${unit.label} ${unit.kind} ${unit.detail}`) ?? []),
  ].join(" ");

  return (
    /\bkv\b|key\s*cache|value\s*cache|k\s*cache|v\s*cache/i.test(sourceText) &&
    /interleav|interleave|consolidat|token-wise|tokenwise|交错|交替|合并|整合|重排|布局/i.test(sourceText)
  );
};

const createKvInterleavingHtmlDemo = (spec: VisualSpecBase): VisualHtmlDemo => {
  const title = spec.mechanismBrief?.mechanismName || spec.title || "KV interleaving";
  const takeaway =
    spec.readerTakeaway ||
    spec.mechanismBrief?.takeaway ||
    "把同一 token 的 K 和 V 放到相邻位置后，读取时可以一次拿到一对 KV，减少分离访问带来的等待。";

  return {
    title: `${title} 机制动图`,
    notes: "本地 KV 交错布局课件：滑条会实时改变 token 数、合并粒度和动画速度。",
    html: `
      <style>
        :root { color-scheme: dark; font-family: Inter, "Microsoft YaHei", system-ui, sans-serif; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #e9eef6; background: #101318; }
        .kvLesson { display: grid; gap: 9px; min-height: 100vh; padding: 10px; background: #101318; }
        .top { display: grid; gap: 4px; padding-bottom: 2px; }
        h1 { margin: 0; color: #f7f9fc; font-size: 14px; line-height: 1.25; font-weight: 850; }
        .idea { margin: 0; color: #aeb8c8; font-size: 11px; line-height: 1.4; }
        .stage { padding: 8px; border: 1px solid #262d38; border-radius: 8px; background: #0d1015; overflow: hidden; }
        svg { display: block; width: 100%; height: 276px; }
        .rowTitle { fill: #b5c0cf; font-size: 10px; font-weight: 800; }
        .smallText { fill: #8390a3; font-size: 9px; font-weight: 700; }
        .label { fill: #eef3fb; font-size: 10px; font-weight: 850; pointer-events: none; }
        .cacheFrame { fill: #111821; stroke: #2a3442; stroke-width: 1; }
        .kBlock { fill: #2f6feb; stroke: #72a1ff; }
        .vBlock { fill: #23a66f; stroke: #74dfae; }
        .pairBlock { fill: #17221f; stroke: #56c08d; }
        .inactive { opacity: .32; }
        .active { filter: drop-shadow(0 0 7px rgba(86,192,141,.8)); opacity: 1; }
        .ghostK { fill: #2f6feb; opacity: .78; }
        .ghostV { fill: #23a66f; opacity: .78; }
        .arrow { fill: none; stroke: #667386; stroke-width: 1.3; marker-end: url(#arrow); }
        .arrow.active { stroke: #56c08d; stroke-width: 2; }
        .bracket { fill: none; stroke: #56c08d; stroke-width: 1.6; stroke-dasharray: 4 3; }
        .controls { display: grid; gap: 6px; }
        .control { display: grid; grid-template-columns: 72px minmax(64px, 1fr) 42px; gap: 7px; align-items: center; padding: 6px; border: 1px solid #252c36; border-radius: 7px; background: #12171f; }
        .control span, .control b { overflow: hidden; font-size: 10px; white-space: nowrap; text-overflow: ellipsis; }
        .control span { color: #c2cad6; font-weight: 760; }
        .control b { color: #56c08d; text-align: right; }
        input { width: 100%; accent-color: #56c08d; }
        .metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
        .metric { min-width: 0; padding: 7px; border: 1px solid #252c36; border-radius: 7px; background: #12171f; }
        .metric span { display: block; overflow: hidden; color: #8f9bad; font-size: 9px; white-space: nowrap; text-overflow: ellipsis; }
        .metric strong { display: block; margin-top: 2px; color: #f1f5fb; font-size: 12px; }
        .stepLine { margin: 0; min-height: 30px; padding: 7px 8px; border: 1px solid rgba(86,192,141,.25); border-radius: 7px; color: #c8d1dd; background: #101a17; font-size: 11px; line-height: 1.42; }
        @media (max-width: 520px) {
          .metrics { grid-template-columns: 1fr; }
          .control { grid-template-columns: 64px minmax(60px, 1fr) 38px; }
        }
      </style>
      <div class="kvLesson">
        <section class="top">
          <h1>${escapeHtml(title)}</h1>
          <p class="idea">${escapeHtml(takeaway)}</p>
        </section>
        <section class="stage">
          <svg viewBox="0 0 760 300" role="img" aria-label="KV interleaving mechanism animation">
            <defs>
              <marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                <path d="M 0 0 L 7 3.5 L 0 7 z" fill="#667386"></path>
              </marker>
            </defs>
            <text class="rowTitle" x="24" y="30">原始布局：K cache 与 V cache 分开存储</text>
            <text class="rowTitle" x="24" y="184">优化布局：按 token 交错为 [K_i | V_i]</text>
            <g id="sourceLayer"></g>
            <g id="motionLayer"></g>
            <g id="targetLayer"></g>
            <text class="smallText" id="hintText" x="24" y="282">拖动参数观察交错粒度和访问次数变化</text>
          </svg>
        </section>
        <div class="metrics">
          <div class="metric"><span>分离读取</span><strong id="metricSeparate">0 ops</strong></div>
          <div class="metric"><span>交错读取</span><strong id="metricInterleaved">0 ops</strong></div>
          <div class="metric"><span>I/O 减少</span><strong id="metricSaved">0%</strong></div>
        </div>
        <div class="controls">
          <label class="control"><span>token 数</span><input id="tokenCount" type="range" min="4" max="14" step="1" value="8"><b id="tokenValue">8</b></label>
          <label class="control"><span>合并粒度</span><input id="groupSize" type="range" min="1" max="4" step="1" value="2"><b id="groupValue">2</b></label>
          <label class="control"><span>动画速度</span><input id="speed" type="range" min="1" max="5" step="1" value="3"><b id="speedValue">3</b></label>
        </div>
        <p class="stepLine" id="stepText"></p>
      </div>
      <script>
        let phase = 0;
        let active = 0;
        const sourceLayer = document.querySelector('#sourceLayer');
        const motionLayer = document.querySelector('#motionLayer');
        const targetLayer = document.querySelector('#targetLayer');
        const tokenInput = document.querySelector('#tokenCount');
        const groupInput = document.querySelector('#groupSize');
        const speedInput = document.querySelector('#speed');
        const tokenValue = document.querySelector('#tokenValue');
        const groupValue = document.querySelector('#groupValue');
        const speedValue = document.querySelector('#speedValue');
        const stepText = document.querySelector('#stepText');

        function esc(text) {
          return String(text || '').replace(/[&<>]/g, function(char) {
            return char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&gt;';
          });
        }
        function rect(x, y, w, h, cls, label) {
          return '<g><rect class="' + cls + '" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="5"></rect><text class="label" x="' + (x + w / 2) + '" y="' + (y + h / 2 + 3) + '" text-anchor="middle">' + esc(label) + '</text></g>';
        }
        function pairRect(x, y, w, h, i, cls) {
          const half = w / 2;
          return '<g class="' + cls + '">' +
            '<rect class="pairBlock" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="6"></rect>' +
            '<rect class="kBlock" x="' + (x + 3) + '" y="' + (y + 4) + '" width="' + (half - 5) + '" height="' + (h - 8) + '" rx="4"></rect>' +
            '<rect class="vBlock" x="' + (x + half + 2) + '" y="' + (y + 4) + '" width="' + (half - 5) + '" height="' + (h - 8) + '" rx="4"></rect>' +
            '<text class="label" x="' + (x + half - 7) + '" y="' + (y + h / 2 + 3) + '" text-anchor="middle">K' + i + '</text>' +
            '<text class="label" x="' + (x + half + 16) + '" y="' + (y + h / 2 + 3) + '" text-anchor="middle">V' + i + '</text>' +
          '</g>';
        }
        function recalc() {
          const n = Number(tokenInput.value);
          const group = Number(groupInput.value);
          const speed = Number(speedInput.value);
          tokenValue.textContent = String(n);
          groupValue.textContent = String(group);
          speedValue.textContent = String(speed);

          const left = 104;
          const usable = 610;
          const gap = Math.max(4, 12 - n / 2);
          const blockW = Math.max(28, Math.min(52, (usable - gap * (n - 1)) / n));
          const blockH = 28;
          const activeIndex = active % n;
          let source = '<text class="smallText" x="26" y="70">K row</text><text class="smallText" x="26" y="116">V row</text>';
          source += '<rect class="cacheFrame" x="96" y="48" width="626" height="90" rx="8"></rect>';
          for (let i = 0; i < n; i += 1) {
            const x = left + i * (blockW + gap);
            const hot = Math.floor(i / group) === Math.floor(activeIndex / group);
            source += rect(x, 60, blockW, blockH, 'kBlock ' + (hot ? 'active' : 'inactive'), 'K' + (i + 1));
            source += rect(x, 104, blockW, blockH, 'vBlock ' + (hot ? 'active' : 'inactive'), 'V' + (i + 1));
            if (hot) {
              source += '<path class="arrow active" d="M ' + (x + blockW / 2) + ' 91 L ' + (x + blockW / 2) + ' 104"></path>';
            }
          }
          sourceLayer.innerHTML = source;

          const targetY = 210;
          const pairW = Math.max(44, Math.min(72, blockW * 1.42));
          const pairGap = Math.max(4, gap - 2);
          let target = '<rect class="cacheFrame" x="96" y="196" width="626" height="48" rx="8"></rect>';
          for (let i = 0; i < n; i += 1) {
            const x = left + i * (pairW + pairGap) * Math.min(1, 626 / (n * (pairW + pairGap))) ;
            const cls = i <= activeIndex ? 'active' : 'inactive';
            target += pairRect(x, targetY, pairW, 24, i + 1, cls);
          }
          target += '<path class="bracket" d="M 104 252 H 694"></path>';
          target += '<text class="smallText" x="318" y="269">连续读取时，K_i 与 V_i 相邻，访问路径更短</text>';
          targetLayer.innerHTML = target;

          const srcX = left + activeIndex * (blockW + gap);
          const progress = (phase % 100) / 100;
          const moveY = 144 + progress * 54;
          const wave = Math.sin(progress * Math.PI) * 20;
          motionLayer.innerHTML =
            '<path class="arrow active" d="M ' + (srcX + blockW / 2) + ' 136 C ' + (srcX + blockW / 2) + ' 160, ' + (srcX + blockW / 2 + wave) + ' 176, ' + (srcX + blockW / 2) + ' 202"></path>' +
            rect(srcX - 2 - wave / 3, moveY, blockW, 23, 'ghostK active', 'K' + (activeIndex + 1)) +
            rect(srcX + 8 + wave / 3, moveY + 23, blockW, 23, 'ghostV active', 'V' + (activeIndex + 1));

          const separateOps = n * 2;
          const interleavedOps = Math.ceil(n / group);
          const saved = Math.max(0, Math.round((1 - interleavedOps / separateOps) * 100));
          document.querySelector('#metricSeparate').textContent = separateOps + ' ops';
          document.querySelector('#metricInterleaved').textContent = interleavedOps + ' ops';
          document.querySelector('#metricSaved').textContent = saved + '%';
          document.querySelector('#hintText').textContent = '当前高亮 token ' + (activeIndex + 1) + '：把 K' + (activeIndex + 1) + ' 与 V' + (activeIndex + 1) + ' 写到相邻位置';
          stepText.textContent = '机制：原始布局要分别访问 K row 和 V row；交错布局把同一 token 的 K/V 合成紧邻数据单元，读取 attention 所需 KV 时更接近顺序访问。';
        }
        [tokenInput, groupInput, speedInput].forEach(function(input) {
          input.addEventListener('input', recalc);
        });
        recalc();
        setInterval(function() {
          const speed = Number(speedInput.value);
          phase = (phase + 6 + speed * 2) % 100;
          if (phase < 8) {
            active = (active + 1) % Number(tokenInput.value);
          }
          recalc();
        }, 90);
      </script>
    `,
  };
};

const createFallbackHtmlDemo = (spec: VisualSpecBase): VisualHtmlDemo => {
  const sourceText = [
    spec.title,
    spec.summary,
    spec.diagramPurpose,
    spec.readerTakeaway,
    spec.semantic?.template,
    spec.semantic?.problem,
  ].join(" ");

  if (isKvInterleavingSpec(spec)) {
    return createKvInterleavingHtmlDemo(spec);
  }

  const lessonKind = /ssd|gpu|kv|cache|prefetch|memory|缓存|预取|显存|存储/i.test(sourceText)
    ? "memory"
    : /attention|query|key|value|softmax|token|注意力/i.test(sourceText)
      ? "attention"
      : /compare|tradeoff|ablation|baseline|对比|权衡|消融/i.test(sourceText)
        ? "comparison"
        : /architecture|module|layer|component|结构|模块|层/i.test(sourceText)
          ? "architecture"
          : "generic";
  const fallbackParameters =
    spec.parameters.length >= 2
      ? spec.parameters.slice(0, 4)
      : [
          ...spec.parameters,
          {
            id: "visualIntensity",
            label: "机制强度",
            min: 1,
            max: 10,
            step: 1,
            defaultValue: 6,
          },
          {
            id: "scenarioScale",
            label: "规模",
            min: 1,
            max: 10,
            step: 1,
            defaultValue: 5,
          },
        ].slice(0, 4);
  const modules =
    spec.principleDiagram?.regions.length
      ? spec.principleDiagram.regions.slice(0, 5).map((region) => ({
          id: region.id,
          label: region.label,
          role: region.role,
          detail: region.detail ?? region.role,
          tone: region.tone ?? "neutral",
        }))
      : spec.semantic?.keyObjects.length
        ? spec.semantic.keyObjects.slice(0, 5).map((object, index) => ({
            id: object.id,
            label: object.label,
            role: object.role,
            detail: object.detail ?? object.role,
            tone: semanticObjectTone(index),
          }))
        : spec.nodes.slice(0, 5).map((node) => ({
            id: node.id,
            label: node.label,
            role: node.detail,
            detail: node.detail,
            tone: node.tone,
          }));
  const moduleFallbacks = {
    memory: [
      { id: "history", label: "历史KV选择", role: "时间局部性来源", detail: "记录近期被访问的KV blocks", tone: "blue" },
      { id: "predictor", label: "预测器", role: "决策核心", detail: "从历史中预测关键KV blocks", tone: "green" },
      { id: "ssd", label: "SSD存储", role: "完整KV cache", detail: "容量大但读取慢", tone: "amber" },
      { id: "gpu", label: "GPU显存", role: "目标缓存", detail: "attention计算前准备数据", tone: "rose" },
      { id: "attention", label: "self-attention", role: "计算消费方", detail: "命中则隐藏等待", tone: "neutral" },
    ],
    attention: [
      { id: "tokens", label: "Tokens", role: "上下文输入", detail: "提供Q/K/V来源", tone: "blue" },
      { id: "query", label: "Query", role: "当前请求", detail: "决定关注目标", tone: "green" },
      { id: "matrix", label: "attention矩阵", role: "相关性分布", detail: "softmax后形成权重", tone: "amber" },
      { id: "value", label: "Value混合", role: "加权聚合", detail: "按权重合成输出", tone: "rose" },
      { id: "output", label: "输出表示", role: "上下文表达", detail: "进入后续层", tone: "neutral" },
    ],
    comparison: [
      { id: "baseline", label: "已有方案", role: "对照路径", detail: "暴露原始瓶颈", tone: "blue" },
      { id: "method", label: "论文方案", role: "改进机制", detail: "改变关键约束", tone: "green" },
      { id: "bottleneck", label: "瓶颈", role: "主要限制", detail: "延迟/吞吐/内存占用", tone: "amber" },
      { id: "scenario", label: "应用场景", role: "适用条件", detail: "不同场景效果不同", tone: "rose" },
      { id: "result", label: "结论", role: "收益与代价", detail: "形成判断标准", tone: "neutral" },
    ],
    architecture: [
      { id: "input", label: "输入", role: "数据入口", detail: "进入模型结构", tone: "blue" },
      { id: "module", label: "核心模块", role: "机制主体", detail: "完成关键变换", tone: "green" },
      { id: "state", label: "中间状态", role: "结构表征", detail: "承载计算结果", tone: "amber" },
      { id: "head", label: "输出头", role: "任务映射", detail: "产生最终结果", tone: "rose" },
    ],
    generic: [
      { id: "problem", label: "问题", role: "需要解决", detail: "论文片段的核心矛盾", tone: "blue" },
      { id: "mechanism", label: "机制", role: "处理方式", detail: "关键对象相互作用", tone: "green" },
      { id: "state", label: "状态变化", role: "动态过程", detail: "对象被移动/组合/更新", tone: "amber" },
      { id: "effect", label: "效果", role: "最终收益", detail: "解释为什么有效", tone: "rose" },
    ],
  };
  const teachingModules =
    modules.length >= 3 ? modules : moduleFallbacks[lessonKind];
  const relations =
    spec.principleDiagram?.relations.length
      ? spec.principleDiagram.relations.slice(0, 6).map((relation) => relation.label)
      : spec.semantic?.flows.length
        ? spec.semantic.flows.slice(0, 6).map((flow) => flow.label)
        : ["观察历史", "预测关键对象", "提前准备", "降低等待"];
  const teachingSteps =
    spec.scene?.steps.length
      ? spec.scene.steps.slice(0, 5).map((step) => ({
          title: step.title,
          description: step.description,
        }))
      : spec.steps.slice(0, 5).map((step) => ({
          title: step.title,
          description: step.description,
        }));
  const finalSteps =
    teachingSteps.length >= 3
      ? teachingSteps
      : [
          { title: "识别对象", description: "先找出论文机制中的关键对象和约束。" },
          { title: "观察变化", description: "再看对象如何移动、组合、预测或更新。" },
          { title: "理解收益", description: "最后分析机制如何改善延迟、精度或资源使用。" },
        ];
  const controls = fallbackParameters
    .map(
      (parameter) => `
        <label class="control">
          <span>${escapeHtml(parameter.label)}</span>
          <input data-param="${parameter.id}" type="range" min="${parameter.min}" max="${parameter.max}" step="${parameter.step}" value="${parameter.defaultValue}">
          <b id="value-${parameter.id}">${parameter.defaultValue}${parameter.unit ? ` ${escapeHtml(parameter.unit)}` : ""}</b>
        </label>
      `,
    )
    .join("");

  return {
    title: `${spec.title} 交互课件`,
    notes: "本地 HTML/JS 交互课件：滑条会实时驱动原理图、动画和指标。",
    html: `
      <style>
        :root { color-scheme: dark; font-family: Inter, "Microsoft YaHei", system-ui, sans-serif; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #edf2f7; background: #0f1116; }
        .lesson { display: grid; gap: 12px; min-height: 100vh; padding: 16px; background: linear-gradient(180deg, #14171d, #0f1116 68%); }
        .hero { display: grid; gap: 10px; }
        .titleRow { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        h1 { margin: 0; color: #f7f9fc; font-size: clamp(20px, 3vw, 31px); line-height: 1.15; }
        .modeBadge { padding: 5px 10px; border: 1px solid rgba(88,192,140,.55); border-radius: 999px; color: #58c08c; font-size: 12px; font-weight: 900; white-space: nowrap; background: rgba(88,192,140,.08); }
        .idea { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: center; padding: 10px 12px; border: 1px solid rgba(88,192,140,.35); border-radius: 12px; background: #111820; }
        .ideaIcon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; color: #101112; background: #58c08c; font-weight: 950; }
        .idea strong { color: #e8edf5; font-size: 14px; line-height: 1.45; }
        .briefGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        .brief { min-width: 0; padding: 11px 13px; border: 1px solid #2a303a; border-radius: 12px; background: #12161d; }
        .brief span { display: block; margin-bottom: 5px; color: #58c08c; font-size: 13px; font-weight: 900; }
        .brief p { margin: 0; color: #cbd3df; font-size: 13px; line-height: 1.5; }
        .stage { display: grid; gap: 10px; padding: 14px; border: 1px solid #242b35; border-radius: 14px; background: #0b0e13; overflow: hidden; }
        .stageTitle { display: flex; justify-content: space-between; gap: 10px; color: #f5f6f8; font-size: 16px; font-weight: 950; }
        .stageTitle span { color: #8792a3; font-size: 11px; font-weight: 800; }
        .canvasWrap { position: relative; min-height: 360px; border-radius: 12px; overflow: hidden; background: radial-gradient(circle at 78% 22%, rgba(88,192,140,.12), transparent 30%), #0e1117; }
        svg { display: block; width: 100%; height: 360px; }
        .module rect { fill: #151a22; stroke: #333b48; stroke-width: 1.4; transition: stroke .2s ease, fill .2s ease, transform .2s ease; }
        .module.active rect { fill: #18231f; stroke: #58c08c; stroke-width: 2.4; }
        .module .dot { fill: #58c08c; opacity: .9; }
        .module text { pointer-events: none; }
        .label { fill: #f4f7fb; font-size: 15px; font-weight: 900; }
        .role { fill: #a8b2c0; font-size: 11px; font-weight: 760; }
        .detail { fill: #778294; font-size: 10px; font-weight: 700; }
        .arrow { fill: none; stroke: #556171; stroke-width: 2.4; stroke-linecap: round; marker-end: url(#arrow); }
        .arrow.active { stroke: #58c08c; stroke-width: 3.2; }
        .arrowLabel { fill: #aeb7c3; font-size: 11px; font-weight: 850; }
        .kvBlock, .matrixCell, .timelineBlock { transition: opacity .2s ease, fill .2s ease, width .2s ease, height .2s ease, x .2s ease; }
        .kvBlock { fill: #354052; opacity: .7; }
        .kvBlock.hot { fill: #58c08c; opacity: 1; }
        .matrixCell { fill: #394354; opacity: .36; }
        .matrixCell.hot { fill: #6f9cff; opacity: .95; }
        .packet { fill: #f5f6f8; filter: drop-shadow(0 0 8px rgba(88,192,140,.8)); }
        .stepGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
        .step { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 9px; align-items: center; min-width: 0; padding: 9px; border: 1px solid #242b35; border-radius: 11px; background: #12161d; cursor: pointer; }
        .step.active { border-color: rgba(88,192,140,.78); background: #142019; }
        .step b { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 999px; color: #101112; background: #596372; font-size: 13px; }
        .step.active b { background: #58c08c; }
        .step strong, .step span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .step strong { color: #f4f7fb; font-size: 12px; }
        .step span { color: #9aa5b5; font-size: 10px; margin-top: 2px; }
        .lowerGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .panel { min-width: 0; padding: 12px; border: 1px solid #242b35; border-radius: 13px; background: #12161d; }
        .panel h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; color: #f4f7fb; font-size: 15px; }
        .timeline { display: grid; gap: 9px; }
        .lane { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 8px; align-items: center; }
        .lane span { color: #a8b2c0; font-size: 11px; font-weight: 800; }
        .bar { position: relative; height: 32px; border-radius: 9px; background: #0d1016; overflow: hidden; }
        .barFill { position: absolute; inset: 5px auto 5px 5px; border-radius: 7px; background: #6f9cff; width: 35%; transition: width .2s ease, background .2s ease; }
        .barFill.green { background: #58c08c; }
        .barFill.amber { background: #f2b86b; }
        .metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
        .metric { min-width: 0; padding: 9px; border: 1px solid #2b323c; border-radius: 10px; background: #0f1319; }
        .metric span { display: block; overflow: hidden; color: #9aa5b5; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
        .metric strong { display: block; margin-top: 3px; color: #f4f7fb; font-size: 17px; }
        .controls { display: grid; gap: 8px; margin-top: 10px; }
        .control { display: grid; grid-template-columns: 96px minmax(80px,1fr) 60px; gap: 10px; align-items: center; padding: 8px; border: 1px solid #2b323c; border-radius: 10px; background: #0f1319; }
        .control span, .control b { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
        .control span { color: #c8d0dc; font-weight: 800; }
        .control b { color: #58c08c; text-align: right; }
        input { width: 100%; accent-color: #58c08c; }
        .explain { margin: 10px 0 0; color: #c6ceda; font-size: 13px; line-height: 1.55; }
        .conclusion { display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: center; padding: 13px 15px; border: 1px solid rgba(111,156,255,.42); border-radius: 14px; background: #101622; }
        .star { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 12px; color: #101112; background: #6f9cff; font-size: 22px; font-weight: 950; }
        .conclusion strong { color: #f5f6f8; font-size: 15px; }
        .conclusion p { margin: 3px 0 0; color: #cbd3df; font-size: 13px; line-height: 1.45; }
        .lesson { gap: 8px; min-height: auto; padding: 10px; background: #0f1116; }
        .hero { display: none; }
        .stage { gap: 7px; padding: 10px; border-radius: 8px; background: #101319; }
        .stageTitle { font-size: 13px; }
        .stageTitle span { display: none; }
        .canvasWrap { min-height: 240px; border-radius: 7px; background: #0d1015; }
        svg { height: 250px; }
        .label { font-size: 12px; }
        .role { font-size: 9.5px; }
        .detail { display: none; }
        .arrowLabel { font-size: 9px; }
        .stepGrid { grid-template-columns: 1fr; gap: 5px; }
        .step { grid-template-columns: 20px minmax(0, 1fr); gap: 6px; padding: 6px 7px; border-radius: 6px; }
        .step b { width: 18px; height: 18px; font-size: 10px; }
        .step strong { font-size: 10.5px; }
        .step span span { display: none; }
        .lowerGrid { grid-template-columns: 1fr; gap: 7px; }
        .lowerGrid .panel:first-child { display: none; }
        .panel { padding: 8px; border-radius: 7px; }
        .panel h2 { display: none; }
        .metrics { gap: 5px; }
        .metric { padding: 6px; border-radius: 6px; }
        .metric strong { font-size: 13px; }
        .controls { gap: 6px; margin-top: 7px; }
        .control { grid-template-columns: 70px minmax(70px,1fr) 44px; gap: 6px; padding: 6px; border-radius: 6px; }
        .control span, .control b { font-size: 10px; }
        .explain { margin: 6px 0 0; font-size: 11px; line-height: 1.4; }
        .conclusion { display: none; }
        @media (max-width: 760px) { .briefGrid, .lowerGrid, .metrics, .stepGrid { grid-template-columns: 1fr; } .control { grid-template-columns: 82px minmax(70px,1fr) 50px; } }
      </style>
      <div class="lesson">
        <section class="hero">
          <div class="titleRow">
            <h1>${escapeHtml(spec.title)}</h1>
            <span class="modeBadge">B · 交互原理图</span>
          </div>
          <div class="idea">
            <div class="ideaIcon">◎</div>
            <strong>${escapeHtml(spec.diagramPurpose ?? spec.readerTakeaway ?? spec.summary)}</strong>
          </div>
          <div class="briefGrid">
            <div class="brief"><span>问题</span><p>${escapeHtml(spec.mechanismBrief?.coreProblem ?? spec.semantic?.problem ?? spec.summary)}</p></div>
            <div class="brief"><span>学习目标</span><p>${escapeHtml(spec.mechanismBrief?.learningGoal ?? spec.readerTakeaway ?? "看清对象、关系和动态变化，而不是背流程。")}</p></div>
          </div>
        </section>

        <section class="stage">
          <div class="stageTitle">
            <strong>${escapeHtml(spec.principleDiagram?.title ?? `${spec.title} 原理图`)}</strong>
            <span id="stageHint">拖动参数观察机制变化</span>
          </div>
          <div class="canvasWrap">
            <svg viewBox="0 0 920 390" role="img" aria-label="interactive principle diagram">
              <defs>
                <marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
                  <path d="M 0 0 L 9 4.5 L 0 9 z" fill="#697381"></path>
                </marker>
              </defs>
              <text x="42" y="38" fill="#f4f7fb" font-size="18" font-weight="950">机制示意图</text>
              <g id="moduleLayer"></g>
              <g id="arrowLayer"></g>
              <g id="matrixLayer"></g>
              <g id="blockLayer"></g>
              <circle class="packet" id="movingPacket" cx="74" cy="210" r="7"></circle>
            </svg>
          </div>
          <div class="stepGrid" id="stepGrid"></div>
          <p class="explain" id="stepExplain"></p>
        </section>

        <section class="lowerGrid">
          <div class="panel">
            <h2>▣ 动态演示</h2>
            <div class="timeline">
              <div class="lane"><span>历史/输入</span><div class="bar"><i class="barFill" id="barHistory"></i></div></div>
              <div class="lane"><span>预测/变换</span><div class="bar"><i class="barFill green" id="barPredict"></i></div></div>
              <div class="lane"><span>等待/瓶颈</span><div class="bar"><i class="barFill amber" id="barWait"></i></div></div>
            </div>
            <p class="explain" id="dynamicText"></p>
          </div>

          <div class="panel">
            <h2>▤ 参数实验</h2>
            <div class="metrics">
              <div class="metric"><span id="metricLabel1">命中/相关性</span><strong id="metricA">0%</strong></div>
              <div class="metric"><span id="metricLabel2">等待延迟</span><strong id="metricB">0ms</strong></div>
              <div class="metric"><span id="metricLabel3">资源占用</span><strong id="metricC">0%</strong></div>
            </div>
            <div class="controls">${controls}</div>
          </div>
        </div>

        <div class="conclusion">
          <div class="star">★</div>
          <div>
            <strong>结论</strong>
            <p>${escapeHtml(spec.readerTakeaway ?? spec.principleDiagram?.takeaway ?? spec.summary)}</p>
          </div>
        </div>
      </div>
      <script>
        const params = ${scriptJson(fallbackParameters)};
        const modules = ${scriptJson(teachingModules)};
        const relations = ${scriptJson(relations)};
        const steps = ${scriptJson(finalSteps)};
        const lessonKind = ${scriptJson(lessonKind)};
        let activeStep = 0;
        let tick = 0;

        function norm(param, value) {
          return param.max === param.min ? 0.5 : Math.max(0, Math.min(1, (value - param.min) / (param.max - param.min)));
        }
        function toneColor(tone) {
          return tone === 'green' ? '#58c08c' : tone === 'amber' ? '#f2b86b' : tone === 'rose' ? '#e86f8d' : tone === 'blue' ? '#6f9cff' : '#8d97a7';
        }
        function esc(text) {
          return String(text || '').replace(/[&<>]/g, function(char) {
            return char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&gt;';
          });
        }
        function values() {
          let total = 0;
          const map = {};
          params.forEach((param) => {
            const input = document.querySelector('[data-param="' + param.id + '"]');
            const value = Number(input ? input.value : param.defaultValue);
            const label = document.querySelector('#value-' + param.id);
            if (label) label.textContent = value + (param.unit ? ' ' + param.unit : '');
            map[param.id] = value;
            total += norm(param, value);
          });
          return { map, energy: params.length ? total / params.length : 0.5 };
        }
        function layoutModules(energy) {
          const layer = document.querySelector('#moduleLayer');
          const arrowLayer = document.querySelector('#arrowLayer');
          const count = Math.min(modules.length, 5);
          const width = count >= 5 ? 142 : 156;
          const gap = count >= 5 ? 30 : 56;
          const total = count * width + (count - 1) * gap;
          const start = (920 - total) / 2;
          const yBase = 136;
          layer.innerHTML = '';
          arrowLayer.innerHTML = '';
          modules.slice(0, count).forEach((module, index) => {
            const x = start + index * (width + gap);
            const y = yBase + (index % 2 ? -28 : 22) + Math.sin(energy * 3.14 + index) * 5;
            const active = index === activeStep % count || index === (activeStep + 1) % count;
            const color = toneColor(module.tone);
            layer.insertAdjacentHTML('beforeend',
              '<g class="module ' + (active ? 'active' : '') + '" transform="translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')">' +
                '<rect width="' + width + '" height="88" rx="13"></rect>' +
                '<circle class="dot" cx="' + (width - 22) + '" cy="22" r="' + (7 + energy * 4).toFixed(1) + '" fill="' + color + '"></circle>' +
                '<text class="label" x="14" y="28">' + esc(module.label).slice(0, 12) + '</text>' +
                '<text class="role" x="14" y="51">' + esc(module.role).slice(0, 18) + '</text>' +
                '<text class="detail" x="14" y="72">' + esc(module.detail).slice(0, 22) + '</text>' +
              '</g>'
            );
            if (index < count - 1) {
              const ax = x + width + 6;
              const ay = y + 44;
              const bx = x + width + gap - 8;
              const by = yBase + ((index + 1) % 2 ? -28 : 22) + 44;
              const label = relations[index % Math.max(relations.length, 1)] || '作用';
              arrowLayer.insertAdjacentHTML('beforeend',
                '<path class="arrow ' + (active ? 'active' : '') + '" d="M ' + ax + ' ' + ay + ' C ' + ((ax + bx) / 2) + ' ' + (ay - 34) + ', ' + ((ax + bx) / 2) + ' ' + (by + 34) + ', ' + bx + ' ' + by + '"></path>' +
                '<text class="arrowLabel" x="' + ((ax + bx) / 2 - 24) + '" y="' + ((ay + by) / 2 - 18) + '">' + esc(label).slice(0, 10) + '</text>'
              );
            }
          });
        }
        function drawBlocks(energy) {
          const blockLayer = document.querySelector('#blockLayer');
          const count = Math.round(10 + energy * 22);
          const hot = Math.round(3 + energy * 10);
          let html = '<text x="58" y="326" fill="#93a0b3" font-size="11" font-weight="800">' + (lessonKind === 'memory' ? 'KV blocks / cache pages' : '可视化单元') + '</text>';
          for (let i = 0; i < count; i += 1) {
            const x = 190 + (i % 22) * 18;
            const y = 308 + Math.floor(i / 22) * 20;
            html += '<rect class="kvBlock ' + (i < hot ? 'hot' : '') + '" x="' + x + '" y="' + y + '" width="12" height="12" rx="3"></rect>';
          }
          blockLayer.innerHTML = html;
        }
        function drawMatrix(energy) {
          const matrixLayer = document.querySelector('#matrixLayer');
          const rows = lessonKind === 'attention' ? 7 : 5;
          const cols = lessonKind === 'attention' ? 8 : 7;
          const startX = 610;
          const startY = 280;
          let html = '<text x="' + startX + '" y="' + (startY - 10) + '" fill="#93a0b3" font-size="11" font-weight="800">' + (lessonKind === 'attention' ? 'attention weights' : '命中/相关性热区') + '</text>';
          for (let r = 0; r < rows; r += 1) {
            for (let c = 0; c < cols; c += 1) {
              const value = Math.sin((r + 1) * (c + 2) + energy * 5);
              const hot = value > 0.25 || c < Math.round(energy * cols);
              html += '<rect class="matrixCell ' + (hot ? 'hot' : '') + '" x="' + (startX + c * 15) + '" y="' + (startY + r * 15) + '" width="11" height="11" rx="2" opacity="' + (hot ? 0.86 : 0.22) + '"></rect>';
            }
          }
          matrixLayer.innerHTML = html;
        }
        function recalc() {
          const state = values();
          const energy = state.energy;
          const hit = Math.round(38 + energy * 55);
          const wait = Math.max(6, Math.round(140 - energy * 92));
          const occupancy = Math.round(18 + energy * 66);
          document.querySelector('#metricA').textContent = hit + '%';
          document.querySelector('#metricB').textContent = wait + 'ms';
          document.querySelector('#metricC').textContent = occupancy + '%';
          document.querySelector('#metricLabel1').textContent = lessonKind === 'attention' ? '注意力集中度' : '预测/命中';
          document.querySelector('#metricLabel2').textContent = lessonKind === 'comparison' ? '瓶颈暴露' : '等待延迟';
          document.querySelector('#metricLabel3').textContent = lessonKind === 'memory' ? 'GPU占用' : '结构强度';
          document.querySelector('#barHistory').style.width = Math.round(28 + energy * 55) + '%';
          document.querySelector('#barPredict').style.width = hit + '%';
          document.querySelector('#barWait').style.width = wait + '%';
          document.querySelector('#dynamicText').textContent =
            lessonKind === 'memory'
              ? '参数越高，预测器会预取更多关键KV blocks，命中率提高，但GPU显存占用也随之上升。'
              : lessonKind === 'attention'
                ? '参数改变attention矩阵的集中度，越集中表示少数token对输出贡献更大。'
                : '参数改变图中关键模块的作用强度，用来观察机制收益和代价的变化。';
          const packet = document.querySelector('#movingPacket');
          packet.setAttribute('cx', String(74 + ((tick % 100) / 100) * 760));
          packet.setAttribute('cy', String(210 + Math.sin(tick / 10) * 18));
          packet.setAttribute('r', String(6 + energy * 5));
          layoutModules(energy);
          drawBlocks(energy);
          drawMatrix(energy);
        }
        function renderSteps() {
          const grid = document.querySelector('#stepGrid');
          grid.innerHTML = steps.slice(0, 4).map(function(step, index) {
            return '<button class="step ' + (index === activeStep ? 'active' : '') + '" data-step="' + index + '" type="button">' +
              '<b>' + (index + 1) + '</b><span><strong>' + esc(step.title).slice(0, 16) + '</strong><span>' + esc(step.description).slice(0, 32) + '</span></span></button>';
          }).join('');
          grid.querySelectorAll('.step').forEach(function(button) {
            button.addEventListener('click', function() {
              activeStep = Number(button.getAttribute('data-step')) || 0;
              updateStep();
              recalc();
            });
          });
        }
        function updateStep() {
          const step = steps[activeStep % steps.length];
          document.querySelector('#stepExplain').textContent = step.title + '：' + step.description;
          document.querySelectorAll('.step').forEach(function(button, index) {
            button.classList.toggle('active', index === activeStep);
          });
          document.querySelector('#stageHint').textContent = '当前步骤 ' + (activeStep + 1) + ' / ' + Math.min(steps.length, 4);
        }
        document.querySelectorAll('input').forEach(function(input) { input.addEventListener('input', recalc); });
        renderSteps();
        updateStep();
        recalc();
        setInterval(function() {
          tick += 1;
          if (tick % 42 === 0) {
            activeStep = (activeStep + 1) % Math.min(steps.length, 4);
            updateStep();
          }
          recalc();
        }, 90);
      </script>
    `,
  };
};

// B 模式 HTML 轨道进入 iframe sandbox 前先规范化：
// 1. 模型没返回、返回不完整、缺少滑条/recalc/绘图面时，用本地 fallback；
// 2. 命中明显危险 API 时，用本地 fallback；
// 3. 真正的运行安全边界仍然是 HtmlSandbox 的 iframe sandbox + CSP。
const normalizeHtmlDemo = (
  raw: unknown,
  fallbackSpec: VisualSpecBase,
): VisualHtmlDemo => {
  if (!raw || typeof raw !== "object") {
    return createFallbackHtmlDemo(fallbackSpec);
  }

  const item = raw as Partial<VisualHtmlDemo>;
  const html = safeLongString(item.html, "", 60_000);
  if (!html || htmlDemoNeedsFallback(html, fallbackSpec)) {
    return createFallbackHtmlDemo(fallbackSpec);
  }

  return {
    title: safeString(item.title, `${fallbackSpec.title} HTML Demo`, 80),
    notes: safeString(item.notes, "HTML/JS sandbox preview", 160),
    html,
  };
};

const htmlDemoNeedsFallback = (html: string, spec?: VisualSpecBase) => {
  // 这些检查不是完整 HTML 安全沙箱，只是提前过滤明显不适合渲染的内容。
  // 例如联网、越过 iframe、eval/import，或者没有交互控件/绘图区域的“空演示”。
  const hasUnsafeApi =
    /<script[^>]+src\s*=|fetch\s*\(|websocket|new\s+function|eval\s*\(|\bimport\s*(?:\(|[{*])|window\.top|window\.parent|location\.href|document\.cookie/i.test(
      html,
    );
  if (hasUnsafeApi) {
    return true;
  }

  const hasRangeSlider = /<input\b[^>]*type\s*=\s*["']?range/i.test(html);
  const hasRecalc = /\brecalc\s*\(/.test(html);
  const hasScript = /<script\b/i.test(html);
  const hasDrawingSurface =
    /<svg\b|<canvas\b|class\s*=\s*["'][^"']*(diagram|stage|canvas|mechanism|matrix|layout|row|cache|tensor|module)/i.test(
      html,
    );

  if (!hasRangeSlider || !hasRecalc || !hasScript || !hasDrawingSurface) {
    return true;
  }

  if (spec && isKvInterleavingSpec(spec)) {
    const hasK =
      /\bK\s*cache\b|\bK\s*row\b|key\s*cache|>K\d|K_i|K\[|K cache/i.test(
        html,
      );
    const hasV =
      /\bV\s*cache\b|\bV\s*row\b|value\s*cache|>V\d|V_i|V\[|V cache/i.test(
        html,
      );
    const hasInterleaving =
      /interleav|interleaved|\[K|K_i\s*\|\s*V_i|pair|token-wise|交错|交替|相邻|合并|整合/i.test(
        html,
      );
    if (!hasK || !hasV || !hasInterleaving) {
      return true;
    }
  }

  return false;
};

const normalizeSimulation = (
  raw: unknown,
  fallbackModel: VisualSimulationModel,
) => {
  const source = raw && typeof raw === "object"
    ? (raw as { model?: unknown; description?: unknown })
    : {};
  const model = allowedSimulationModels.has(source.model as VisualSimulationModel)
    ? (source.model as VisualSimulationModel)
    : fallbackModel;

  return {
    model,
    description: safeString(source.description, "", 160) || undefined,
  };
};

const normalizeSemanticSpec = (
  raw: unknown,
  fallbackTitle: string,
  fallbackSummary: string,
): VisualSemanticSpec => {
  const source = raw && typeof raw === "object"
    ? (raw as Partial<VisualSemanticSpec>)
    : {};
  const template = allowedSemanticTemplates.has(source.template as VisualSemanticTemplate)
    ? (source.template as VisualSemanticTemplate)
    : inferSemanticTemplate(`${fallbackTitle} ${fallbackSummary}`);
  const rawObjects = Array.isArray(source.keyObjects) ? source.keyObjects : [];
  const keyObjects = rawObjects
    .slice(0, 7)
    .map((object, index): VisualSemanticObject => {
      const item = object as Partial<VisualSemanticObject>;
      return {
        id: safeId(item.id, `object-${index + 1}`),
        label: safeString(item.label, `对象 ${index + 1}`, 28),
        role: safeString(item.role, "论文机制中的关键对象", 48),
        detail: safeString(item.detail, "", 88) || undefined,
      };
    })
    .filter((object) => object.label);
  if (keyObjects.length < 2) {
    return createFallbackSemanticSpec(fallbackTitle, fallbackSummary, template);
  }

  const objectIds = new Set(keyObjects.map((object) => object.id));
  const rawFlows = Array.isArray(source.flows) ? source.flows : [];
  const flows = rawFlows
    .slice(0, 8)
    .map((flow, index): VisualSemanticFlow | null => {
      const item = flow as Partial<VisualSemanticFlow>;
      const from = safeId(item.from, "");
      const to = safeId(item.to, "");

      if (!objectIds.has(from) || !objectIds.has(to) || from === to) {
        return null;
      }

      return {
        from,
        to,
        label: safeString(item.label, `关系 ${index + 1}`, 32),
        detail: safeString(item.detail, "", 90) || undefined,
      };
    })
    .filter(Boolean) as VisualSemanticFlow[];

  return {
    template,
    problem: safeString(
      source.problem,
      fallbackSummary || "这段论文需要解释一个机制问题。",
      180,
    ),
    mechanism: (Array.isArray(source.mechanism) ? source.mechanism : [])
      .slice(0, 6)
      .map((item, index) => safeString(item, `步骤 ${index + 1}`, 120))
      .filter(Boolean),
    keyObjects,
    flows,
    takeaway: safeString(
      source.takeaway,
      fallbackSummary || "读者应先理解关键对象和它们之间的关系。",
      180,
    ),
  };
};

const normalizeMechanismBrief = (
  raw: unknown,
  semantic: VisualSemanticSpec,
  fallbackTitle: string,
  fallbackSummary: string,
): VisualMechanismBrief => {
  const source = raw && typeof raw === "object"
    ? (raw as Partial<VisualMechanismBrief>)
    : {};
  const rawObjects = Array.isArray(source.keyObjects) ? source.keyObjects : [];
  const keyObjects = rawObjects.length > 0
    ? rawObjects
        .slice(0, 6)
        .map((object, index) => {
          const item = object as VisualMechanismBrief["keyObjects"][number];
          return {
            id: safeId(item.id, `brief-object-${index + 1}`),
            label: safeString(item.label, `对象 ${index + 1}`, 30),
            role: safeString(item.role, "原理中的关键对象", 70),
            evidence: safeString(item.evidence, "", 110) || undefined,
          };
        })
        .filter((object) => object.label)
    : semantic.keyObjects.slice(0, 6).map((object) => ({
        id: object.id,
        label: object.label,
        role: object.role,
        evidence: object.detail,
      }));

  const causalChain = (Array.isArray(source.causalChain)
    ? source.causalChain
    : semantic.mechanism
  )
    .slice(0, 6)
    .map((item, index) => safeString(item, `因果环节 ${index + 1}`, 130))
    .filter(Boolean);

  return {
    mechanismName: safeString(
      source.mechanismName,
      fallbackTitle || semantic.keyObjects[0]?.label || "核心机理",
      44,
    ),
    coreProblem: safeString(
      source.coreProblem,
      semantic.problem || fallbackSummary || "这段论文在解释一个结构或计算机理。",
      190,
    ),
    keyObjects,
    causalChain:
      causalChain.length > 0
        ? causalChain
        : [
            "先识别论文片段中的关键对象。",
            "再判断对象之间的依赖、传输或变换关系。",
            "最后观察这些关系如何带来论文声称的效果。",
          ],
    learningGoal: safeString(
      source.learningGoal,
      "看清对象之间如何作用，而不是只记住步骤顺序。",
      150,
    ),
    takeaway: safeString(
      source.takeaway,
      semantic.takeaway || fallbackSummary || "理解原理要抓住对象、关系和状态变化。",
      180,
    ),
  };
};

const createFallbackSemanticSpec = (
  fallbackTitle: string,
  fallbackSummary: string,
  template: VisualSemanticTemplate,
): VisualSemanticSpec => ({
  template,
  problem: safeString(
    fallbackSummary,
    "这段论文需要把关键对象和关系整理成结构图。",
    180,
  ),
  mechanism: [
    "识别选区中的核心对象。",
    "确定对象之间的依赖、传输或变换关系。",
    "按论文语义组织成一张可读图解。",
  ],
  keyObjects: [
    {
      id: "source",
      label: safeString(fallbackTitle, "输入对象", 20),
      role: "机制的起点",
    },
    {
      id: "mechanism",
      label: "核心机制",
      role: "处理或变换过程",
    },
    {
      id: "result",
      label: "结果",
      role: "机制产生的效果",
    },
  ],
  flows: [
    { from: "source", to: "mechanism", label: "进入机制" },
    { from: "mechanism", to: "result", label: "产生结果" },
  ],
  takeaway: safeString(
    fallbackSummary,
    "这张图先帮助读者看清对象、关系和最终效果。",
    180,
  ),
});

const numberOr = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizeRegionTone = (tone: unknown, index: number): VisualNodeTone =>
  allowedTones.has(tone as VisualNodeTone)
    ? (tone as VisualNodeTone)
    : semanticObjectTone(index);

const sceneNumberOrUndefined = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const normalizeSceneCoordinate = (
  value: unknown,
  fallback: number,
  axis: "x" | "y" | "width" | "height",
) => {
  const number = sceneNumberOrUndefined(value);
  if (number === undefined) {
    return fallback;
  }

  const canvasSize =
    axis === "x" || axis === "width" ? SCENE_CANVAS_WIDTH : SCENE_CANVAS_HEIGHT;

  if (number >= 0 && number <= 1) {
    return number * canvasSize;
  }

  if (number > 1 && number <= 100) {
    return (number / 100) * canvasSize;
  }

  return number;
};

const normalizeCanvasCoordinate = (
  value: unknown,
  fallback: number,
  axis: "x" | "y" | "width" | "height",
) => normalizeSceneCoordinate(value, fallback, axis);

const regionArea = (region: VisualMechanismRegion) =>
  region.width * region.height;

const regionIntersectionArea = (
  first: VisualMechanismRegion,
  second: VisualMechanismRegion,
) => {
  const left = Math.max(first.x, second.x);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const top = Math.max(first.y, second.y);
  const bottom = Math.min(first.y + first.height, second.y + second.height);

  return Math.max(0, right - left) * Math.max(0, bottom - top);
};

const sceneRegionsNeedFallback = (regions: VisualMechanismRegion[]) => {
  if (regions.length < 2) {
    return true;
  }

  const invalidRegion = regions.some(
    (region) =>
      region.width < 90 ||
      region.height < 58 ||
      region.x < 16 ||
      region.y < 28 ||
      region.x + region.width > SCENE_CANVAS_WIDTH - 16 ||
      region.y + region.height > SCENE_CANVAS_HEIGHT - 28,
  );
  if (invalidRegion) {
    return true;
  }

  let overlappingPairs = 0;
  for (let firstIndex = 0; firstIndex < regions.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < regions.length; secondIndex += 1) {
      const first = regions[firstIndex];
      const second = regions[secondIndex];
      const intersection = regionIntersectionArea(first, second);
      const smallerArea = Math.min(regionArea(first), regionArea(second));
      if (smallerArea > 0 && intersection / smallerArea > 0.35) {
        overlappingPairs += 1;
      }
    }
  }

  return overlappingPairs > 0;
};

const preserveRegionText = (
  generated: VisualMechanismRegion[],
  fallback: VisualMechanismRegion[],
) =>
  fallback.map((region, index) => ({
    ...region,
    id: generated[index]?.id ?? region.id,
    label: generated[index]?.label ?? region.label,
    role: generated[index]?.role ?? region.role,
    tone: generated[index]?.tone ?? region.tone,
  }));

const normalizeSceneRegions = (
  raw: unknown[],
  sceneKind: VisualMechanismSceneKind,
  semantic: VisualSemanticSpec,
) => {
  const regions = raw
    .slice(0, 5)
    .map((region, index): VisualMechanismRegion => {
      const item = region as Partial<VisualMechanismRegion>;
      const fallbackX = 42 + index * 214;
      const fallbackY = index === 1 ? 58 : 78;
      const width = normalizeSceneCoordinate(item.width, 184, "width");
      const height = normalizeSceneCoordinate(item.height, index === 1 ? 248 : 210, "height");
      const x = normalizeSceneCoordinate(item.x, fallbackX, "x");
      const y = normalizeSceneCoordinate(item.y, fallbackY, "y");

      return {
        id: safeId(item.id, `region-${index + 1}`),
        label: safeString(item.label, `区域 ${index + 1}`, 18),
        role: safeString(item.role, "机制中的结构区域", 34),
        x: clamp(x, 18, SCENE_CANVAS_WIDTH - 108),
        y: clamp(y, 34, SCENE_CANVAS_HEIGHT - 76),
        width: clamp(width, 98, SCENE_CANVAS_WIDTH - 56),
        height: clamp(height, 62, SCENE_CANVAS_HEIGHT - 70),
        tone: normalizeRegionTone(item.tone, index),
      };
    })
    .map((region) => ({
      ...region,
      width: Math.min(region.width, SCENE_CANVAS_WIDTH - region.x - 18),
      height: Math.min(region.height, SCENE_CANVAS_HEIGHT - region.y - 28),
    }));

  const fallback = createFallbackSceneRegions(sceneKind, semantic);

  return sceneRegionsNeedFallback(regions)
    ? preserveRegionText(regions, fallback)
    : regions;
};

const inferPrincipleDiagramKind = (
  diagramType: VisualDiagramType | undefined,
  semantic: VisualSemanticSpec,
): VisualPrincipleDiagramKind => {
  if (diagramType === "matrix" || semantic.template === "attention-matrix") {
    return "matrix-map";
  }

  if (diagramType === "equation" || semantic.template === "equation-transform") {
    return "equation-map";
  }

  if (diagramType === "comparison" || semantic.template === "comparison-tradeoff") {
    return "comparison-map";
  }

  if (diagramType === "timeline" || semantic.template === "timeline-stage") {
    return "timeline-map";
  }

  if (diagramType === "geometry") {
    return "geometry-map";
  }

  if (diagramType === "structure" || semantic.template === "model-architecture") {
    return "structure-map";
  }

  return "mechanism-map";
};

const createFallbackPrincipleRegions = (
  brief: VisualMechanismBrief,
  semantic: VisualSemanticSpec,
): VisualPrincipleRegion[] => {
  const objects = brief.keyObjects.length > 0
    ? brief.keyObjects
    : semantic.keyObjects.map((object) => ({
        id: object.id,
        label: object.label,
        role: object.role,
        evidence: object.detail,
      }));
  const fallbackObjects = objects.length > 0
    ? objects
    : [
        { id: "problem", label: "问题", role: "需要解决的机制问题" },
        { id: "mechanism", label: "核心机制", role: "论文提出的处理方式" },
        { id: "effect", label: "效果", role: "机制带来的结果" },
      ];
  const count = Math.min(fallbackObjects.length, 5);
  const width = count <= 3 ? 150 : 124;
  const gap = count <= 3 ? 58 : 18;
  const totalWidth = count * width + Math.max(0, count - 1) * gap;
  const startX = (SCENE_CANVAS_WIDTH - totalWidth) / 2;

  return fallbackObjects.slice(0, 5).map((object, index) => ({
    id: safeId(object.id, `principle-region-${index + 1}`),
    label: safeString(object.label, `对象 ${index + 1}`, 18),
    role: safeString(object.role, "机制对象", 42),
    detail: safeString(object.evidence, "", 78) || undefined,
    x: startX + index * (width + gap),
    y: index % 2 === 0 ? 104 : 154,
    width,
    height: 92,
    tone: semanticObjectTone(index),
  }));
};

const createFallbackPrincipleRelations = (
  regions: VisualPrincipleRegion[],
  semantic: VisualSemanticSpec,
): VisualPrincipleRelation[] => {
  const regionIds = new Set(regions.map((region) => region.id));
  const semanticRelations = semantic.flows
    .filter((flow) => regionIds.has(flow.from) && regionIds.has(flow.to))
    .slice(0, 6)
    .map((flow, index): VisualPrincipleRelation => ({
      id: `principle-relation-${index + 1}`,
      from: flow.from,
      to: flow.to,
      label: flow.label,
      detail: flow.detail,
      relationType: "transforms",
    }));

  if (semanticRelations.length > 0) {
    return semanticRelations;
  }

  return regions.slice(0, -1).map((region, index) => ({
    id: `principle-relation-${index + 1}`,
    from: region.id,
    to: regions[index + 1].id,
    label: index === 0 ? "驱动" : "形成",
    relationType: index === 0 ? "causes" : "transforms",
  }));
};

const createFallbackPrincipleDiagram = (
  brief: VisualMechanismBrief,
  semantic: VisualSemanticSpec,
  diagramType: VisualDiagramType | undefined,
): VisualPrincipleDiagram => {
  const regions = createFallbackPrincipleRegions(brief, semantic);

  return {
    title: `${brief.mechanismName} 原理图`,
    diagramKind: inferPrincipleDiagramKind(diagramType, semantic),
    centralClaim: brief.learningGoal,
    regions,
    relations: createFallbackPrincipleRelations(regions, semantic),
    annotations: brief.causalChain.slice(0, 3).map((item, index) => ({
      id: `principle-note-${index + 1}`,
      targetId: regions[index % Math.max(regions.length, 1)]?.id,
      label: `要点 ${index + 1}`,
      detail: item,
      tone: semanticObjectTone(index),
    })),
    takeaway: brief.takeaway,
  };
};

const normalizePrincipleRegions = (
  raw: unknown,
  fallback: VisualPrincipleRegion[],
): VisualPrincipleRegion[] => {
  const sources = Array.isArray(raw) ? raw : [];
  const regions = sources
    .slice(0, 7)
    .map((region, index): VisualPrincipleRegion => {
      const item = region as Partial<VisualPrincipleRegion>;
      const fallbackRegion = fallback[index % Math.max(fallback.length, 1)];
      const width = normalizeCanvasCoordinate(item.width, fallbackRegion?.width ?? 136, "width");
      const height = normalizeCanvasCoordinate(item.height, fallbackRegion?.height ?? 86, "height");
      const x = normalizeCanvasCoordinate(item.x, fallbackRegion?.x ?? 72 + index * 122, "x");
      const y = normalizeCanvasCoordinate(item.y, fallbackRegion?.y ?? 130, "y");

      return {
        id: safeId(item.id, fallbackRegion?.id ?? `principle-region-${index + 1}`),
        label: safeString(item.label, fallbackRegion?.label ?? `对象 ${index + 1}`, 20),
        role: safeString(item.role, fallbackRegion?.role ?? "原理中的结构对象", 46),
        detail: safeString(item.detail, fallbackRegion?.detail ?? "", 90) || undefined,
        x: clamp(x, 24, SCENE_CANVAS_WIDTH - 92),
        y: clamp(y, 56, SCENE_CANVAS_HEIGHT - 70),
        width: clamp(width, 74, 260),
        height: clamp(height, 52, 170),
        tone: normalizeRegionTone(item.tone, index),
      };
    })
    .map((region) => ({
      ...region,
      width: Math.min(region.width, SCENE_CANVAS_WIDTH - region.x - 18),
      height: Math.min(region.height, SCENE_CANVAS_HEIGHT - region.y - 24),
    }));

  return sceneRegionsNeedFallback(
    regions.map((region) => ({
      ...region,
      role: region.role,
    })),
  )
    ? fallback
    : regions;
};

const normalizePrincipleDiagram = (
  raw: unknown,
  brief: VisualMechanismBrief,
  semantic: VisualSemanticSpec,
  diagramType: VisualDiagramType | undefined,
): VisualPrincipleDiagram => {
  const fallback = createFallbackPrincipleDiagram(brief, semantic, diagramType);
  const source = raw && typeof raw === "object"
    ? (raw as Partial<VisualPrincipleDiagram>)
    : {};
  const diagramKind = allowedPrincipleDiagramKinds.has(
    source.diagramKind as VisualPrincipleDiagramKind,
  )
    ? (source.diagramKind as VisualPrincipleDiagramKind)
    : fallback.diagramKind;
  const regions = normalizePrincipleRegions(source.regions, fallback.regions);
  const regionIds = new Set(regions.map((region) => region.id));
  const rawRelations = Array.isArray(source.relations) ? source.relations : [];
  const fallbackRelations = createFallbackPrincipleRelations(regions, semantic);
  const relations = rawRelations
    .slice(0, 10)
    .map((relation, index): VisualPrincipleRelation | null => {
      const item = relation as Partial<VisualPrincipleRelation>;
      const from = safeId(item.from, "");
      const to = safeId(item.to, "");
      if (!regionIds.has(from) || !regionIds.has(to) || from === to) {
        return null;
      }

      return {
        id: safeId(item.id, `principle-relation-${index + 1}`),
        from,
        to,
        label: safeString(item.label, `关系 ${index + 1}`, 24),
        detail: safeString(item.detail, "", 90) || undefined,
        relationType: allowedPrincipleRelationTypes.has(
          item.relationType as VisualPrincipleRelationType,
        )
          ? (item.relationType as VisualPrincipleRelationType)
          : "transforms",
      };
    })
    .filter(Boolean) as VisualPrincipleRelation[];
  const rawAnnotations = Array.isArray(source.annotations)
    ? source.annotations
    : [];
  const annotations = rawAnnotations
    .slice(0, 6)
    .map((annotation, index): VisualPrincipleAnnotation => {
      const item = annotation as Partial<VisualPrincipleAnnotation>;
      const targetId = safeId(item.targetId, "");
      return {
        id: safeId(item.id, `principle-note-${index + 1}`),
        targetId: regionIds.has(targetId) ? targetId : undefined,
        label: safeString(item.label, `要点 ${index + 1}`, 24),
        detail: safeString(item.detail, "", 110) || undefined,
        x: sceneNumberOrUndefined(item.x),
        y: sceneNumberOrUndefined(item.y),
        tone: normalizeRegionTone(item.tone, index),
      };
    });

  return {
    title: safeString(source.title, fallback.title, 70),
    diagramKind,
    centralClaim: safeString(source.centralClaim, fallback.centralClaim, 170),
    regions,
    relations: relations.length > 0 ? relations : fallbackRelations,
    annotations: annotations.length > 0 ? annotations : fallback.annotations,
    takeaway: safeString(source.takeaway, fallback.takeaway, 180),
  };
};

const isKvLikeUnit = (unit: VisualMechanismUnit) =>
  /(^k\d*$|key|k cache|^v\d*$|value|v cache|kv|\|)/i.test(
    `${unit.id} ${unit.label} ${unit.kind}`,
  );

const normalizeSceneUnits = (
  units: VisualMechanismUnit[],
  regions: VisualMechanismRegion[],
  sceneKind: VisualMechanismSceneKind,
) => {
  const regionIds = new Set(regions.map((region) => region.id));
  const fallbackRegionId = regions[0]?.id ?? "region-1";
  const isLayoutScene = sceneKind === "layout-transform";
  const hasKvUnits = units.some(isKvLikeUnit);
  const counters = new Map<string, number>();

  return units.map((unit, index) => {
    let regionId = regionIds.has(unit.regionId) ? unit.regionId : fallbackRegionId;
    let lane = clamp(Math.round(unit.lane ?? 0), 0, 5);

    if (isLayoutScene && hasKvUnits) {
      const text = `${unit.id} ${unit.label} ${unit.kind}`;
      if (/\|/.test(text) || /\bkv\b|interleav|merged|consolidat|交替|合并/i.test(text)) {
        regionId = regions[2]?.id ?? regionId;
        lane = 0;
      } else if (/\bv\d*\b|value|v cache/i.test(text)) {
        regionId = regions[0]?.id ?? regionId;
        lane = 1;
      } else if (/\bk\d*\b|key|k cache/i.test(text)) {
        regionId = regions[0]?.id ?? regionId;
        lane = 0;
      }
    }

    const key = `${regionId}:${lane}`;
    const nextIndex = counters.get(key) ?? 0;
    counters.set(key, nextIndex + 1);

    return {
      ...unit,
      regionId,
      lane,
      index: nextIndex,
      label: safeString(unit.label, `U${index + 1}`, 12),
      kind: safeString(unit.kind, "unit", 22),
      detail: unit.detail ? safeString(unit.detail, "", 42) : undefined,
    };
  });
};

const normalizeMechanismScene = (
  raw: unknown,
  semantic: VisualSemanticSpec,
  fallbackTitle: string,
  fallbackSummary: string,
): VisualMechanismScene => {
  const source = raw && typeof raw === "object"
    ? (raw as Partial<VisualMechanismScene>)
    : {};
  const sceneKind = allowedSceneKinds.has(source.sceneKind as VisualMechanismSceneKind)
    ? (source.sceneKind as VisualMechanismSceneKind)
    : inferSceneKind(`${fallbackTitle} ${fallbackSummary} ${semantic.template}`);
  const regionSources = Array.isArray(source.regions) ? source.regions : [];
  const fallbackRegions = normalizeSceneRegions(regionSources, sceneKind, semantic);
  const regionIds = new Set(fallbackRegions.map((region) => region.id));
  const defaultRegionId = fallbackRegions[0]?.id ?? "source";
  const rawUnits = Array.isArray(source.units) ? source.units : [];
  const generatedUnits = rawUnits
    .slice(0, 20)
    .map((unit, index): VisualMechanismUnit => {
      const item = unit as Partial<VisualMechanismUnit>;
      const regionId = safeId(item.regionId, defaultRegionId);
      return {
        id: safeId(item.id, `unit-${index + 1}`),
        label: safeString(item.label, `U${index + 1}`, 18),
        kind: safeString(item.kind, "unit", 24),
        regionId: regionIds.has(regionId) ? regionId : defaultRegionId,
        lane: clamp(Math.round(numberOr(item.lane, index % 2)), 0, 5),
        index: clamp(Math.round(numberOr(item.index, index)), 0, 64),
        tone: normalizeRegionTone(item.tone, index),
        pairWith: safeId(item.pairWith, "") || undefined,
        value: safeString(item.value, "", 24) || undefined,
        detail: safeString(item.detail, "", 60) || undefined,
      };
    });
  const fallbackUnits =
    generatedUnits.length >= 2
      ? normalizeSceneUnits(generatedUnits, fallbackRegions, sceneKind)
      : createFallbackSceneUnits(fallbackRegions, semantic, fallbackTitle);
  const unitIds = new Set(fallbackUnits.map((unit) => unit.id));
  const unitById = new Map(fallbackUnits.map((unit) => [unit.id, unit]));
  const rawSteps = Array.isArray(source.steps) ? source.steps : [];
  const steps = rawSteps
    .slice(0, 6)
    .map((step, index): VisualMechanismStepSpec => {
      const item = step as Partial<VisualMechanismStepSpec>;
      const fromRegionId = safeId(item.fromRegionId, "");
      const toRegionId = safeId(item.toRegionId, "");
      const operation = allowedMechanismOperations.has(
        item.operation as VisualMechanismOperation,
      )
        ? (item.operation as VisualMechanismOperation)
        : inferOperation(index, sceneKind);
      const activeUnitIds = Array.isArray(item.activeUnitIds)
        ? item.activeUnitIds
            .map((id) => safeId(id, ""))
            .filter((id) => unitIds.has(id))
            .slice(0, 8)
        : [];
      const resultUnitIds = Array.isArray(item.resultUnitIds)
        ? item.resultUnitIds
            .map((id) => safeId(id, ""))
            .filter((id) => unitIds.has(id))
            .slice(0, 8)
        : [];
      const placements = normalizeScenePlacements(
        item.placements,
        unitIds,
        regionIds,
        unitById,
      );

      return {
        id: safeId(item.id, `scene-step-${index + 1}`),
        title: safeString(item.title, `步骤 ${index + 1}`, 28),
        description: safeString(
          item.description,
          "观察这些对象在该步骤中的位置和关系变化。",
          130,
        ),
        operation,
        activeUnitIds:
          activeUnitIds.length > 0
            ? activeUnitIds
            : fallbackUnits.slice(index, index + 3).map((unit) => unit.id),
        fromRegionId: regionIds.has(fromRegionId) ? fromRegionId : undefined,
        toRegionId: regionIds.has(toRegionId) ? toRegionId : undefined,
        resultUnitIds,
        placements,
        parameterEffects: (Array.isArray(item.parameterEffects)
          ? item.parameterEffects
          : []
        )
          .slice(0, 3)
          .map((effect, effectIndex) =>
            safeString(effect, `参数影响 ${effectIndex + 1}`, 80),
          )
          .filter(Boolean),
      };
    });
  const fallbackSteps =
    steps.length >= 2
      ? steps
      : createFallbackSceneSteps(fallbackRegions, fallbackUnits, semantic);

  return {
    title: safeString(source.title, fallbackTitle || "机理示意动画", 72),
    sceneKind,
    purpose: safeString(
      source.purpose,
      fallbackSummary || "把论文片段中的机制转化为可操作的结构示意。",
      160,
    ),
    regions: fallbackRegions,
    units: fallbackUnits,
    steps: fallbackSteps,
    takeaway: safeString(
      source.takeaway,
      semantic.takeaway || fallbackSummary || "观察对象如何移动、组合或更新，是理解这段机制的关键。",
      180,
    ),
  };
};

const normalizeScenePlacements = (
  raw: unknown,
  unitIds: Set<string>,
  regionIds: Set<string>,
  unitById: Map<string, VisualMechanismUnit>,
): VisualMechanismUnitPlacement[] => {
  if (!Array.isArray(raw)) {
    return [];
  }

  const counters = new Map<string, number>();

  return raw
    .slice(0, 24)
    .map((placement): VisualMechanismUnitPlacement | null => {
      const item = placement as Partial<VisualMechanismUnitPlacement>;
      const unitId = safeId(item.unitId, "");
      const regionId = safeId(item.regionId, "");
      if (!unitIds.has(unitId) || !regionIds.has(regionId)) {
        return null;
      }

      const unit = unitById.get(unitId);
      const lane =
        sceneNumberOrUndefined(item.lane) !== undefined
          ? clamp(Math.round(numberOr(item.lane, 0)), 0, 5)
          : clamp(Math.round(unit?.lane ?? 0), 0, 5);
      const key = `${regionId}:${lane}`;
      const fallbackIndex = counters.get(key) ?? 0;
      counters.set(key, fallbackIndex + 1);
      const index =
        sceneNumberOrUndefined(item.index) !== undefined
          ? clamp(Math.round(numberOr(item.index, fallbackIndex)), 0, 64)
          : clamp(Math.round(unit?.index ?? fallbackIndex), 0, 64);

      return {
        unitId,
        regionId,
        lane,
        index,
        hidden: Boolean(item.hidden),
      };
    })
    .filter(Boolean) as VisualMechanismUnitPlacement[];
};

const inferSceneKind = (text: string): VisualMechanismSceneKind => {
  if (/kv|cache|layout|interleav|token-wise|storage|memory|block|缓存|交替|交织|布局|存储/i.test(text)) {
    return "layout-transform";
  }

  if (/attention|matrix|tensor|query|key|value|softmax|矩阵|张量|注意力/i.test(text)) {
    return "matrix-computation";
  }

  if (/architecture|module|layer|component|network|结构|模块|组件|层/i.test(text)) {
    return "architecture-assembly";
  }

  if (/state|transition|markov|diffusion|stage|状态|转移|扩散|阶段/i.test(text)) {
    return "state-transition";
  }

  if (/compare|tradeoff|ablation|baseline|对比|权衡|消融/i.test(text)) {
    return "comparison-mechanism";
  }

  if (/geometry|spatial|coordinate|position|3d|空间|坐标|几何/i.test(text)) {
    return "geometric-process";
  }

  if (/flow|transfer|route|dispatch|pipeline|传输|路由|流水/i.test(text)) {
    return "dataflow";
  }

  return "generic-mechanism";
};

const inferOperation = (
  index: number,
  sceneKind: VisualMechanismSceneKind,
): VisualMechanismOperation => {
  if (sceneKind === "layout-transform") {
    return (["move", "pair", "merge", "reorder"][index % 4] as VisualMechanismOperation);
  }

  if (sceneKind === "matrix-computation") {
    return (["lookup", "compute", "accumulate"][index % 3] as VisualMechanismOperation);
  }

  if (sceneKind === "comparison-mechanism") {
    return (["compare", "filter", "transform"][index % 3] as VisualMechanismOperation);
  }

  return (["move", "transform", "merge"][index % 3] as VisualMechanismOperation);
};

const createFallbackSceneRegions = (
  sceneKind: VisualMechanismSceneKind,
  semantic: VisualSemanticSpec,
): VisualMechanismRegion[] => {
  if (sceneKind === "layout-transform") {
    return [
      {
        id: "before",
        label: "原始布局",
        role: "对象尚未重排",
        x: 40,
        y: 70,
        width: 190,
        height: 230,
        tone: "blue",
      },
      {
        id: "operation",
        label: "局部操作",
        role: "按语义组合或变换",
        x: 256,
        y: 70,
        width: 188,
        height: 230,
        tone: "amber",
      },
      {
        id: "after",
        label: "优化结构",
        role: "形成更利于理解或计算的单元",
        x: 470,
        y: 70,
        width: 190,
        height: 230,
        tone: "green",
      },
    ];
  }

  return semantic.keyObjects.slice(0, 3).map((object, index) => ({
    id: object.id,
    label: object.label,
    role: object.role,
    x: 42 + index * 214,
    y: index === 1 ? 58 : 86,
    width: 184,
    height: index === 1 ? 248 : 210,
    tone: semanticObjectTone(index),
  }));
};

const createFallbackSceneUnits = (
  regions: VisualMechanismRegion[],
  semantic: VisualSemanticSpec,
  fallbackTitle: string,
): VisualMechanismUnit[] => {
  const text = `${fallbackTitle} ${semantic.problem} ${semantic.takeaway}`;
  if (/kv|key|value|cache|缓存/i.test(text)) {
    return [
      ...Array.from({ length: 5 }).map((_, index) => ({
        id: `k-${index + 1}`,
        label: `K${index + 1}`,
        kind: "K cache",
        regionId: regions[0]?.id ?? "before",
        lane: 0,
        index,
        tone: "blue" as VisualNodeTone,
        pairWith: `v-${index + 1}`,
      })),
      ...Array.from({ length: 5 }).map((_, index) => ({
        id: `v-${index + 1}`,
        label: `V${index + 1}`,
        kind: "V cache",
        regionId: regions[0]?.id ?? "before",
        lane: 1,
        index,
        tone: "amber" as VisualNodeTone,
        pairWith: `k-${index + 1}`,
      })),
      ...Array.from({ length: 5 }).map((_, index) => ({
        id: `kv-${index + 1}`,
        label: `K${index + 1}|V${index + 1}`,
        kind: "interleaved KV unit",
        regionId: regions[2]?.id ?? regions[regions.length - 1]?.id ?? "after",
        lane: 0,
        index,
        tone: "green" as VisualNodeTone,
      })),
    ];
  }

  const objects = semantic.keyObjects.length
    ? semantic.keyObjects
    : [
        { id: "input", label: "输入", role: "原始对象" },
        { id: "core", label: "机制", role: "核心操作" },
        { id: "output", label: "结果", role: "输出效果" },
      ];

  return Array.from({ length: Math.max(6, objects.length * 2) }).map((_, index) => {
    const object = objects[index % objects.length];
    const region = regions[index % Math.max(regions.length, 1)];
    return {
      id: `unit-${index + 1}`,
      label: index < objects.length ? object.label : `${object.label}${index + 1}`,
      kind: object.role,
      regionId: region?.id ?? "region-1",
      lane: index % 2,
      index: Math.floor(index / 2),
      tone: semanticObjectTone(index),
      detail: object.detail,
    };
  });
};

const createFallbackSceneSteps = (
  regions: VisualMechanismRegion[],
  units: VisualMechanismUnit[],
  semantic: VisualSemanticSpec,
): VisualMechanismStepSpec[] => {
  const baseDescriptions = semantic.mechanism.length
    ? semantic.mechanism
    : [
        "先观察原始对象和它们的相对位置。",
        "再观察核心操作如何改变对象关系。",
        "最后看变换后的结构带来什么效果。",
      ];

  return baseDescriptions.slice(0, 4).map((description, index) => ({
    id: `scene-step-${index + 1}`,
    title: index === 0 ? "识别对象" : index === 1 ? "执行机制" : index === 2 ? "形成结果" : "理解收益",
    description,
    operation: inferOperation(index, inferSceneKind(semantic.template)),
    activeUnitIds: units.slice(index * 2, index * 2 + 4).map((unit) => unit.id),
    fromRegionId: regions[index % regions.length]?.id,
    toRegionId: regions[(index + 1) % regions.length]?.id,
    resultUnitIds: units.slice(index * 2 + 2, index * 2 + 5).map((unit) => unit.id),
    placements: [],
    parameterEffects: [],
  }));
};

const inferSemanticTemplate = (text: string): VisualSemanticTemplate => {
  if (/prefetch|ssd|host|gpu|kv cache|block|memory|预取|缓存|显存|主机|传输/i.test(text)) {
    return "memory-prefetch-pipeline";
  }

  if (/hierarchy|storage|cache|memory|显存|内存|存储|层级/i.test(text)) {
    return "memory-hierarchy";
  }

  if (/attention|query|key|value|softmax|注意力/i.test(text)) {
    return "attention-matrix";
  }

  if (/architecture|module|layer|component|结构|模块|组件/i.test(text)) {
    return "model-architecture";
  }

  if (/equation|formula|loss|objective|公式|方程/i.test(text)) {
    return "equation-transform";
  }

  if (/compare|tradeoff|ablation|baseline|对比|消融|权衡/i.test(text)) {
    return "comparison-tradeoff";
  }

  if (/timeline|stage|train|inference|阶段|训练|推理/i.test(text)) {
    return "timeline-stage";
  }

  return "generic-mechanism";
};

const inferSimulationModelFromText = (text: string): VisualSimulationModel => {
  if (/kv|cache|interleav|gpu|kernel|block|transfer|memory|缓存|交织|块|传输/i.test(text)) {
    return "kv-cache-layout";
  }

  if (/attention|query|key|value|softmax|token|注意力/i.test(text)) {
    return "attention-flow";
  }

  if (/pipeline|stage|latency|流水|阶段/i.test(text)) {
    return "pipeline";
  }

  return "generic-flow";
};

const inferDiagramType = (
  kind: VisualSpec["kind"],
  text: string,
): VisualDiagramType => {
  if (kind === "architecture" || /architecture|module|component|layer|结构|模块|组件|层/i.test(text)) {
    return "structure";
  }

  if (kind === "matrix" || /matrix|tensor|attention|heatmap|矩阵|张量|注意力/i.test(text)) {
    return "matrix";
  }

  if (kind === "equation-playground" || /equation|formula|loss|objective|公式|方程|损失/i.test(text)) {
    return "equation";
  }

  if (kind === "comparison" || /compare|tradeoff|ablation|baseline|对比|消融|权衡/i.test(text)) {
    return "comparison";
  }

  if (kind === "timeline" || /timeline|stage|train|inference|阶段|训练|推理/i.test(text)) {
    return "timeline";
  }

  if (kind === "geometry" || /geometry|spatial|position|coordinate|空间|坐标|几何/i.test(text)) {
    return "geometry";
  }

  return "mechanism";
};

const semanticObjectTone = (index: number): VisualNodeTone =>
  (["blue", "green", "amber", "rose", "neutral"][index % 5] as VisualNodeTone);

const semanticLayout = (semantic: VisualSemanticSpec) => {
  const count = semantic.keyObjects.length;
  const width = 700;
  const centerY =
    semantic.template === "memory-prefetch-pipeline" ||
    semantic.template === "memory-hierarchy"
      ? 190
      : 178;
  const usableWidth = 560;
  const startX = (width - usableWidth) / 2;

  return new Map(
    semantic.keyObjects.map((object, index) => [
      object.id,
      {
        x:
          count <= 1
            ? width / 2
            : startX + (usableWidth / Math.max(count - 1, 1)) * index,
        y:
          semantic.template === "memory-hierarchy"
            ? 86 + index * Math.min(42, 210 / Math.max(count - 1, 1))
            : centerY + (index % 2 === 0 ? 0 : -34),
      },
    ]),
  );
};

// 结构化轨道是主安全路径：AI 只给数据，渲染和交互都由本地 React/SVG 接管。
export const normalizeVisualSpec = (
  raw: unknown,
  activeContext: AiContextItem,
): VisualSpec => {
  if (!raw || typeof raw !== "object") {
    throw new Error("VisualSpec is not an object.");
  }

  const source = raw as Partial<VisualSpec>;
  const semantic = normalizeSemanticSpec(
    source.semantic,
    source.title ?? "",
    source.summary ?? "",
  );
  const kind = allowedKinds.has(source.kind as VisualSpec["kind"])
    ? (source.kind as VisualSpec["kind"])
    : "mechanism-animation";
  const fallbackDiagramType = allowedDiagramTypes.has(source.diagramType as VisualDiagramType)
    ? (source.diagramType as VisualDiagramType)
    : inferDiagramType(
        kind,
        [
          source.title,
          source.summary,
          semantic.template,
          semantic.problem,
          ...semantic.keyObjects.flatMap((object) => [object.label, object.role]),
        ].join(" "),
      );
  const mechanismBrief = normalizeMechanismBrief(
    source.mechanismBrief,
    semantic,
    source.title ?? "",
    source.summary ?? "",
  );
  const principleDiagram = normalizePrincipleDiagram(
    source.principleDiagram,
    mechanismBrief,
    semantic,
    fallbackDiagramType,
  );
  const scene = normalizeMechanismScene(
    source.scene,
    semantic,
    source.title ?? "",
    source.summary ?? "",
  );
  const rawNodes = Array.isArray(source.nodes) ? source.nodes : [];
  const nodeSources =
    rawNodes.length >= 2
      ? rawNodes
      : semantic.keyObjects.map((object, index) => ({
          id: object.id,
          label: object.label,
          detail: object.role,
          x: 90 + index * 110,
          y: 180,
          tone: semanticObjectTone(index),
        }));
  const nodes = nodeSources
    .slice(0, 8)
    .map((node, index) => {
      const item = node as Partial<VisualNode>;
      const id = safeId(item.id, `node-${index + 1}`);
      const tone = allowedTones.has(item.tone as VisualNodeTone)
        ? (item.tone as VisualNodeTone)
        : (["blue", "green", "amber", "rose"][index % 4] as VisualNodeTone);

      return {
        id,
        label: safeString(item.label, `Node ${index + 1}`, 22),
        detail: safeString(item.detail, "Concept", 28),
        x: clamp(Number(item.x) || 90 + index * 95, 55, 645),
        y: clamp(Number(item.y) || 180, 55, 305),
        tone,
      };
    });

  if (nodes.length < 2) {
    throw new Error("VisualSpec needs at least two semantic objects or nodes.");
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const rawEdges = Array.isArray(source.edges) ? source.edges : [];
  const edgeSources =
    rawEdges.length > 0
      ? rawEdges
      : semantic.flows.map((flow, index) => ({
          id: `flow-${index + 1}`,
          from: flow.from,
          to: flow.to,
          label: flow.label,
          strength: 0.72,
        }));
  const edges = edgeSources
    .slice(0, 10)
    .map((edge, index) => {
      const item = edge as Partial<VisualEdge>;
      const from = safeId(item.from, "");
      const to = safeId(item.to, "");
      if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) {
        return null;
      }

      return {
        id: safeId(item.id, `edge-${index + 1}`),
        from,
        to,
        label: safeString(item.label, "flow", 16),
        strength: clamp(Number(item.strength) || 0.65, 0.2, 1),
      };
    })
    .filter(Boolean) as VisualEdge[];

  if (edges.length === 0) {
    for (let index = 0; index < nodes.length - 1; index += 1) {
      edges.push({
        id: `edge-${index + 1}`,
        from: nodes[index].id,
        to: nodes[index + 1].id,
        label: "flow",
        strength: 0.65,
      });
    }
  }

  const rawParameters = Array.isArray(source.parameters)
    ? source.parameters
    : [];
  const parameters = rawParameters
    .slice(0, 4)
    .map((parameter, index) => {
      const item = parameter as Partial<VisualParameter>;
      const min = Number.isFinite(Number(item.min)) ? Number(item.min) : 1;
      const max = Number.isFinite(Number(item.max))
        ? Math.max(Number(item.max), min + 1)
        : min + 10;
      const step = Number(item.step) > 0 ? Number(item.step) : 1;
      const defaultValue = clamp(
        Number.isFinite(Number(item.defaultValue))
          ? Number(item.defaultValue)
          : min + (max - min) / 2,
        min,
        max,
      );

      return {
        id: safeId(item.id, `param-${index + 1}`),
        label: safeString(item.label, `Param ${index + 1}`, 18),
        min,
        max,
        step,
        defaultValue,
        unit: safeString(item.unit, "", 10) || undefined,
      };
    });

  if (parameters.length === 0) {
    parameters.push(
      {
        id: "scale",
        label: "Scale",
        min: 1,
        max: 10,
        step: 1,
        defaultValue: 5,
        unit: undefined,
      },
      {
        id: "parallelism",
        label: "Parallelism",
        min: 1,
        max: 16,
        step: 1,
        defaultValue: 6,
        unit: undefined,
      },
    );
  }

  const parameterIds = new Set(parameters.map((parameter) => parameter.id));
  const rawElements = Array.isArray(source.visualElements)
    ? source.visualElements
    : [];
  const visualElements = rawElements
    .slice(0, 36)
    .map((element, index) => {
      const item = element as Partial<VisualElement>;
      const kind = allowedElementKinds.has(item.kind as VisualElementKind)
        ? (item.kind as VisualElementKind)
        : "rect";
      const tone = allowedTones.has(item.tone as VisualNodeTone)
        ? (item.tone as VisualNodeTone)
        : (["blue", "green", "amber", "rose", "neutral"][index % 5] as VisualNodeTone);
      const points = Array.isArray(item.points)
        ? item.points.slice(0, 8).map((point) => ({
            x: clamp(Number(point?.x) || 0, 0, 700),
            y: clamp(Number(point?.y) || 0, 0, 360),
          }))
        : undefined;
      const rows = clamp(Math.round(Number(item.rows) || 3), 1, 12);
      const cols = clamp(Math.round(Number(item.cols) || 3), 1, 12);
      const cells = Array.isArray(item.cells)
        ? item.cells
            .slice(0, rows * cols)
            .map((cell) => clamp(Number(cell) || 0, 0, 1))
        : undefined;
      const parameterId = safeId(item.parameterId, "");

      return {
        id: safeId(item.id, `element-${index + 1}`),
        kind,
        label: safeString(item.label, "", 26) || undefined,
        detail: safeString(item.detail, "", 72) || undefined,
        x: clamp(Number(item.x) || 100 + index * 20, 20, 680),
        y: clamp(Number(item.y) || 90 + index * 12, 20, 340),
        width: clamp(Number(item.width) || 90, 12, 620),
        height: clamp(Number(item.height) || 44, 8, 300),
        radius: clamp(Number(item.radius) || 18, 3, 140),
        tone,
        value: clamp(Number(item.value) || 0.5, 0, 1),
        rows,
        cols,
        cells,
        points,
        targetId: safeId(item.targetId, "") || undefined,
        parameterId: parameterIds.has(parameterId) ? parameterId : undefined,
      };
    });

  const rawSteps = Array.isArray(source.steps) ? source.steps : [];
  const elementIds = new Set(visualElements.map((element) => element.id));
  const semanticObjectIds = new Set(
    semantic.keyObjects.map((object) => object.id),
  );
  const steps = rawSteps
    .slice(0, 6)
    .map((step, index) => {
      const item = step as Partial<VisualSpec["steps"][number]>;
      const focusNodeIds = Array.isArray(item.focusNodeIds)
        ? item.focusNodeIds
            .map((id) => safeId(id, ""))
            .filter((id) => nodeIds.has(id))
            .slice(0, 3)
        : [];
      const focusElementIds = Array.isArray(item.focusElementIds)
        ? item.focusElementIds
            .map((id) => safeId(id, ""))
            .filter((id) => elementIds.has(id) || semanticObjectIds.has(id))
            .slice(0, 5)
        : [];

      return {
        id: safeId(item.id, `step-${index + 1}`),
        title: safeString(item.title, `Step ${index + 1}`, 24),
        description: safeString(item.description, "Explain this transition.", 120),
        focusNodeIds: focusNodeIds.length > 0 ? focusNodeIds : [nodes[index % nodes.length].id],
        focusElementIds,
      };
    });

  if (steps.length === 0) {
    const semanticObjects = semantic.keyObjects.slice(0, 5);
    if (semanticObjects.length > 0) {
      semanticObjects.forEach((object, index) => {
        steps.push({
          id: `step-${index + 1}`,
          title: object.label,
          description: object.role,
          focusNodeIds: [],
          focusElementIds: [object.id],
        });
      });
    } else {
      nodes.slice(0, 4).forEach((node, index) => {
        steps.push({
          id: `step-${index + 1}`,
          title: node.label,
          description: node.detail,
          focusNodeIds: [node.id],
          focusElementIds: visualElements[index] ? [visualElements[index].id] : [],
        });
      });
    }
  }

  const diagramText = [
    source.title,
    source.summary,
    ...nodes.flatMap((node) => [node.label, node.detail]),
    ...visualElements.flatMap((element) => [element.label, element.detail]),
    ...parameters.flatMap((parameter) => [parameter.id, parameter.label]),
  ].join(" ");
  const diagramType = allowedDiagramTypes.has(source.diagramType as VisualDiagramType)
    ? (source.diagramType as VisualDiagramType)
    : inferDiagramType(kind, diagramText) ?? fallbackDiagramType;
  const fallbackSimulationModel = inferSimulationModelFromText(
    [
      source.title,
      source.summary,
      ...nodes.flatMap((node) => [node.label, node.detail]),
      ...parameters.flatMap((parameter) => [parameter.id, parameter.label]),
    ].join(" "),
  );

  const baseSpec: VisualSpecBase = {
    id: `visual-${activeContext.id}-${Date.now()}`,
    title: safeString(source.title, "Generated visual", 72),
    kind,
    diagramType,
    diagramPurpose: safeString(
      source.diagramPurpose,
      "用一张图说明这段论文的核心结构和关键关系。",
      140,
    ),
    readerTakeaway: safeString(
      source.readerTakeaway,
      source.summary || "先看清对象之间的关系，再理解参数变化如何影响机制。",
      160,
    ),
    semantic,
    mechanismBrief,
    principleDiagram,
    scene,
    sourceContextId: activeContext.id,
    summary: safeString(
      source.summary,
      "AI generated an interactive visualization from the selected passage.",
      220,
    ),
    nodes,
    edges,
    parameters,
    steps,
    visualElements,
    simulation: normalizeSimulation(source.simulation, fallbackSimulationModel),
  };

  return {
    ...baseSpec,
    htmlDemo: source.htmlDemo
      ? normalizeHtmlDemo(source.htmlDemo, baseSpec)
      : undefined,
  };
};

export const createMockVisualSpec = (
  activeContext: AiContextItem | undefined,
  revision: number,
): VisualSpec => {
  const titleSource = activeContext?.text
    ? clip(activeContext.text.replace(/\s+/g, " "), 42)
    : "Attention mechanism";

  const baseSpec: VisualSpecBase = {
    id: `attention-visual-${activeContext?.id || "sample"}-${revision}`,
    title: titleSource,
    kind: "mechanism-animation",
    diagramType: "mechanism",
    diagramPurpose: "说明 attention 如何把当前 token 和上下文 token 联系起来。",
    readerTakeaway:
      "先用 query 找到相关 key，再用 softmax 权重混合 value，输出新的上下文表示。",
    semantic: {
      template: "attention-matrix",
      problem: "当前 token 需要判断上下文中哪些位置最相关。",
      mechanism: [
        "当前 token 生成 Query。",
        "上下文 token 提供 Key 和 Value。",
        "Query 与 Key 计算 attention 权重。",
        "权重混合 Value 得到输出表示。",
      ],
      keyObjects: [
        { id: "tokens", label: "输入 tokens", role: "提供上下文位置" },
        { id: "query", label: "Query", role: "当前 token 的匹配请求" },
        { id: "key", label: "Key", role: "上下文位置的匹配索引" },
        { id: "weights", label: "attention 权重", role: "决定 value 混合比例" },
        { id: "output", label: "输出表示", role: "聚合后的上下文表示" },
      ],
      flows: [
        { from: "tokens", to: "query", label: "投影" },
        { from: "tokens", to: "key", label: "投影" },
        { from: "query", to: "weights", label: "匹配 Key" },
        { from: "key", to: "weights", label: "产生权重" },
        { from: "weights", to: "output", label: "混合 Value" },
      ],
      takeaway:
        "attention 的核心是用 Query 找相关 Key，再把对应 Value 按权重聚合。",
    },
    mechanismBrief: {
      mechanismName: "attention 加权聚合",
      coreProblem: "当前 token 需要从上下文 token 中找出真正相关的信息。",
      keyObjects: [
        {
          id: "tokens",
          label: "输入 tokens",
          role: "提供上下文位置",
          evidence: "论文片段中的上下文序列。",
        },
        {
          id: "query",
          label: "Query",
          role: "当前 token 的匹配请求",
          evidence: "决定要找什么信息。",
        },
        {
          id: "weights",
          label: "attention 权重",
          role: "把相关性变成混合比例",
          evidence: "softmax 后用于加权 Value。",
        },
        {
          id: "output",
          label: "输出表示",
          role: "聚合后的上下文表示",
          evidence: "作为下一层输入。",
        },
      ],
      causalChain: [
        "Query 表示当前 token 想匹配的信息。",
        "Key 提供每个上下文位置的可匹配索引。",
        "Query 与 Key 计算相关性并经过 softmax。",
        "权重越高的 Value 对输出贡献越大。",
      ],
      learningGoal: "看清 attention 如何把“相关性判断”变成“Value 加权混合”。",
      takeaway:
        "attention 的机理不是搬运信息，而是先打分再按权重聚合。",
    },
    principleDiagram: {
      title: "attention 原理图",
      diagramKind: "matrix-map",
      centralClaim: "Query 与 Key 产生权重矩阵，权重再控制 Value 聚合。",
      regions: [
        {
          id: "tokens",
          label: "上下文 tokens",
          role: "产生 Key / Value",
          detail: "每个位置都有可匹配索引和内容向量",
          x: 54,
          y: 112,
          width: 142,
          height: 94,
          tone: "blue",
        },
        {
          id: "query",
          label: "Query",
          role: "当前 token 请求",
          detail: "决定要关注什么",
          x: 230,
          y: 76,
          width: 126,
          height: 78,
          tone: "green",
        },
        {
          id: "weights",
          label: "attention 权重",
          role: "相关性矩阵",
          detail: "softmax 后形成混合比例",
          x: 390,
          y: 112,
          width: 142,
          height: 94,
          tone: "amber",
        },
        {
          id: "output",
          label: "输出表示",
          role: "加权混合结果",
          detail: "进入后续层",
          x: 568,
          y: 112,
          width: 104,
          height: 94,
          tone: "rose",
        },
      ],
      relations: [
        {
          id: "tokens-query",
          from: "tokens",
          to: "query",
          label: "投影当前请求",
          relationType: "transforms",
        },
        {
          id: "query-weights",
          from: "query",
          to: "weights",
          label: "与 Key 比较",
          relationType: "compares",
        },
        {
          id: "tokens-weights",
          from: "tokens",
          to: "weights",
          label: "提供 Key",
          relationType: "depends-on",
        },
        {
          id: "weights-output",
          from: "weights",
          to: "output",
          label: "加权 Value",
          relationType: "transforms",
        },
      ],
      annotations: [
        {
          id: "note-softmax",
          targetId: "weights",
          label: "关键",
          detail: "softmax 让高相关位置获得更大贡献。",
          tone: "amber",
        },
      ],
      takeaway:
        "先把相关性变成权重，再用权重控制 Value 的混合比例。",
    },
    scene: {
      title: "attention 计算机理",
      sceneKind: "matrix-computation",
      purpose: "用可移动的 token 单元展示 Query 如何读取 Key 并聚合 Value。",
      regions: [
        {
          id: "tokens-region",
          label: "上下文 tokens",
          role: "提供 Key / Value 来源",
          x: 42,
          y: 78,
          width: 186,
          height: 224,
          tone: "blue",
        },
        {
          id: "score-region",
          label: "attention 评分",
          role: "Query 与 Key 计算相关性",
          x: 258,
          y: 58,
          width: 184,
          height: 260,
          tone: "amber",
        },
        {
          id: "output-region",
          label: "加权输出",
          role: "按权重聚合 Value",
          x: 474,
          y: 78,
          width: 184,
          height: 224,
          tone: "green",
        },
      ],
      units: [
        { id: "q", label: "Q", kind: "query", regionId: "score-region", lane: 0, index: 0, tone: "green" },
        { id: "k1", label: "K1", kind: "key", regionId: "tokens-region", lane: 0, index: 0, tone: "blue", pairWith: "v1" },
        { id: "k2", label: "K2", kind: "key", regionId: "tokens-region", lane: 0, index: 1, tone: "blue", pairWith: "v2" },
        { id: "k3", label: "K3", kind: "key", regionId: "tokens-region", lane: 0, index: 2, tone: "blue", pairWith: "v3" },
        { id: "v1", label: "V1", kind: "value", regionId: "tokens-region", lane: 1, index: 0, tone: "amber", pairWith: "k1" },
        { id: "v2", label: "V2", kind: "value", regionId: "tokens-region", lane: 1, index: 1, tone: "amber", pairWith: "k2" },
        { id: "v3", label: "V3", kind: "value", regionId: "tokens-region", lane: 1, index: 2, tone: "amber", pairWith: "k3" },
        { id: "w1", label: "0.2", kind: "weight", regionId: "score-region", lane: 1, index: 0, tone: "rose" },
        { id: "w2", label: "0.7", kind: "weight", regionId: "score-region", lane: 1, index: 1, tone: "rose" },
        { id: "w3", label: "0.1", kind: "weight", regionId: "score-region", lane: 1, index: 2, tone: "rose" },
        { id: "out", label: "Σ wV", kind: "output", regionId: "output-region", lane: 0, index: 1, tone: "green" },
      ],
      steps: [
        {
          id: "scene-query",
          title: "生成 Query",
          description: "当前 token 形成 Query，准备和上下文 Key 比较。",
          operation: "lookup",
          activeUnitIds: ["q"],
          fromRegionId: "tokens-region",
          toRegionId: "score-region",
          resultUnitIds: ["q"],
        },
        {
          id: "scene-score",
          title: "计算相关性",
          description: "Query 逐个读取 Key，得到不同强度的 attention 权重。",
          operation: "compute",
          activeUnitIds: ["q", "k1", "k2", "k3", "w1", "w2", "w3"],
          fromRegionId: "tokens-region",
          toRegionId: "score-region",
          resultUnitIds: ["w1", "w2", "w3"],
        },
        {
          id: "scene-mix",
          title: "混合 Value",
          description: "权重较高的 Value 对输出贡献更大，形成上下文表示。",
          operation: "accumulate",
          activeUnitIds: ["v1", "v2", "v3", "w1", "w2", "w3", "out"],
          fromRegionId: "score-region",
          toRegionId: "output-region",
          resultUnitIds: ["out"],
        },
      ],
      takeaway:
        "attention 不是简单传递，而是先比较相关性，再按权重把 Value 聚合成输出。",
    },
    sourceContextId: activeContext?.id,
    summary:
      "本地预览图会把选中片段转成一张少元素、强关系的原理说明图。",
    nodes: [
      {
        id: "tokens",
        label: "输入 tokens",
        detail: "上下文位置",
        x: 96,
        y: 180,
        tone: "blue",
      },
      {
        id: "query",
        label: "Query",
        detail: "当前关注",
        x: 250,
        y: 124,
        tone: "green",
      },
      {
        id: "key",
        label: "Key",
        detail: "匹配索引",
        x: 250,
        y: 238,
        tone: "amber",
      },
      {
        id: "score",
        label: "匹配分数",
        detail: "Q x K",
        x: 430,
        y: 180,
        tone: "rose",
      },
      {
        id: "output",
        label: "输出表示",
        detail: "加权 value",
        x: 600,
        y: 180,
        tone: "green",
      },
    ],
    edges: [
      {
        id: "tokens-query",
        from: "tokens",
        to: "query",
        label: "project",
        strength: 0.7,
      },
      {
        id: "tokens-key",
        from: "tokens",
        to: "key",
        label: "project",
        strength: 0.62,
      },
      {
        id: "query-score",
        from: "query",
        to: "score",
        label: "比较",
        strength: 0.88,
      },
      {
        id: "key-score",
        from: "key",
        to: "score",
        label: "匹配",
        strength: 0.82,
      },
      {
        id: "score-output",
        from: "score",
        to: "output",
        label: "softmax 权重",
        strength: 0.92,
      },
    ],
    parameters: [
      {
        id: "contextTokens",
        label: "上下文 token",
        min: 8,
        max: 128,
        step: 1,
        defaultValue: 48,
        unit: "token",
      },
      {
        id: "focusSharpness",
        label: "注意力集中度",
        min: 1,
        max: 10,
        step: 1,
        defaultValue: 6,
      },
    ],
    visualElements: [
      {
        id: "attention-matrix",
        kind: "matrix",
        label: "attention 权重",
        detail: "越亮表示越相关",
        x: 360,
        y: 64,
        width: 132,
        height: 90,
        rows: 5,
        cols: 6,
        cells: [
          0.2, 0.4, 0.7, 0.5, 0.3, 0.25,
          0.15, 0.35, 0.8, 0.62, 0.42, 0.3,
          0.12, 0.28, 0.76, 0.9, 0.55, 0.36,
          0.1, 0.22, 0.48, 0.72, 0.86, 0.5,
          0.08, 0.18, 0.32, 0.52, 0.7, 0.92,
        ],
        tone: "blue",
        parameterId: "focusSharpness",
      },
      {
        id: "softmax-formula",
        kind: "formula",
        label: "softmax(QK^T / sqrt(d)) · V",
        detail: "权重混合 value",
        x: 326,
        y: 264,
        width: 250,
        height: 38,
        tone: "amber",
      },
      {
        id: "focus-bar",
        kind: "bar",
        label: "关注集中度",
        x: 72,
        y: 290,
        width: 150,
        height: 12,
        value: 0.62,
        tone: "green",
        parameterId: "focusSharpness",
      },
    ],
    steps: [
      {
        id: "input",
        title: "输入",
        description: "上下文 tokens 先提供可被关注的信息位置。",
        focusNodeIds: ["tokens"],
        focusElementIds: [],
      },
      {
        id: "projection",
        title: "投影",
        description: "当前 token 产生 Query，上下文位置提供 Key。",
        focusNodeIds: ["query", "key"],
        focusElementIds: [],
      },
      {
        id: "score",
        title: "打分",
        description: "Query 与 Key 比较，形成 attention 权重矩阵。",
        focusNodeIds: ["score"],
        focusElementIds: ["attention-matrix"],
      },
      {
        id: "mix",
        title: "聚合",
        description: "softmax 权重决定哪些 value 被更多混合到输出。",
        focusNodeIds: ["output"],
        focusElementIds: ["softmax-formula", "focus-bar"],
      },
    ],
    simulation: {
      model: "attention-flow",
      description: "简化的 attention 教学示意，不展示无关硬件指标。",
    },
  };

  return {
    ...baseSpec,
    htmlDemo: createFallbackHtmlDemo(baseSpec),
  };
};

// iframe 的 CSP 禁止联网和外部资源，但允许 demo 内部的内联脚本做参数重算。
const buildSandboxSrcDoc = (html: string) =>
  [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; connect-src \'none\'; font-src \'none\'; media-src \'none\'; object-src \'none\'; frame-src \'none\'; base-uri \'none\'; form-action \'none\'">',
    "</head>",
    "<body>",
    html,
    "</body>",
    "</html>",
  ].join("");

export function VisualLab({
  contextItems,
  hideGenerate = false,
  modelConfig,
  paper,
  paperTextPages,
  specOverride,
}: VisualLabProps) {
  const [revision, setRevision] = useState(0);
  const activeContext = contextItems[0];
  const [generatedSpec, setGeneratedSpec] = useState<VisualSpec | null>(null);
  const [generatedHtmlDemo, setGeneratedHtmlDemo] =
    useState<VisualHtmlDemo | null>(null);
  const [htmlGenerationStatus, setHtmlGenerationStatus] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [htmlGenerationError, setHtmlGenerationError] = useState<string | null>(
    null,
  );
  const [svgFacets, setSvgFacets] = useState<SvgFacet[]>([]);
  const [activeFacetIndex, setActiveFacetIndex] = useState(0);
  const generatedSvgDiagram = svgFacets[activeFacetIndex]?.svg ?? null;
  const svgGenerationStatus = svgFacets.length === 0
    ? "idle"
    : svgFacets.some((f) => f.status === "loading")
      ? "loading"
      : svgFacets.some((f) => f.status === "done")
        ? "done"
        : svgFacets.every((f) => f.status === "error")
          ? "error"
          : "idle";
  const svgGenerationError = svgFacets.length > 0 &&
    svgFacets.every((f) => f.status === "error")
    ? svgFacets.map((f) => f.error).filter(Boolean).join("; ")
    : null;
  const [generatedSvgExplanation, setGeneratedSvgExplanation] = useState<
    string | null
  >(null);
  const [svgExplanationStatus, setSvgExplanationStatus] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [svgExplanationError, setSvgExplanationError] = useState<string | null>(
    null,
  );
  const [generationStatus, setGenerationStatus] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [generationError, setGenerationError] = useState<string | null>(null);
  const fallbackSpec = useMemo(
    () => createMockVisualSpec(activeContext, revision),
    [activeContext, revision],
  );
  const spec = specOverride ?? generatedSpec ?? fallbackSpec;
  const [parameterValues, setParameterValues] = useState<Record<string, number>>(
    () => parameterDefaults(spec.parameters),
  );
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [viewMode, setViewMode] = useState<VisualViewMode>("html");
  const hasManualViewModeRef = useRef(false);
  const isGeneratingVisualRef = useRef(false);
  const simulationState = useMemo(
    () => computeVisualSimulation(spec, parameterValues),
    [parameterValues, spec],
  );

  useEffect(() => {
    setGeneratedSpec(null);
    // Preserve generated SVG and HTML so the diagram stays visible
    // when the user switches PDF context.  Only clear status flags
    // so the Generate button resets to idle.  The old content will be
    // replaced once the user explicitly clicks Generate for the new
    // context (spec.id change triggers the clear effect below).
    setHtmlGenerationStatus("idle");
    setHtmlGenerationError(null);
    // Facets are preserved — svgGenerationStatus is derived from them.
    setGenerationStatus("idle");
    setGenerationError(null);
    setRevision((value) => value + 1);
    hasManualViewModeRef.current = false;
    // Do NOT reset viewMode — keep S mode if the user was viewing SVG.
  }, [activeContext?.id]);

  useEffect(() => {
    setParameterValues(parameterDefaults(spec.parameters));
    setActiveStepIndex(0);
  }, [spec.id, spec.parameters]);

  useEffect(() => {
    // Skip clearing if generateVisual is actively running — it will
    // populate these fields itself.  Without this guard the spec.id
    // change caused by setGeneratedSpec wipes the in-flight results,
    // making content flash then disappear.
    if (isGeneratingVisualRef.current) {
      return;
    }
    setGeneratedHtmlDemo(null);
    setHtmlGenerationStatus("idle");
    setHtmlGenerationError(null);
    setSvgFacets([]);
    setActiveFacetIndex(0);
    setGeneratedSvgExplanation(null);
    setSvgExplanationStatus("idle");
    setSvgExplanationError(null);
  }, [spec.id]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const interval = window.setInterval(() => {
      const stepCount = spec.scene?.steps.length || spec.steps.length;
      setActiveStepIndex((index) => (index + 1) % stepCount);
    }, 1800);

    return () => window.clearInterval(interval);
  }, [isPlaying, spec.scene?.steps.length, spec.steps.length]);

  const visualStepCount = spec.scene?.steps.length || spec.steps.length;
  const activeStep = spec.steps[activeStepIndex % spec.steps.length];
  const activeSceneStep = spec.scene?.steps[activeStepIndex % spec.scene.steps.length];
  const focusNodeIds = new Set(activeStep.focusNodeIds);
  const focusElementIds = new Set([
    ...(activeStep.focusElementIds ?? []),
    ...(activeSceneStep?.activeUnitIds ?? []),
    ...(activeSceneStep?.resultUnitIds ?? []),
    ...(activeSceneStep?.fromRegionId ? [activeSceneStep.fromRegionId] : []),
    ...(activeSceneStep?.toRegionId ? [activeSceneStep.toRegionId] : []),
  ]);

  const updateParameter = (parameter: VisualParameter, value: number) => {
    setParameterValues((current) => ({
      ...current,
      [parameter.id]: value,
    }));
  };

  const goToStep = (direction: -1 | 1) => {
    setActiveStepIndex((index) =>
      (index + direction + visualStepCount) % visualStepCount,
    );
  };

  const generateHtmlDemo = async (targetSpec: VisualSpec) => {
    // 生成 B 模式：把当前论文选区 + 全文摘录 + 结构化 VisualSpec
    // 发给模型，让模型写一段自包含 HTML/SVG/JS 交互课件。
    if (!activeContext?.text.trim()) {
      setHtmlGenerationStatus("error");
      setHtmlGenerationError("Select a PDF paragraph before generating HTML.");
      return null;
    }

    log.info("VisualLab", "generateHtmlDemo start", { title: targetSpec.title, kind: targetSpec.kind });
    setHtmlGenerationStatus("loading");
    setHtmlGenerationError(null);

    const paperContext = buildPaperContextExcerpt(
      paperTextPages,
      activeContext.pageNumber,
    );
    const messages: AiMessage[] = [
      {
        id: makeId(),
        role: "user",
        content: buildVisualHtmlPrompt({
          activeContext,
          paper,
          paperContext,
          spec: targetSpec,
        }),
        createdAt: new Date().toISOString(),
      },
    ];

    try {
      const response = await window.paperSuper?.sendAiMessage({
        config: {
          ...modelConfig,
          maxTokens: Math.max(modelConfig.maxTokens, 9000),
        },
        paperTitle: paper.title,
        contextItems: [
          activeContext,
          ...contextItems
            .filter((item) => item.id !== activeContext.id)
            .slice(0, 3),
        ],
        messages,
      });
      const html = extractHtmlFragment(response?.content || "");
      const htmlDemo: VisualHtmlDemo = {
        title: `${targetSpec.title} AI 可视化`,
        notes: "AI 直接生成的 sandbox HTML/SVG/JS 机制图。",
        html,
      };
      // 模型写出的 HTML 必须先通过完整性/安全兜底检查；
      // 检查不通过时 normalizeHtmlDemo 会直接替换成本地教学课件。
      const normalizedDemo = normalizeHtmlDemo(htmlDemo, targetSpec);

      log.info("VisualLab", "generateHtmlDemo done", {
        htmlLen: normalizedDemo.html.length,
      });
      setGeneratedHtmlDemo(normalizedDemo);
      setHtmlGenerationStatus("done");
      return normalizedDemo;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "HTML generation failed.";
      log.warn("VisualLab", "generateHtmlDemo failed, using fallback", { error: message });
      const fallbackDemo = createFallbackHtmlDemo(targetSpec);
      setGeneratedHtmlDemo(fallbackDemo);
      setHtmlGenerationStatus("error");
      setHtmlGenerationError(message);
      return fallbackDemo;
    }
  };

  const generateSvgFacets = async (targetSpec: VisualSpec): Promise<boolean> => {
    if (!activeContext?.text.trim()) {
      setSvgFacets([]);
      return false;
    }

    log.info("VisualLab", "generateSvgFacets start", { title: targetSpec.title });

    const paperContext = buildPaperContextExcerpt(
      paperTextPages,
      activeContext.pageNumber,
    );

    // Phase 1: Get facet definitions from AI
    let facetDefs: Array<{ title: string; focus: string }>;
    try {
      const facetDefMessages: AiMessage[] = [
        {
          id: makeId(),
          role: "user",
          content: buildSvgFacetsPrompt({
            activeContext,
            paper,
            paperContext,
            spec: targetSpec,
          }),
          createdAt: new Date().toISOString(),
        },
      ];
      const facetDefResponse = await window.paperSuper?.sendAiMessage({
        config: {
          ...modelConfig,
          maxTokens: Math.max(modelConfig.maxTokens, 8000),
        },
        paperTitle: paper.title,
        contextItems: [
          activeContext,
          ...contextItems
            .filter((item) => item.id !== activeContext.id)
            .slice(0, 3),
        ],
        messages: facetDefMessages,
      });
      const rawDefs = parseModelJsonObject(facetDefResponse?.content || "[]");
      facetDefs = Array.isArray(rawDefs)
        ? rawDefs.filter(
            (d: unknown) =>
              d &&
              typeof d === "object" &&
              typeof (d as Record<string, unknown>).title === "string" &&
              typeof (d as Record<string, unknown>).focus === "string",
          )
        : [];
      if (facetDefs.length === 0) {
        facetDefs = [
          { title: "原理图", focus: "Complete principle diagram showing the overall concept" },
        ];
      }
      log.info("VisualLab", "generateSvgFacets phase 1 done", {
        facetCount: facetDefs.length,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Facet definition failed.";
      log.warn("VisualLab", "generateSvgFacets phase 1 failed", {
        error: message,
      });
      facetDefs = [
        { title: "原理图", focus: "Complete principle diagram showing the overall concept" },
      ];
    }

    // Initialize facets with pending status
    const initialFacets: SvgFacet[] = facetDefs.map((d) => ({
      title: d.title,
      focus: d.focus,
      svg: null,
      status: "pending" as const,
      error: null,
    }));
    setSvgFacets(initialFacets);
    setActiveFacetIndex(0);

    // Phase 2: Generate all SVGs in parallel, updating progressively
    const results = await Promise.allSettled(
      facetDefs.map(async (def, index) => {
        // Mark this facet as loading
        setSvgFacets((prev) =>
          prev.map((f, i) => (i === index ? { ...f, status: "loading" as const } : f)),
        );

        try {
          const messages: AiMessage[] = [
            {
              id: makeId(),
              role: "user",
              content: buildFacetSvgPrompt({
                activeContext,
                paper,
                paperContext,
                spec: targetSpec,
                facetTitle: def.title,
                facetFocus: def.focus,
                facetIndex: index,
                totalFacets: facetDefs.length,
              }),
              createdAt: new Date().toISOString(),
            },
          ];

          const response = await window.paperSuper?.sendAiMessage({
            config: {
              ...modelConfig,
              maxTokens: Math.max(modelConfig.maxTokens, 12000),
            },
            paperTitle: paper.title,
            contextItems: [
              activeContext,
              ...contextItems
                .filter((item) => item.id !== activeContext.id)
                .slice(0, 3),
            ],
            messages,
          });

          const svg = extractSvgDiagram(response?.content || "");
          if (!svg) {
            throw new Error("AI 没有返回有效的 SVG 原理图。");
          }

          log.info("VisualLab", "generateSvgFacets facet done", {
            index,
            title: def.title,
            svgLen: svg.length,
          });
          setSvgFacets((prev) =>
            prev.map((f, i) =>
              i === index ? { ...f, svg, status: "done" as const } : f,
            ),
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "SVG generation failed.";
          log.warn("VisualLab", "generateSvgFacets facet failed", {
            index,
            title: def.title,
            error: message,
          });
          setSvgFacets((prev) =>
            prev.map((f, i) =>
              i === index ? { ...f, status: "error" as const, error: message } : f,
            ),
          );
        }
      }),
    );

    log.info("VisualLab", "generateSvgFacets all done");
    return results.some((r) => r.status === "fulfilled");
  };

  const generateSvgExplanation = async (targetSpec: VisualSpec) => {
    if (!activeContext?.text.trim()) {
      setSvgExplanationStatus("error");
      setSvgExplanationError("Select a PDF paragraph before generating.");
      return null;
    }

    log.info("VisualLab", "generateSvgExplanation start", {
      title: targetSpec.title,
    });
    setSvgExplanationStatus("loading");
    setSvgExplanationError(null);

    const paperContext = buildPaperContextExcerpt(
      paperTextPages,
      activeContext.pageNumber,
    );
    const messages: AiMessage[] = [
      {
        id: makeId(),
        role: "user",
        content: buildSvgExplanationPrompt({
          activeContext,
          paper,
          paperContext,
          spec: targetSpec,
        }),
        createdAt: new Date().toISOString(),
      },
    ];

    try {
      const response = await window.paperSuper?.sendAiMessage({
        config: {
          ...modelConfig,
          maxTokens: Math.max(modelConfig.maxTokens, 4000),
        },
        paperTitle: paper.title,
        contextItems: [
          activeContext,
          ...contextItems
            .filter((item) => item.id !== activeContext.id)
            .slice(0, 3),
        ],
        messages,
      });

      const explanation = (response?.content || "").trim();
      if (!explanation) {
        throw new Error("AI 没有返回原理图解释。");
      }

      log.info("VisualLab", "generateSvgExplanation done", {
        explanationLen: explanation.length,
      });
      setGeneratedSvgExplanation(explanation);
      setSvgExplanationStatus("done");
      return explanation;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "SVG explanation generation failed.";
      log.warn("VisualLab", "generateSvgExplanation failed", {
        error: message,
      });
      setGeneratedSvgExplanation(null);
      setSvgExplanationStatus("error");
      setSvgExplanationError(message);
      return null;
    }
  };

  const generateVisual = async () => {
    if (hideGenerate) {
      return;
    }

    if (!activeContext?.text.trim()) {
      setGenerationStatus("error");
      setGenerationError("Select a PDF paragraph before generating a visual.");
      return;
    }

    setGenerationStatus("loading");
    setGenerationError(null);
    isGeneratingVisualRef.current = true;

    log.info("VisualLab", "generateVisual start", { paper: paper.title });
    const createdAt = new Date().toISOString();
    const prompt = buildVisualPrompt({
      activeContext,
      paper,
      paperContext: buildPaperContextExcerpt(
        paperTextPages,
        activeContext.pageNumber,
      ),
    });
    const messages: AiMessage[] = [
      {
        id: makeId(),
        role: "user",
        content: prompt,
        createdAt,
      },
    ];

    try {
      const response = await window.paperSuper?.sendAiMessage({
        config: {
          ...modelConfig,
          maxTokens: Math.max(modelConfig.maxTokens, 9000),
        },
        paperTitle: paper.title,
        contextItems: [
          activeContext,
          ...contextItems
            .filter((item) => item.id !== activeContext.id)
            .slice(0, 3),
        ],
        messages,
      });

      const rawSpec = parseModelJsonObject(response?.content || "");
      const nextSpec = normalizeVisualSpec(rawSpec, activeContext);
      setGeneratedSpec(nextSpec);
      log.info("VisualLab", "generateVisual spec parsed", {
        kind: nextSpec.kind,
        hasPrincipleDiagram: !!nextSpec.principleDiagram,
        hasScene: !!nextSpec.scene,
      });
      await Promise.allSettled([
        generateHtmlDemo(nextSpec),
        generateSvgFacets(nextSpec),
        generateSvgExplanation(nextSpec),
      ]);
      setGenerationStatus("done");
      setIsPlaying(true);
      if (!hasManualViewModeRef.current) {
        setViewMode("svg");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Visual generation failed.";
      log.error("VisualLab", "generateVisual failed", { error: message });
      setGeneratedSpec(null);
      setRevision((value) => value + 1);
      setGenerationStatus("error");
      setGenerationError(message);
    } finally {
      isGeneratingVisualRef.current = false;
    }
  };

  const generateVisualAssets = async () => {
    // Workbench 嵌入态的手动入口：点击“生成可视化”后才会请求 S/B。
    // 这避免了用户只是选中/切换 PDF 上下文时，VisualLab 自动连续消耗 AI。
    if (!activeContext?.text.trim()) {
      setHtmlGenerationStatus("error");
      setHtmlGenerationError("请先在 PDF 中选择一段内容。");
      return;
    }

    const [htmlResult, svgOk] = await Promise.all([
      // B 模式：AI HTML/SVG/JS 动画课件。
      generateHtmlDemo(spec),
      // S 模式：多侧面 AI SVG 原理图。
      generateSvgFacets(spec),
      // D 模式：原理图文字解释。
      generateSvgExplanation(spec),
    ]);

    if (svgOk && !hasManualViewModeRef.current) {
      setViewMode("svg");
      return;
    }

    if (htmlResult && !hasManualViewModeRef.current) {
      setViewMode("html");
    }
  };

  const isVisualAssetLoading =
    htmlGenerationStatus === "loading" ||
    svgGenerationStatus === "loading" ||
    svgExplanationStatus === "loading";
  const hasGeneratedVisualAssets = Boolean(generatedHtmlDemo || generatedSvgDiagram);

  const statusLabel =
    generationStatus === "loading"
      ? "正在生成图解..."
      : svgGenerationStatus === "loading"
        ? "正在生成高清原理图..."
      : htmlGenerationStatus === "loading"
        ? "正在生成 AI 可视化代码..."
      : svgExplanationStatus === "loading"
        ? "正在生成原理解释..."
      : svgGenerationStatus === "error" &&
          htmlGenerationStatus === "error" &&
          !generatedHtmlDemo
        ? "AI 原理图和动画生成失败，请检查模型配置后手动重试"
      : svgGenerationStatus === "error"
        ? `原理图生成失败：${svgGenerationError ?? "未知错误"}`
      : htmlGenerationStatus === "error"
        ? `${htmlGenerationError ?? "AI 可视化代码生成失败"}，B 模式已使用本地兜底`
      : specOverride && hasGeneratedVisualAssets
        ? "AI 可视化已加载"
      : specOverride
        ? "已加载本地预览，点击生成可视化后才会请求 AI"
        : generationStatus === "done" &&
            svgGenerationStatus === "done" &&
            svgExplanationStatus === "done"
          ? "AI 图解 + 原理图 + 解释已加载"
        : generationStatus === "done" && svgGenerationStatus === "done"
          ? "AI 图解 + 原理图已加载"
        : generationStatus === "done"
          ? "AI 图解已加载"
          : generationStatus === "error"
            ? generationError
            : hasGeneratedVisualAssets
              ? "已切换选区，图解仍为上一次生成结果"
              : activeContext
                ? "可根据当前选区生成图解"
                : "请先在 PDF 中选择一段内容";

  return (
    <div className="visualLab">
      <section className="visualHero">
        <div className="visualHeroHeader">
          <div className="visualSourceBlock">
            <span className="visualSourceLabel">
              {generatedSpec ? "AI 图解" : "本地预览"} - Page{" "}
              {activeContext?.pageNumber || "sample"}
            </span>
            <strong title={spec.title}>{spec.title}</strong>
          </div>
          <div className="visualHeaderActions">
            <div className="visualModeSwitch" aria-label="Visual rendering mode">
              <button
                type="button"
                className={`visualModeButton ${viewMode === "structured" ? "active" : ""}`}
                onClick={() => {
                  hasManualViewModeRef.current = true;
                  setViewMode("structured");
                }}
              >
                A
              </button>
              <button
                type="button"
                className={`visualModeButton ${viewMode === "html" ? "active" : ""}`}
                onClick={() => {
                  hasManualViewModeRef.current = true;
                  setViewMode("html");
                }}
              >
                B
              </button>
              <button
                type="button"
                className={`visualModeButton ${viewMode === "svg" ? "active" : ""}`}
                onClick={() => {
                  hasManualViewModeRef.current = true;
                  setViewMode("svg");
                }}
              >
                S
              </button>
            </div>
            {hideGenerate ? (
              <button
                type="button"
                className="ghostButton compactButton"
                disabled={isVisualAssetLoading || !activeContext}
                onClick={() => void generateVisualAssets()}
              >
                <Sparkles size={13} />
                <span>
                  {isVisualAssetLoading
                    ? "Working"
                    : hasGeneratedVisualAssets
                      ? "重新生成"
                      : "生成可视化"}
                </span>
              </button>
            ) : (
              <button
                type="button"
                className="ghostButton compactButton"
                disabled={generationStatus === "loading" || !activeContext}
                onClick={() => void generateVisual()}
              >
                <Sparkles size={13} />
                <span>{generationStatus === "loading" ? "Working" : "Generate"}</span>
              </button>
            )}
          </div>
        </div>

        {viewMode === "structured" ? (
          <>
            <div className="visualStructuredStack">
              {spec.principleDiagram ? (
                <PrincipleDiagramCanvas
                  brief={spec.mechanismBrief}
                  diagram={spec.principleDiagram}
                  focusElementIds={focusElementIds}
                  isPlaying={isPlaying}
                  parameterValues={parameterValues}
                  parameters={spec.parameters}
                  spec={spec}
                />
              ) : spec.semantic ? (
                <SemanticVisualCanvas
                  focusElementIds={focusElementIds}
                  isPlaying={isPlaying}
                  parameterValues={parameterValues}
                  parameters={spec.parameters}
                  semantic={spec.semantic}
                  spec={spec}
                />
              ) : (
                <VisualCanvas
                  edges={spec.edges}
                  focusElementIds={focusElementIds}
                  focusNodeIds={focusNodeIds}
                  isPlaying={isPlaying}
                  spec={spec}
                  nodes={spec.nodes}
                  parameters={spec.parameters}
                  parameterValues={parameterValues}
                  simulationState={simulationState}
                  visualElements={spec.visualElements ?? []}
                />
              )}

              {spec.scene ? (
                <MechanismSceneCanvas
                  activeStepIndex={activeStepIndex}
                  focusElementIds={focusElementIds}
                  isPlaying={isPlaying}
                  parameterValues={parameterValues}
                  parameters={spec.parameters}
                  scene={spec.scene}
                  spec={spec}
                />
              ) : null}
            </div>

            <div className="visualPlayback">
              <button
                type="button"
                className="textIconButton"
                aria-label="Previous visual step"
                onClick={() => goToStep(-1)}
              >
                <SkipBack size={13} />
              </button>
              <button
                type="button"
                className="textIconButton"
                aria-label={isPlaying ? "Pause visual scene" : "Play visual scene"}
                onClick={() => setIsPlaying((playing) => !playing)}
              >
                {isPlaying ? <Pause size={13} /> : <Play size={13} />}
              </button>
              <button
                type="button"
                className="textIconButton"
                aria-label="Next visual step"
                onClick={() => goToStep(1)}
              >
                <SkipForward size={13} />
              </button>
              <div className="visualStepText">
                <strong>{activeSceneStep?.title ?? activeStep.title}</strong>
                <span>{activeSceneStep?.description ?? activeStep.description}</span>
              </div>
              <button
                type="button"
                className="textIconButton"
                aria-label="Reset visual scene"
                onClick={() => {
                  setActiveStepIndex(0);
                  setParameterValues(parameterDefaults(spec.parameters));
                }}
              >
                <RotateCcw size={13} />
              </button>
            </div>
          </>
        ) : viewMode === "svg" ? (
          <>
            <FacetSvgRenderer
              facets={svgFacets}
              activeIndex={activeFacetIndex}
              onSelect={setActiveFacetIndex}
            />
            <SvgExplanationRenderer
              explanation={generatedSvgExplanation}
              status={svgExplanationStatus}
              error={svgExplanationError}
            />
          </>
        ) : (
          // B 模式显示入口：优先使用模型生成并通过 normalizeHtmlDemo 的 HTML；
          // 其次兼容旧 VisualSpec.htmlDemo；最后使用本地 fallback 课件。
          <HtmlSandbox
            htmlDemo={
              generatedHtmlDemo ?? spec.htmlDemo ?? createFallbackHtmlDemo(spec)
            }
          />
        )}
      </section>

      <section className="visualControls">
        <div className="visualSectionTitle">
          <SlidersHorizontal size={13} />
          <span>可调参数</span>
        </div>
        {spec.parameters.map((parameter) => (
          <label className="visualSliderRow" key={parameter.id}>
            <span>{parameter.label}</span>
            <input
              type="range"
              min={parameter.min}
              max={parameter.max}
              step={parameter.step}
              value={parameterValues[parameter.id] ?? parameter.defaultValue}
              onChange={(event) =>
                updateParameter(parameter, Number(event.target.value))
              }
            />
            <strong>
              {parameterValues[parameter.id] ?? parameter.defaultValue}
              {parameter.unit ? ` ${parameter.unit}` : ""}
            </strong>
          </label>
        ))}
        <div className="visualParameterEffects">
          {(activeSceneStep?.parameterEffects?.length
            ? activeSceneStep.parameterEffects
            : spec.parameters.map(
                (parameter) =>
                  `${parameter.label} 会改变原理图强调程度、动画密度或步骤速度。`,
              )
          )
            .slice(0, 3)
            .map((effect, index) => (
              <p key={`${effect}-${index}`}>{effect}</p>
            ))}
        </div>
      </section>

      <section className="visualNotes">
        <div className="visualSectionTitle">
          <Sparkles size={13} />
          <span>图解说明</span>
        </div>
        <p>{spec.summary}</p>
        <p className={generationStatus === "error" ? "visualStatus error" : "visualStatus"}>
          {statusLabel}
        </p>
        <p>{activeContext ? clip(activeContext.text, 180) : "attention 示例图解"}</p>
      </section>
    </div>
  );
}

function FacetSvgRenderer({
  facets,
  activeIndex,
  onSelect,
}: {
  facets: SvgFacet[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);

  const handleWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    setZoom((prev) => Math.min(3, Math.max(0.3, prev - e.deltaY * 0.003)));
  };

  const handleDoubleClick = () => {
    setZoom(1);
  };

  if (facets.length === 0) {
    return (
      <div className="visualSvgDiagram">
        <div className="visualSvgPlaceholder">
          点击生成可视化，手动请求 AI 生成高清原理图
        </div>
      </div>
    );
  }

  const activeFacet = facets[activeIndex];

  return (
    <div className="facetSvgContainer">
      <div className="facetTabs">
        {facets.map((facet, i) => (
          <button
            key={i}
            type="button"
            className={`facetTab ${i === activeIndex ? "active" : ""}`}
            onClick={() => onSelect(i)}
          >
            {facet.status === "loading" && (
              <Sparkles size={10} className="facetTabSpinner" />
            )}
            {facet.status === "error" && (
              <span className="facetTabError">!</span>
            )}
            <span>{facet.title}</span>
          </button>
        ))}
      </div>
      <div
        className={`visualSvgDiagram ${expanded ? "expanded" : ""}`}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
      >
        {activeFacet?.svg && (
          <div className="visualSvgToolbar">
            <span className="visualSvgZoomLabel">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom(1)}
              title="重置缩放"
            >
              1:1
            </button>
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              title={expanded ? "收起" : "展开全尺寸"}
            >
              {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        )}
        {activeFacet?.status === "loading" ? (
          <div className="visualSvgLoading">
            <Sparkles size={18} className="visualSvgLoadingIcon" />
            <span>正在生成「{activeFacet.title}」...</span>
          </div>
        ) : activeFacet?.status === "error" ? (
          <div className="visualSvgPlaceholder">
            原理图生成失败：{activeFacet.error ?? "未知错误"}
          </div>
        ) : activeFacet?.svg ? (
          <div
            className="visualSvgZoomWrapper"
            style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
            dangerouslySetInnerHTML={{ __html: activeFacet.svg }}
          />
        ) : (
          <div className="visualSvgPlaceholder">
            等待生成...
          </div>
        )}
      </div>
    </div>
  );
}

function SvgExplanationRenderer({
  explanation,
  status,
  error,
}: {
  explanation: string | null;
  status: "idle" | "loading" | "done" | "error";
  error: string | null;
}) {
  if (status === "loading") {
    return (
      <div className="svgExplanationCard">
        <div className="svgExplanationLoading">
          <Sparkles size={14} className="visualSvgLoadingIcon" />
          <span>正在生成原理图解释...</span>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="svgExplanationCard">
        <div className="svgExplanationError">
          原理图解释生成失败：{error ?? "未知错误"}
        </div>
      </div>
    );
  }

  if (!explanation) {
    return null;
  }

  return (
    <div className="svgExplanationCard">
      <div className="svgExplanationContent">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {explanation}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function HtmlSandbox({ htmlDemo }: { htmlDemo: VisualHtmlDemo }) {
  return (
    <div className="visualSandboxShell">
      {/* AI 生成的 B 模式代码只在 iframe sandbox 中运行，不接触 React/Node/文件系统。 */}
      <iframe
        className="visualSandboxFrame"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={buildSandboxSrcDoc(htmlDemo.html)}
        title={htmlDemo.title}
      />
      <div className="visualSandboxFooter">
        <strong>{htmlDemo.title}</strong>
        {htmlDemo.notes ? <span>{htmlDemo.notes}</span> : null}
      </div>
    </div>
  );
}

const principleDiagramKindLabel = (kind: VisualPrincipleDiagramKind) => {
  const labels: Record<VisualPrincipleDiagramKind, string> = {
    "structure-map": "结构原理图",
    "mechanism-map": "机理示意图",
    "matrix-map": "矩阵原理图",
    "equation-map": "公式原理图",
    "comparison-map": "对比原理图",
    "timeline-map": "阶段原理图",
    "geometry-map": "几何原理图",
  };

  return labels[kind];
};

const principleRegionById = (
  regions: VisualPrincipleRegion[],
  id: string | undefined,
) => regions.find((region) => region.id === id);

const principleRegionCenter = (region: VisualPrincipleRegion) => ({
  x: region.x + region.width / 2,
  y: region.y + region.height / 2,
});

const relationLabel = (relationType: VisualPrincipleRelationType | undefined) => {
  const labels: Record<VisualPrincipleRelationType, string> = {
    causes: "因果",
    "depends-on": "依赖",
    transfers: "传输",
    transforms: "变换",
    predicts: "预测",
    compares: "比较",
    contains: "包含",
  };

  return relationType ? labels[relationType] : "关系";
};

function PrincipleDiagramCanvas({
  brief,
  diagram,
  focusElementIds,
  isPlaying,
  parameters,
  parameterValues,
  spec,
}: {
  brief: VisualMechanismBrief | undefined;
  diagram: VisualPrincipleDiagram;
  focusElementIds: Set<string>;
  isPlaying: boolean;
  parameters: VisualParameter[];
  parameterValues: Record<string, number>;
  spec: VisualSpec;
}) {
  const parameterEnergy =
    parameters.length > 0
      ? parameters.reduce(
          (total, parameter) => total + normalizedValue(parameter, parameterValues),
          0,
        ) / parameters.length
      : 0.5;
  const flowDuration = `${Math.max(1.1, 3.3 - parameterEnergy * 1.6).toFixed(2)}s`;
  const highlightedRelation =
    diagram.relations[Math.floor(parameterEnergy * diagram.relations.length) % Math.max(diagram.relations.length, 1)];

  return (
    <div className="visualCanvasShell principleCanvasShell">
      <div className="visualDiagramIntent">
        <span>{principleDiagramKindLabel(diagram.diagramKind)}</span>
        <strong>{diagram.centralClaim || spec.diagramPurpose || spec.summary}</strong>
      </div>

      <div className="principleBriefStrip">
        <div>
          <span>问题</span>
          <p>{brief?.coreProblem ?? spec.summary}</p>
        </div>
        <div>
          <span>学习目标</span>
          <p>{brief?.learningGoal ?? spec.readerTakeaway ?? diagram.takeaway}</p>
        </div>
      </div>

      <svg
        className="visualCanvas principleCanvas"
        role="img"
        aria-label="Principle mechanism diagram"
        viewBox="0 0 700 360"
      >
        <defs>
          <marker
            id="principleArrow"
            markerHeight="8"
            markerWidth="8"
            orient="auto"
            refX="7"
            refY="4"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" className="principleArrowHead" />
          </marker>
          <filter id="principleGlow">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect className="principleBg" width="700" height="360" rx="8" />
        <text className="principleCanvasTitle" x="34" y="38">
          {svgText(diagram.title, 38)}
        </text>

        {diagram.relations.map((relation, index) => {
          const from = principleRegionById(diagram.regions, relation.from);
          const to = principleRegionById(diagram.regions, relation.to);
          if (!from || !to) {
            return null;
          }

          const fromPoint = principleRegionCenter(from);
          const toPoint = principleRegionCenter(to);
          const midX = (fromPoint.x + toPoint.x) / 2;
          const midY = (fromPoint.y + toPoint.y) / 2;
          const lift = index % 2 === 0 ? -32 : 32;
          const path = `M ${fromPoint.x} ${fromPoint.y} C ${midX} ${fromPoint.y + lift}, ${midX} ${toPoint.y - lift}, ${toPoint.x} ${toPoint.y}`;
          const isActive =
            highlightedRelation?.id === relation.id ||
            focusElementIds.has(relation.id) ||
            focusElementIds.has(relation.from) ||
            focusElementIds.has(relation.to);

          return (
            <g className={`principleRelation ${isActive ? "active" : ""}`} key={relation.id}>
              <path d={path} markerEnd="url(#principleArrow)" />
              <rect
                className="principleRelationLabelBg"
                height="22"
                rx="5"
                width={Math.min(148, 44 + relation.label.length * 9)}
                x={midX - Math.min(148, 44 + relation.label.length * 9) / 2}
                y={midY + lift * 0.18 - 17}
              />
              <text className="principleRelationLabel" textAnchor="middle" x={midX} y={midY + lift * 0.18 - 2}>
                {svgText(relation.label, 14)}
              </text>
              <text className="principleRelationType" textAnchor="middle" x={midX} y={midY + lift * 0.18 + 12}>
                {relationLabel(relation.relationType)}
              </text>
              {isPlaying && isActive ? (
                <circle className="principlePacket" filter="url(#principleGlow)" r={4 + parameterEnergy * 3}>
                  <animateMotion dur={flowDuration} path={path} repeatCount="indefinite" />
                </circle>
              ) : null}
            </g>
          );
        })}

        {diagram.regions.map((region, index) => {
          const emphasis = region.id === highlightedRelation?.from || region.id === highlightedRelation?.to;
          const isFocused = emphasis || focusElementIds.has(region.id);
          const detail = region.detail || brief?.keyObjects.find((object) => object.id === region.id)?.evidence;

          return (
            <g
              className={`principleRegion ${region.tone ?? semanticObjectTone(index)} ${isFocused ? "active" : ""}`}
              key={region.id}
            >
              <rect
                height={region.height}
                rx="9"
                width={region.width}
                x={region.x}
                y={region.y}
              />
              <text className="principleRegionLabel" x={region.x + 10} y={region.y + 24}>
                {svgText(region.label, 14)}
              </text>
              <text className="principleRegionRole" x={region.x + 10} y={region.y + 43}>
                {svgText(region.role, 18)}
              </text>
              {detail ? (
                <text className="principleRegionDetail" x={region.x + 10} y={region.y + 62}>
                  {svgText(detail, 22)}
                </text>
              ) : null}
              {isFocused ? (
                <circle
                  className="principleRegionPulse"
                  cx={region.x + region.width - 16}
                  cy={region.y + 16}
                  r={5 + parameterEnergy * 4}
                />
              ) : null}
            </g>
          );
        })}

        {diagram.annotations.slice(0, 4).map((annotation, index) => {
          const target = principleRegionById(diagram.regions, annotation.targetId);
          const x = clamp(
            annotation.x ?? (target ? target.x + target.width * 0.62 : 74 + index * 150),
            34,
            640,
          );
          const y = clamp(
            annotation.y ?? (target ? target.y + target.height + 28 : 302),
            66,
            330,
          );

          return (
            <g
              className={`principleAnnotation ${annotation.tone ?? semanticObjectTone(index)}`}
              key={annotation.id}
            >
              {target ? (
                <path
                  className="principleAnnotationLine"
                  d={`M ${target.x + target.width * 0.68} ${target.y + target.height} C ${x - 22} ${y - 28}, ${x - 14} ${y - 10}, ${x} ${y}`}
                />
              ) : null}
              <rect height="42" rx="7" width="142" x={x} y={y - 18} />
              <text className="principleAnnotationLabel" x={x + 9} y={y - 1}>
                {svgText(annotation.label, 12)}
              </text>
              {annotation.detail ? (
                <text className="principleAnnotationDetail" x={x + 9} y={y + 15}>
                  {svgText(annotation.detail, 20)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      {brief?.causalChain.length ? (
        <div className="principleChain">
          {brief.causalChain.slice(0, 4).map((item, index) => (
            <div className="principleChainItem" key={`${item}-${index}`}>
              <span>{index + 1}</span>
              <p>{item}</p>
            </div>
          ))}
        </div>
      ) : null}
      <p className="visualTakeaway">{diagram.takeaway || spec.readerTakeaway}</p>
    </div>
  );
}

type MechanismPoint = { x: number; y: number };

const mechanismRegionById = (
  regions: VisualMechanismRegion[],
  id: string | undefined,
) => regions.find((region) => region.id === id);

const mechanismUnitById = (
  units: VisualMechanismUnit[],
  id: string | undefined,
) => units.find((unit) => unit.id === id);

const scenePlacementForUnit = (
  step: VisualMechanismStepSpec | undefined,
  unit: VisualMechanismUnit,
) => step?.placements?.find((placement) => placement.unitId === unit.id);

const mechanismUnitPoint = ({
  density,
  placement,
  region,
  unit,
}: {
  density: number;
  placement?: VisualMechanismUnitPlacement;
  region: VisualMechanismRegion;
  unit: VisualMechanismUnit;
}): MechanismPoint => {
  const lane = placement?.lane ?? unit.lane ?? 0;
  const index = placement?.index ?? unit.index ?? 0;
  const laneCount = 4;
  const unitGap = 34 - density * 7;
  const xPadding = 34;
  const yPadding = 62;
  const x = region.x + xPadding + index * unitGap;
  const y = region.y + yPadding + lane * Math.min(42, (region.height - 100) / laneCount);

  return {
    x: clamp(x, region.x + 22, region.x + region.width - 24),
    y: clamp(y, region.y + 48, region.y + region.height - 30),
  };
};

const svgText = (value: string | undefined, maxLength: number) =>
  clip(value ?? "", maxLength);

const mechanismUnitWidth = (label: string) =>
  clamp(28 + label.length * 7.5, 42, 82);

const operationLabel = (operation: VisualMechanismOperation) => {
  const labels: Record<VisualMechanismOperation, string> = {
    move: "移动",
    pair: "配对",
    merge: "合并",
    split: "拆分",
    reorder: "重排",
    broadcast: "广播",
    filter: "筛选",
    accumulate: "累积",
    lookup: "查找",
    transform: "变换",
    compare: "比较",
    compute: "计算",
  };

  return labels[operation];
};

const sceneKindLabel = (sceneKind: VisualMechanismSceneKind) => {
  const labels: Record<VisualMechanismSceneKind, string> = {
    "layout-transform": "布局变换",
    dataflow: "数据流",
    "matrix-computation": "矩阵计算",
    "architecture-assembly": "结构组装",
    "state-transition": "状态转移",
    "comparison-mechanism": "对比机理",
    "geometric-process": "几何过程",
    "generic-mechanism": "机理演示",
  };

  return labels[sceneKind];
};

function MechanismSceneCanvas({
  activeStepIndex,
  focusElementIds,
  isPlaying,
  parameters,
  parameterValues,
  scene,
  spec,
}: {
  activeStepIndex: number;
  focusElementIds: Set<string>;
  isPlaying: boolean;
  parameters: VisualParameter[];
  parameterValues: Record<string, number>;
  scene: VisualMechanismScene;
  spec: VisualSpec;
}) {
  const parameterEnergy =
    parameters.length > 0
      ? parameters.reduce(
          (total, parameter) => total + normalizedValue(parameter, parameterValues),
          0,
        ) / parameters.length
      : 0.5;
  const activeStep = scene.steps[activeStepIndex % scene.steps.length];
  const activeUnitIds = new Set(activeStep.activeUnitIds);
  const resultUnitIds = new Set(activeStep.resultUnitIds ?? []);
  const visibleUnitBudget = Math.max(
    4,
    Math.round(6 + parameterEnergy * Math.min(scene.units.length, 12)),
  );
  const importantUnitIds = new Set([
    ...activeStep.activeUnitIds,
    ...(activeStep.resultUnitIds ?? []),
  ]);
  const visibleUnits = scene.units.filter((unit, index) => {
    if (importantUnitIds.has(unit.id)) {
      return true;
    }

    return index < visibleUnitBudget;
  });
  const density = clamp(parameterEnergy, 0, 1);
  const speed = Math.max(0.75, 3.4 - parameterEnergy * 1.7);
  const activeFrom = mechanismRegionById(scene.regions, activeStep.fromRegionId);
  const activeTo = mechanismRegionById(scene.regions, activeStep.toRegionId);
  const activePath =
    activeFrom && activeTo
      ? `M ${activeFrom.x + activeFrom.width / 2} ${activeFrom.y + activeFrom.height / 2} C ${(activeFrom.x + activeTo.x + activeFrom.width) / 2} ${activeFrom.y + 38}, ${(activeFrom.x + activeTo.x + activeTo.width) / 2} ${activeTo.y + activeTo.height - 38}, ${activeTo.x + activeTo.width / 2} ${activeTo.y + activeTo.height / 2}`
      : "";

  return (
    <div className="visualCanvasShell mechanismCanvasShell">
      <div className="visualDiagramIntent">
        <span>{sceneKindLabel(scene.sceneKind)}</span>
        <strong>{scene.purpose || spec.diagramPurpose || spec.summary}</strong>
      </div>
      <svg
        className="visualCanvas mechanismCanvas"
        role="img"
        aria-label="Mechanism scene animation"
        viewBox="0 0 700 360"
      >
        <defs>
          <filter id="mechanismGlow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="mechanismActiveGradient" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#6f9cff" />
            <stop offset="55%" stopColor="#58c08c" />
            <stop offset="100%" stopColor="#f2b86b" />
          </linearGradient>
        </defs>
        <rect className="mechanismBg" width="700" height="360" rx="8" />

        {scene.regions.map((region) => {
          const isFocused =
            focusElementIds.has(region.id) ||
            activeStep.fromRegionId === region.id ||
            activeStep.toRegionId === region.id;
          return (
            <g
              className={`mechanismRegion ${region.tone ?? "neutral"} ${isFocused ? "active" : ""}`}
              key={region.id}
            >
              <rect
                height={region.height}
                rx="11"
                width={region.width}
                x={region.x}
                y={region.y}
              />
              <text className="mechanismRegionLabel" x={region.x + 12} y={region.y + 24}>
                {svgText(region.label, 13)}
              </text>
              <text className="mechanismRegionRole" x={region.x + 12} y={region.y + 42}>
                {svgText(region.role, 18)}
              </text>
            </g>
          );
        })}

        {activePath ? (
          <g className="mechanismActivePath">
            <path d={activePath} />
            {isPlaying ? (
              <circle className="mechanismPacket" filter="url(#mechanismGlow)" r={5 + parameterEnergy * 3}>
                <animateMotion
                  dur={`${speed.toFixed(2)}s`}
                  path={activePath}
                  repeatCount="indefinite"
                />
              </circle>
            ) : null}
          </g>
        ) : null}

        {visibleUnits.map((unit) => {
          const placement = scenePlacementForUnit(activeStep, unit);
          const region =
            mechanismRegionById(scene.regions, placement?.regionId) ??
            mechanismRegionById(scene.regions, unit.regionId) ??
            scene.regions[0];
          if (!region || placement?.hidden) {
            return null;
          }

          const point = mechanismUnitPoint({
            density,
            placement,
            region,
            unit,
          });
          const pairedUnit = mechanismUnitById(scene.units, unit.pairWith);
          const isActive = activeUnitIds.has(unit.id) || focusElementIds.has(unit.id);
          const isResult = resultUnitIds.has(unit.id);
          const pairPlacement = pairedUnit
            ? scenePlacementForUnit(activeStep, pairedUnit)
            : undefined;
          const pairRegion =
            pairedUnit &&
            (mechanismRegionById(scene.regions, pairPlacement?.regionId) ??
              mechanismRegionById(scene.regions, pairedUnit.regionId));
          const pairPoint =
            pairedUnit && pairRegion
              ? mechanismUnitPoint({
                  density,
                  placement: pairPlacement,
                  region: pairRegion,
                  unit: pairedUnit,
                })
              : undefined;
          const showPairLine =
            pairedUnit &&
            pairPoint &&
            (isActive || activeUnitIds.has(pairedUnit.id)) &&
            Math.abs(pairPoint.x - point.x) + Math.abs(pairPoint.y - point.y) < 180;
          const unitLabel = svgText(unit.label, 9);
          const unitWidth = mechanismUnitWidth(unitLabel);
          const unitHeight = unitLabel.length > 5 ? 28 : 24;

          return (
            <g key={unit.id}>
              {showPairLine ? (
                <path
                  className="mechanismPairLine"
                  d={`M ${point.x} ${point.y} C ${(point.x + pairPoint.x) / 2} ${point.y - 20}, ${(point.x + pairPoint.x) / 2} ${pairPoint.y + 20}, ${pairPoint.x} ${pairPoint.y}`}
                />
              ) : null}
              <g
                className={`mechanismUnit ${unit.tone ?? "neutral"} ${isActive ? "active" : ""} ${isResult ? "result" : ""}`}
                transform={`translate(${point.x} ${point.y})`}
              >
                <rect
                  height={unitHeight}
                  rx="6"
                  width={unitWidth}
                  x={-unitWidth / 2}
                  y={-unitHeight / 2}
                />
                <text y="4">{unitLabel}</text>
                {isPlaying && isActive ? (
                  <circle className="mechanismUnitPulse" r={21 + parameterEnergy * 8} />
                ) : null}
              </g>
            </g>
          );
        })}

        <g className="mechanismOperationBadge" transform="translate(48 326)">
          <rect height="24" rx="6" width="152" />
          <text x="12" y="16">
            {operationLabel(activeStep.operation)} · {activeStep.title}
          </text>
        </g>
      </svg>

      <div className="mechanismStepList">
        {scene.steps.slice(0, 5).map((step, index) => (
          <div
            className={`mechanismStepCard ${index === activeStepIndex % scene.steps.length ? "active" : ""}`}
            key={step.id}
          >
            <span>{index + 1}</span>
            <p>{step.title}</p>
          </div>
        ))}
      </div>
      <p className="visualTakeaway">{scene.takeaway || spec.readerTakeaway}</p>
    </div>
  );
}

function SemanticVisualCanvas({
  focusElementIds,
  isPlaying,
  parameters,
  parameterValues,
  semantic,
  spec,
}: {
  focusElementIds: Set<string>;
  isPlaying: boolean;
  parameters: VisualParameter[];
  parameterValues: Record<string, number>;
  semantic: VisualSemanticSpec;
  spec: VisualSpec;
}) {
  const layout = semanticLayout(semantic);
  const emphasis =
    parameters.length > 0
      ? parameters.reduce(
          (total, parameter) => total + normalizedValue(parameter, parameterValues),
          0,
        ) / parameters.length
      : 0.5;
  const flowDuration = `${Math.max(1.2, 3.2 - emphasis * 1.4).toFixed(2)}s`;
  const showMemoryLanes =
    semantic.template === "memory-prefetch-pipeline" ||
    semantic.template === "memory-hierarchy";

  return (
    <div className="visualCanvasShell semanticCanvasShell">
      <div className="visualDiagramIntent">
        <span>{semanticTemplateLabel(semantic.template)}</span>
        <strong>{spec.diagramPurpose ?? semantic.problem}</strong>
      </div>
      <svg
        className="visualCanvas semanticCanvas"
        role="img"
        aria-label="Semantic teaching diagram"
        viewBox="0 0 700 360"
      >
        <defs>
          <marker
            id="semanticArrow"
            markerHeight="8"
            markerWidth="8"
            orient="auto"
            refX="7"
            refY="4"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" className="semanticArrowHead" />
          </marker>
          <filter id="semanticSoftGlow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect className="visualGridBg semanticBg" width="700" height="360" rx="8" />

        {showMemoryLanes ? (
          <g className="semanticMemoryLanes">
            <rect x="44" y="78" width="612" height="48" rx="9" />
            <rect x="44" y="156" width="612" height="48" rx="9" />
            <rect x="44" y="234" width="612" height="48" rx="9" />
            <text x="58" y="108">历史访问模式</text>
            <text x="58" y="186">慢速存储 / Host 中转</text>
            <text x="58" y="264">GPU memory / 计算使用</text>
          </g>
        ) : null}

        {semantic.flows.map((flow, index) => {
          const from = layout.get(flow.from);
          const to = layout.get(flow.to);
          if (!from || !to) {
            return null;
          }

          const midX = (from.x + to.x) / 2;
          const yLift = semantic.template === "memory-hierarchy" ? 0 : -28;
          const path = `M ${from.x} ${from.y} C ${midX} ${from.y + yLift}, ${midX} ${to.y + yLift}, ${to.x} ${to.y}`;
          const focused =
            focusElementIds.has(flow.from) ||
            focusElementIds.has(flow.to) ||
            focusElementIds.has(`flow-${index}`);

          return (
            <g className={`semanticFlow ${focused ? "active" : ""}`} key={`${flow.from}-${flow.to}-${index}`}>
              <path d={path} markerEnd="url(#semanticArrow)" />
              <text x={midX} y={Math.min(from.y, to.y) + yLift - 8}>
                {flow.label}
              </text>
              {isPlaying && index === 0 ? (
                <circle className="semanticPacket" filter="url(#semanticSoftGlow)" r={4 + emphasis * 3}>
                  <animateMotion dur={flowDuration} path={path} repeatCount="indefinite" />
                </circle>
              ) : null}
            </g>
          );
        })}

        {semantic.keyObjects.map((object, index) => {
          const point = layout.get(object.id) ?? { x: 100 + index * 80, y: 180 };
          const isFocused = focusElementIds.has(object.id);
          return (
            <g
              className={`semanticObject ${semanticObjectTone(index)} ${isFocused ? "active" : ""}`}
              key={object.id}
              transform={`translate(${point.x} ${point.y})`}
            >
              <rect height="64" rx="9" width="124" x="-62" y="-32" />
              <text className="semanticObjectLabel" textAnchor="middle" y="-6">
                {object.label}
              </text>
              <text className="semanticObjectRole" textAnchor="middle" y="14">
                {object.role}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="semanticMechanismList">
        {(semantic.mechanism.length ? semantic.mechanism : [semantic.problem])
          .slice(0, 5)
          .map((step, index) => (
            <div className="semanticMechanismStep" key={`${step}-${index}`}>
              <span>{index + 1}</span>
              <p>{step}</p>
            </div>
          ))}
      </div>
      <p className="visualTakeaway">{semantic.takeaway || spec.readerTakeaway}</p>
    </div>
  );
}

const semanticTemplateLabel = (template: VisualSemanticTemplate) => {
  if (template === "memory-prefetch-pipeline") {
    return "预取结构图";
  }

  if (template === "memory-hierarchy") {
    return "存储层级图";
  }

  if (template === "attention-matrix") {
    return "attention 图";
  }

  if (template === "model-architecture") {
    return "模型结构图";
  }

  if (template === "equation-transform") {
    return "公式推导图";
  }

  if (template === "comparison-tradeoff") {
    return "对比权衡图";
  }

  if (template === "timeline-stage") {
    return "阶段流程图";
  }

  return "机制图";
};

function VisualCanvas({
  edges,
  focusElementIds,
  focusNodeIds,
  isPlaying,
  nodes,
  parameters,
  parameterValues,
  simulationState,
  spec,
  visualElements,
}: {
  edges: VisualEdge[];
  focusElementIds: Set<string>;
  focusNodeIds: Set<string>;
  isPlaying: boolean;
  nodes: VisualNode[];
  parameters: VisualParameter[];
  parameterValues: Record<string, number>;
  simulationState: VisualSimulationState;
  spec: VisualSpec;
  visualElements: VisualElement[];
}) {
  const normalizedParameters = parameters.map((parameter) =>
    normalizedValue(parameter, parameterValues),
  );
  const visualEnergy =
    normalizedParameters.length > 0
      ? normalizedParameters.reduce((total, value) => total + value, 0) /
        normalizedParameters.length
      : 0.5;
  const sizeParameter =
    parameters.find((parameter) =>
      /seq|token|pair|block|length|size|cache/i.test(
        `${parameter.id} ${parameter.label}`,
      ),
    ) ?? parameters[0];
  const windowParameter =
    parameters.find((parameter) =>
      /window|stride|lane|parallel|gpu|kernel|interleave/i.test(
        `${parameter.id} ${parameter.label}`,
      ),
    ) ?? parameters[1] ?? parameters[0];
  const tokenCount = sizeParameter
    ? Math.round(8 + normalizedValue(sizeParameter, parameterValues) * 22)
    : 16;
  const windowSize = windowParameter
    ? Math.round(2 + normalizedValue(windowParameter, parameterValues) * 10)
    : 4;
  const animationSpeed = Math.max(0.75, 3.2 - visualEnergy * 1.1 - simulationState.utilization);
  const signalRadius = 2.6 + visualEnergy * 2.2;
  const showSimulationLayer =
    spec.diagramType === "mechanism" &&
    spec.simulation?.model === "kv-cache-layout" &&
    /kv|cache|gpu|kernel|transfer|memory|缓存|显存|传输/i.test(
      `${spec.title} ${spec.summary} ${spec.diagramPurpose ?? ""}`,
    );
  const showTokenRail =
    spec.diagramType === "mechanism" &&
    /token|attention|query|key|value|上下文|注意力/i.test(
      `${spec.title} ${spec.summary} ${spec.diagramPurpose ?? ""}`,
    );
  const compactMetrics = showSimulationLayer
    ? simulationState.metrics.slice(0, 3)
    : [];

  return (
    <div className="visualCanvasShell">
      <div className="visualDiagramIntent">
        <span>{diagramTypeLabel(spec.diagramType)}</span>
        <strong>{spec.diagramPurpose ?? spec.summary}</strong>
      </div>
      <svg
        className="visualCanvas"
        role="img"
        aria-label="Interactive visualization canvas"
        viewBox="0 0 700 360"
      >
        <defs>
          <linearGradient id="visualSignalGradient" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#6f9cff" />
            <stop offset="54%" stopColor="#58c08c" />
            <stop offset="100%" stopColor="#f2b86b" />
          </linearGradient>
          <filter id="visualGlow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect className="visualGridBg" width="700" height="360" rx="8" />
        {Array.from({ length: 5 }).map((_, index) => (
          <line
            className="visualGridLine"
            key={`grid-x-${index}`}
            x1={112 + index * 116}
            x2={112 + index * 116}
            y1="48"
            y2="312"
          />
        ))}
        {Array.from({ length: 3 }).map((_, index) => (
          <line
            className="visualGridLine"
            key={`grid-y-${index}`}
            x1="54"
            x2="646"
            y1={92 + index * 84}
            y2={92 + index * 84}
          />
        ))}

        <g className="visualElementLayer">
          {visualElements.map((element) => (
            <VisualElementShape
              element={element}
              focusElementIds={focusElementIds}
              key={element.id}
              parameters={parameters}
              parameterValues={parameterValues}
            />
          ))}
        </g>

        {edges.map((edge) => {
          const from = nodeById(nodes, edge.from);
          const to = nodeById(nodes, edge.to);
          if (!from || !to) {
            return null;
          }

          const path = `M ${from.x} ${from.y} C ${(from.x + to.x) / 2} ${from.y}, ${(from.x + to.x) / 2} ${to.y}, ${to.x} ${to.y}`;
          const edgeFocus =
            focusNodeIds.has(edge.from) || focusNodeIds.has(edge.to);
          const strokeWidth = 1.2 + edge.strength * (0.7 + visualEnergy * 1.4);

          return (
            <g key={edge.id}>
              <path id={`${edge.id}-path`} d={path} fill="none" />
              <path
                className={`visualEdge ${edgeFocus ? "active" : ""}`}
                d={path}
                strokeWidth={strokeWidth}
              />
              <text className="visualEdgeLabel">
                <textPath href={`#${edge.id}-path`} startOffset="52%">
                  {edge.label}
                </textPath>
              </text>
              {isPlaying && edgeFocus ? (
                <circle
                  className="visualSignal"
                  filter="url(#visualGlow)"
                  r={signalRadius + edge.strength}
                >
                  <animateMotion
                    dur={`${animationSpeed}s`}
                    path={path}
                    repeatCount="indefinite"
                  />
                </circle>
              ) : null}
            </g>
          );
        })}

        {showTokenRail ? (
          <g className="visualTokenRail">
            {Array.from({ length: Math.min(tokenCount, 18) }).map((_, index) => {
              const isWindow = index < windowSize;
              const x = 52 + index * 9;
              return (
                <rect
                  className={`visualToken ${isWindow ? "active" : ""}`}
                  height={isWindow ? 20 : 14}
                  key={`token-${index}`}
                  rx="3"
                  width="6"
                  x={x}
                  y={326 - (isWindow ? 3 : 0)}
                />
              );
            })}
          </g>
        ) : null}

        {showSimulationLayer ? (
          <SimulationLayer
            isPlaying={isPlaying}
            simulationState={simulationState}
          />
        ) : null}

        {nodes.map((node) => {
          const isFocused = focusNodeIds.has(node.id);
          return (
            <g
              className={`visualNode ${node.tone} ${isFocused ? "active" : ""}`}
              key={node.id}
              transform={`translate(${node.x} ${node.y})`}
            >
              <circle className="visualNodePulse" r={isFocused ? 34 : 0} />
              <rect
                className="visualNodeBox"
                height="50"
                rx="8"
                width="106"
                x="-53"
                y="-25"
              />
              <text className="visualNodeLabel" textAnchor="middle" y="-3">
                {node.label}
              </text>
              <text className="visualNodeDetail" textAnchor="middle" y="14">
                {node.detail}
              </text>
            </g>
          );
        })}
      </svg>

      {compactMetrics.length > 0 ? (
        <div className="visualMetricStrip">
          {compactMetrics.map((metric) => (
            <div className={`visualMetric ${metric.tone}`} key={metric.id}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
      <p className="visualTakeaway">{spec.readerTakeaway ?? spec.summary}</p>
    </div>
  );
}

const diagramTypeLabel = (diagramType: VisualDiagramType | undefined) => {
  if (diagramType === "structure") {
    return "结构图";
  }

  if (diagramType === "equation") {
    return "公式图";
  }

  if (diagramType === "matrix") {
    return "矩阵图";
  }

  if (diagramType === "comparison") {
    return "对比图";
  }

  if (diagramType === "timeline") {
    return "阶段图";
  }

  if (diagramType === "geometry") {
    return "几何图";
  }

  return "机制图";
};

function VisualElementShape({
  element,
  focusElementIds,
  parameters,
  parameterValues,
}: {
  element: VisualElement;
  focusElementIds: Set<string>;
  parameters: VisualParameter[];
  parameterValues: Record<string, number>;
}) {
  const isFocused = focusElementIds.has(element.id);
  const parameterEnergy = elementParameterValue(element, parameters, parameterValues);
  const tone = element.tone ?? "neutral";
  const width = element.width ?? 90;
  const height = element.height ?? 44;
  const radius = element.radius ?? 18;
  const value = clamp((element.value ?? 0.5) * 0.55 + parameterEnergy * 0.45, 0, 1);
  const className = `visualElement ${element.kind} ${tone} ${isFocused ? "active" : ""}`;

  if (element.kind === "matrix") {
    const rows = element.rows ?? 3;
    const cols = element.cols ?? 3;
    const gap = 3;
    const cellWidth = Math.max(5, (width - gap * (cols - 1)) / cols);
    const cellHeight = Math.max(5, (height - gap * (rows - 1)) / rows);
    const cells = element.cells ?? [];

    return (
      <g className={className}>
        {element.label ? (
          <text className="visualElementLabel" x={element.x} y={element.y - 8}>
            {element.label}
          </text>
        ) : null}
        {Array.from({ length: rows * cols }).map((_, index) => {
          const row = Math.floor(index / cols);
          const col = index % cols;
          const cellValue = clamp(
            (cells[index] ?? ((row + col + 1) / (rows + cols))) * 0.62 +
              parameterEnergy * 0.38,
            0.05,
            1,
          );

          return (
            <rect
              className="visualMatrixCell"
              height={cellHeight}
              key={`${element.id}-cell-${index}`}
              opacity={0.24 + cellValue * 0.68}
              rx="3"
              width={cellWidth}
              x={element.x + col * (cellWidth + gap)}
              y={element.y + row * (cellHeight + gap)}
            />
          );
        })}
      </g>
    );
  }

  if (element.kind === "layer") {
    const layerCount = Math.max(3, Math.round(3 + parameterEnergy * 6));
    return (
      <g className={className}>
        {Array.from({ length: layerCount }).map((_, index) => (
          <rect
            className="visualLayerPlate"
            height={height}
            key={`${element.id}-layer-${index}`}
            rx="7"
            width={width}
            x={element.x + index * 6}
            y={element.y + index * 5}
          />
        ))}
        {element.label ? (
          <text className="visualElementLabel" x={element.x + 10} y={element.y + 20}>
            {element.label}
          </text>
        ) : null}
        {element.detail ? (
          <text className="visualElementDetail" x={element.x + 10} y={element.y + 36}>
            {element.detail}
          </text>
        ) : null}
      </g>
    );
  }

  if (element.kind === "formula") {
    return (
      <g className={className}>
        <rect
          className="visualFormulaBox"
          height={height}
          rx="9"
          width={width}
          x={element.x}
          y={element.y}
        />
        <text className="visualFormulaText" x={element.x + 12} y={element.y + height / 2 + 4}>
          {element.label}
        </text>
      </g>
    );
  }

  if (element.kind === "bar") {
    return (
      <g className={className}>
        {element.label ? (
          <text className="visualElementLabel" x={element.x} y={element.y - 8}>
            {element.label}
          </text>
        ) : null}
        <rect
          className="visualBarTrack"
          height={height}
          rx={height / 2}
          width={width}
          x={element.x}
          y={element.y}
        />
        <rect
          className="visualBarFill"
          height={height}
          rx={height / 2}
          width={Math.max(6, width * value)}
          x={element.x}
          y={element.y}
        />
      </g>
    );
  }

  if (element.kind === "circle") {
    const animatedRadius = radius * (0.72 + parameterEnergy * 0.48);
    return (
      <g className={className}>
        <circle
          className="visualElementCircle"
          cx={element.x}
          cy={element.y}
          r={animatedRadius}
        />
        {element.label ? (
          <text className="visualElementLabel centered" x={element.x} y={element.y + 4}>
            {element.label}
          </text>
        ) : null}
      </g>
    );
  }

  if (element.kind === "text" || element.kind === "annotation") {
    return (
      <g className={className}>
        {element.kind === "annotation" ? (
          <path
            className="visualAnnotationLine"
            d={`M ${element.x - 18} ${element.y + 8} C ${element.x - 42} ${element.y - 8}, ${element.x - 34} ${element.y - 24}, ${element.x - 5} ${element.y - 22}`}
          />
        ) : null}
        <text className="visualElementLabel" x={element.x} y={element.y}>
          {element.label}
        </text>
        {element.detail ? (
          <text className="visualElementDetail" x={element.x} y={element.y + 15}>
            {element.detail}
          </text>
        ) : null}
      </g>
    );
  }

  if (element.kind === "bracket") {
    return (
      <g className={className}>
        <path
          className="visualBracket"
          d={`M ${element.x + width} ${element.y} H ${element.x} V ${element.y + height} H ${element.x + width}`}
        />
        {element.label ? (
          <text className="visualElementLabel" x={element.x + width + 8} y={element.y + height / 2 + 4}>
            {element.label}
          </text>
        ) : null}
      </g>
    );
  }

  if (element.kind === "axis") {
    return (
      <g className={className}>
        <path
          className="visualAxis"
          d={`M ${element.x} ${element.y + height} H ${element.x + width} M ${element.x} ${element.y + height} V ${element.y}`}
        />
        {element.label ? (
          <text className="visualElementDetail" x={element.x + width - 48} y={element.y + height + 16}>
            {element.label}
          </text>
        ) : null}
      </g>
    );
  }

  if (element.kind === "arrow") {
    const points = element.points?.length
      ? element.points
      : [
          { x: element.x, y: element.y },
          { x: element.x + width, y: element.y + height },
        ];
    const path = points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
      .join(" ");

    return (
      <g className={className}>
        <path className="visualElementArrow" d={path} />
        {element.label ? (
          <text className="visualElementDetail" x={points[0].x + 8} y={points[0].y - 6}>
            {element.label}
          </text>
        ) : null}
      </g>
    );
  }

  return (
    <g className={className}>
      <rect
        className="visualElementRect"
        height={height * (0.88 + parameterEnergy * 0.22)}
        rx="8"
        width={width * (0.9 + parameterEnergy * 0.18)}
        x={element.x}
        y={element.y}
      />
      {element.label ? (
        <text className="visualElementLabel" x={element.x + 10} y={element.y + 20}>
          {element.label}
        </text>
      ) : null}
      {element.detail ? (
        <text className="visualElementDetail" x={element.x + 10} y={element.y + 36}>
          {element.detail}
        </text>
      ) : null}
    </g>
  );
}

function SimulationLayer({
  isPlaying,
  simulationState,
}: {
  isPlaying: boolean;
  simulationState: VisualSimulationState;
}) {
  const kBlocks = Math.min(18, Math.max(5, Math.round(simulationState.sequenceLength / 96)));
  const vBlocks = kBlocks;
  const kvBlocks = Math.min(
    22,
    Math.max(6, Math.round(simulationState.unitCount / 320)),
  );
  const activeKvBlocks = Math.min(
    kvBlocks,
    Math.max(2, Math.round(simulationState.interleaveStride / 3)),
  );
  const transferBlocks = Math.min(
    16,
    Math.max(3, Math.round(simulationState.transferBlocks / 2)),
  );
  const gpuLaneCount = Math.min(
    12,
    Math.max(3, Math.round(simulationState.gpuLanes / 10)),
  );
  const flowDuration = `${Math.max(0.75, 3.4 - simulationState.speed * 0.72).toFixed(2)}s`;

  // 参数变化会先进入 SimulationEngine 重算，再由这里把数量、路径和速度映射到 SVG。
  return (
    <g className="visualSimulationLayer">
      <text className="visualSimLabel" x="42" y="282">
        K cache
      </text>
      <text className="visualSimLabel" x="42" y="314">
        V cache
      </text>
      {Array.from({ length: kBlocks }).map((_, index) => (
        <rect
          className="visualSimBlock k"
          height="14"
          key={`k-${index}`}
          rx="3"
          width="8"
          x={96 + index * 9}
          y="270"
        />
      ))}
      {Array.from({ length: vBlocks }).map((_, index) => (
        <rect
          className="visualSimBlock v"
          height="14"
          key={`v-${index}`}
          rx="3"
          width="8"
          x={96 + index * 9}
          y="302"
        />
      ))}

      <path className="visualSimArrow" d="M 270 286 C 300 286 302 292 328 292" />
      <text className="visualSimLabel" x="330" y="268">
        token-wise interleaving
      </text>
      {Array.from({ length: kvBlocks }).map((_, index) => (
        <rect
          className={`visualSimBlock kv ${index < activeKvBlocks ? "active" : ""}`}
          height="24"
          key={`kv-${index}`}
          rx="4"
          width="9"
          x={330 + index * 10}
          y="280"
        />
      ))}

      <path className="visualSimArrow" d="M 570 292 C 592 292 594 292 612 292" />
      <text className="visualSimLabel" x="498" y="328">
        block transfer x {simulationState.transferBlocks}
      </text>
      {Array.from({ length: transferBlocks }).map((_, index) => (
        <rect
          className="visualTransferBlock"
          height="8"
          key={`transfer-${index}`}
          rx="2"
          width="12"
          x={496 + index * 13}
          y="306"
        />
      ))}

      <text className="visualSimLabel" x="612" y="268">
        GPU lanes
      </text>
      {Array.from({ length: gpuLaneCount }).map((_, index) => (
        <rect
          className="visualGpuLane"
          height="5"
          key={`lane-${index}`}
          rx="2"
          width="42"
          x="612"
          y={278 + index * 7}
        />
      ))}

      {isPlaying ? (
        <circle className="visualSimPacket" r="5">
          <animateMotion
            dur={flowDuration}
            path="M 110 286 C 230 286 260 292 346 292 C 450 292 530 292 652 292"
            repeatCount="indefinite"
          />
        </circle>
      ) : null}
    </g>
  );
}
