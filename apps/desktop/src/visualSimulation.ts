import type {
  VisualParameter,
  VisualSimulationModel,
  VisualSpec,
} from "./types";

export interface SimulationMetric {
  id: string;
  label: string;
  value: string;
  tone: "blue" | "green" | "amber" | "rose";
}

export interface VisualSimulationState {
  model: VisualSimulationModel;
  sequenceLength: number;
  kvPairs: number;
  interleaveStride: number;
  blockSizeKb: number;
  gpuLanes: number;
  bandwidthGbps: number;
  unitCount: number;
  transferBlocks: number;
  locality: number;
  utilization: number;
  speed: number;
  metrics: SimulationMetric[];
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

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

const findParameter = (
  parameters: VisualParameter[],
  patterns: RegExp[],
) =>
  parameters.find((parameter) =>
    patterns.some((pattern) =>
      pattern.test(`${parameter.id} ${parameter.label} ${parameter.unit ?? ""}`),
    ),
  );

const valueFromParameter = (
  parameters: VisualParameter[],
  values: Record<string, number>,
  patterns: RegExp[],
  fallback: number,
  projectedRange?: [number, number],
) => {
  const parameter = findParameter(parameters, patterns);
  if (!parameter) {
    return fallback;
  }

  const value = values[parameter.id] ?? parameter.defaultValue;
  if (!projectedRange) {
    return value;
  }

  const [min, max] = projectedRange;
  return min + normalizedValue(parameter, values) * (max - min);
};

const inferSimulationModel = (spec: VisualSpec): VisualSimulationModel => {
  const text = [
    spec.title,
    spec.summary,
    ...spec.nodes.flatMap((node) => [node.label, node.detail]),
    ...spec.parameters.flatMap((parameter) => [parameter.id, parameter.label]),
  ].join(" ");

  if (/kv|cache|interleav|kernel|gpu|block|transfer|memory|缓存|交织|块|传输/i.test(text)) {
    return "kv-cache-layout";
  }

  if (/attention|query|key|value|softmax|token|注意力/i.test(text)) {
    return "attention-flow";
  }

  if (/pipeline|stage|latency|吞吐|流水/i.test(text)) {
    return "pipeline";
  }

  return "generic-flow";
};

export const computeVisualSimulation = (
  spec: VisualSpec,
  values: Record<string, number>,
): VisualSimulationState => {
  const parameters = spec.parameters;
  const model = spec.simulation?.model ?? inferSimulationModel(spec);
  const sequenceLength = Math.round(
    valueFromParameter(
      parameters,
      values,
      [/seq|sequence|token|length|上下文|序列|长度/i],
      128,
      [16, 2048],
    ),
  );
  const kvPairs = Math.round(
    valueFromParameter(
      parameters,
      values,
      [/kv|pair|head|cache|对数|键值|缓存/i],
      16,
      [4, 96],
    ),
  );
  const interleaveStride = Math.max(
    1,
    Math.round(
      valueFromParameter(
        parameters,
        values,
        [/stride|interleav|window|步长|交织|窗口/i],
        4,
        [1, 32],
      ),
    ),
  );
  const blockSizeKb = Math.round(
    valueFromParameter(
      parameters,
      values,
      [/block|size|chunk|tile|块|大小|分块/i],
      128,
      [16, 512],
    ),
  );
  const gpuLanes = Math.round(
    valueFromParameter(
      parameters,
      values,
      [/gpu|lane|parallel|kernel|并行|线程|通道/i],
      32,
      [4, 128],
    ),
  );
  const bandwidthGbps = Math.round(
    valueFromParameter(
      parameters,
      values,
      [/bandwidth|throughput|bw|带宽|吞吐/i],
      900,
      [100, 3000],
    ),
  );
  const unitSizeKb = 0.5;
  const unitCount = Math.max(
    1,
    Math.ceil((sequenceLength * kvPairs) / interleaveStride),
  );
  const transferBlocks = Math.max(
    1,
    Math.ceil((unitCount * unitSizeKb) / Math.max(blockSizeKb, 1)),
  );
  const locality = clamp(
    0.22 +
      Math.log2(interleaveStride + 1) / 8 +
      Math.log2(blockSizeKb / 16 + 1) / 8,
    0.05,
    0.98,
  );
  const parallelMatch = clamp(gpuLanes / Math.max(transferBlocks, gpuLanes / 3), 0, 1);
  const bandwidthFactor = clamp(Math.log10(bandwidthGbps) / 3.5, 0.1, 1);
  const utilization = clamp(
    locality * 0.42 + parallelMatch * 0.4 + bandwidthFactor * 0.18,
    0.05,
    0.99,
  );
  const speed = 0.7 + utilization * 2.6;
  const estimatedTimeUs =
    (unitCount * unitSizeKb) / Math.max(bandwidthGbps * 1024 * 0.000001, 0.01);

  // 这里是本地可控的教学模拟，不追求硬件级精确，而是保证参数变化能稳定驱动画面和指标。
  return {
    model,
    sequenceLength,
    kvPairs,
    interleaveStride,
    blockSizeKb,
    gpuLanes,
    bandwidthGbps,
    unitCount,
    transferBlocks,
    locality,
    utilization,
    speed,
    metrics: [
      {
        id: "units",
        label: "数据单元",
        value: unitCount > 999 ? `${(unitCount / 1000).toFixed(1)}k` : String(unitCount),
        tone: "blue",
      },
      {
        id: "blocks",
        label: "传输块",
        value: String(transferBlocks),
        tone: "amber",
      },
      {
        id: "locality",
        label: "局部性",
        value: `${Math.round(locality * 100)}%`,
        tone: "green",
      },
      {
        id: "utilization",
        label: "GPU 利用",
        value: `${Math.round(utilization * 100)}%`,
        tone: "rose",
      },
      {
        id: "time",
        label: "估计耗时",
        value: `${estimatedTimeUs.toFixed(1)} us`,
        tone: "blue",
      },
    ],
  };
};
