export const makeId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const formatTime = (iso: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

const extractJsonCandidate = (text: string) => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start < 0 || end <= start) {
    throw new Error("The model did not return a JSON object.");
  }

  return candidate.slice(start, end + 1);
};

const jsonErrorLocation = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const positionMatch = message.match(/position\s+(\d+)/i);

  return {
    message,
    position: positionMatch ? Number(positionMatch[1]) : undefined,
  };
};

const shouldInsertComma = (before: string, after: string) =>
  /[\]}"]/.test(before) && /["{\[]/.test(after);

const nextTokenInfo = (json: string, start: number) => {
  let index = start;
  while (/\s/.test(json[index] ?? "")) {
    index += 1;
  }

  const char = json[index];
  if (char !== "\"") {
    return { index, char };
  }

  let cursor = index + 1;
  let escaped = false;
  while (cursor < json.length) {
    const current = json[cursor];
    if (escaped) {
      escaped = false;
    } else if (current === "\\") {
      escaped = true;
    } else if (current === "\"") {
      break;
    }
    cursor += 1;
  }

  let afterStringIndex = cursor + 1;
  while (/\s/.test(json[afterStringIndex] ?? "")) {
    afterStringIndex += 1;
  }

  return {
    index,
    char,
    isPropertyName: json[afterStringIndex] === ":",
  };
};

const repairLooseJson = (json: string) => {
  let output = "";
  let inString = false;
  let escaped = false;
  const stack: Array<"object" | "array"> = [];

  for (let index = 0; index < json.length; index += 1) {
    const char = json[index];

    output += char;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      stack.push("object");
      continue;
    }

    if (char === "[") {
      stack.push("array");
      continue;
    }

    if (char === ",") {
      let nextIndex = index + 1;
      while (/\s/.test(json[nextIndex] ?? "")) {
        nextIndex += 1;
      }
      if (json[nextIndex] === "}" || json[nextIndex] === "]") {
        output = output.slice(0, -1);
      }
      continue;
    }

    if (char === "}" || char === "]") {
      const inArray = stack[stack.length - 1] === "array";
      stack.pop();

      // If we just closed a } or ] while inside an array, and the next
      // token looks like a new property (not a comma/bracket), the AI
      // likely omitted the array-closing ], — repair it.
      if (inArray) {
        const nextToken = nextTokenInfo(json, index + 1);
        const nextChar = nextToken.char;
        if (nextChar && /["{[]/.test(nextChar)) {
          const between = json.slice(index + 1, nextToken.index);
          if (!between.includes(",") && !between.includes("]")) {
            output += "],";
            continue;
          }
        }
      }
    }

    if (!/[\]}"]/.test(char)) {
      continue;
    }

    const nextToken = nextTokenInfo(json, index + 1);
    const nextChar = nextToken.char;

    const nextIndex = nextToken.index;
    if (!nextChar || !shouldInsertComma(char, nextChar)) {
      continue;
    }

    const between = json.slice(index + 1, nextIndex);
    if (between.includes(",")) {
      continue;
    }

    output += ",";
  }

  return output;
};

export const parseModelJsonObject = (text: string) => {
  const candidate = extractJsonCandidate(text);

  try {
    return JSON.parse(candidate);
  } catch (firstError) {
    const repaired = repairLooseJson(candidate);
    try {
      return JSON.parse(repaired);
    } catch (secondError) {
      const first = jsonErrorLocation(firstError);
      const second = jsonErrorLocation(secondError);
      const position = first.position ?? second.position;
      const hint =
        position === undefined
          ? ""
          : ` Near: ${candidate.slice(Math.max(0, position - 80), position + 80)}`;

      throw new Error(
        `AI 返回的 JSON 格式不完整或缺少逗号，无法解析。原始错误：${first.message}；修复后错误：${second.message}.${hint}`,
      );
    }
  }
};
