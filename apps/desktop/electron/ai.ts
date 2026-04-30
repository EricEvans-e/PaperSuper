import type {
  AiCompletionRequest,
  AiCompletionResponse,
  AiContextItem,
  AiMessage,
  ModelConfig,
} from "../src/types";

const REQUEST_TIMEOUT_MS = 90_000;

class AiHttpError extends Error {
  status: number;
  data: any;
  url: string;

  constructor(status: number, message: string, data: any, url: string) {
    super(message);
    this.status = status;
    this.data = data;
    this.url = url;
  }
}

const endpointFor = (
  apiBase: string,
  endpoint: "/v1/chat/completions" | "/v1/responses" | "/v1/messages",
) => {
  const trimmed = apiBase.trim().replace(/\/+$/, "");
  const knownEndpoints = [
    "/v1/chat/completions",
    "/chat/completions",
    "/v1/responses",
    "/responses",
    "/v1/messages",
    "/messages",
  ];

  if (knownEndpoints.some((knownEndpoint) => trimmed.endsWith(knownEndpoint))) {
    return trimmed;
  }

  if (trimmed.endsWith(endpoint)) {
    return trimmed;
  }

  if (trimmed.endsWith("/v1")) {
    return `${trimmed}${endpoint.replace("/v1", "")}`;
  }

  return `${trimmed}${endpoint}`;
};

const unique = (items: string[]) => Array.from(new Set(items));

const endpointCandidates = (
  apiBase: string,
  endpoint: "/v1/chat/completions" | "/v1/responses" | "/v1/messages",
) => {
  const trimmed = apiBase.trim().replace(/\/+$/, "");
  const exact = endpointFor(trimmed, endpoint);
  const withoutV1 = endpoint.replace("/v1", "");

  if (trimmed.endsWith(endpoint) || trimmed.endsWith(withoutV1)) {
    return [trimmed];
  }

  if (trimmed.endsWith("/v1")) {
    return unique([`${trimmed}${withoutV1}`, exact]);
  }

  return unique([exact, `${trimmed}${withoutV1}`]);
};

const buildSystemPrompt = (
  paperTitle: string,
  contextItems: AiContextItem[],
) => {
  const contextBlock =
    contextItems.length === 0
      ? "No selected PDF context is currently attached."
      : contextItems
          .map((item, index) => {
            const page = item.pageNumber ? `Page ${item.pageNumber}` : "Paper";
            return `[${index + 1}] ${page}\n${item.text}`;
          })
          .join("\n\n");

  return [
    "You are PaperSuper, an AI research reading assistant.",
    "Answer in the user's language unless they ask otherwise.",
    "Format every answer as clean Markdown. Use headings, bullet lists, tables, and code blocks when they help.",
    "Be precise, cite selected context by bracket number when it is useful, and say when the provided context is insufficient.",
    `Current paper: ${paperTitle || "Untitled PDF"}`,
    "Selected PDF context:",
    contextBlock,
  ].join("\n\n");
};

const cleanMessages = (messages: AiMessage[]) =>
  messages
    .filter((message) => !message.isLocal)
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }));

const conversationText = (messages: ReturnType<typeof cleanMessages>) =>
  messages
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}:\n${message.content}`)
    .join("\n\n");

const readResponseJson = async (response: Response) => {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text };
  }
};

const assertSuccess = async (response: Response, url: string) => {
  if (response.ok) {
    return readResponseJson(response);
  }

  const data = await readResponseJson(response);
  const message =
    data?.error?.message || data?.message || response.statusText || "AI request failed";

  throw new AiHttpError(response.status, `${response.status} ${message}`, data, url);
};

const summarizeHttpError = (error: AiHttpError) => {
  const detail =
    typeof error.data?.message === "string"
      ? error.data.message
      : typeof error.data?.error?.message === "string"
        ? error.data.error.message
        : error.message;

  return `${error.status} ${detail} (${error.url})`;
};

const isRetryableEndpointError = (error: unknown): error is AiHttpError =>
  error instanceof AiHttpError && (error.status === 404 || error.status === 405);

const throwEndpointErrors = (provider: string, errors: AiHttpError[]): never => {
  const attempts = errors.map(summarizeHttpError).join("\n");
  throw new Error(
    [
      `${provider} endpoint not found.`,
      "请检查 Provider 和 API Base 是否匹配。",
      "如果你使用的是只兼容 OpenAI Chat 的网关，请选择 OpenAI Chat Completions，而不是 OpenAI Responses。",
      "尝试过的请求：",
      attempts,
    ].join("\n"),
  );
};

const withTimeout = async (url: string, init: RequestInit) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const extractOpenAiText = (data: any) => {
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }

  return "";
};

const extractOpenAiResponsesText = (data: any) => {
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }

  const output = data?.output;
  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((part) => {
      if (typeof part?.text === "string") {
        return part.text;
      }

      if (typeof part?.content === "string") {
        return part.content;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
};

const extractAnthropicText = (data: any) => {
  const content = data?.content;

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
};

const validateConfig = (config: ModelConfig) => {
  if (!config.apiKey.trim()) {
    throw new Error("请先在设置里填写 API Key。");
  }

  if (!config.apiBase.trim()) {
    throw new Error("请先在设置里填写 API Base。");
  }

  if (!config.model.trim()) {
    throw new Error("请先在设置里填写模型名。");
  }
};

const sendOpenAiCompatible = async (
  request: AiCompletionRequest,
): Promise<AiCompletionResponse> => {
  const { config } = request;
  const urls = endpointCandidates(config.apiBase, "/v1/chat/completions");
  const systemPrompt = buildSystemPrompt(request.paperTitle, request.contextItems);
  const userMessages = cleanMessages(request.messages);
  const messages = [
    { role: "system", content: systemPrompt },
    ...userMessages,
  ];
  const mergedMessages = [
    {
      role: "user",
      content: `${systemPrompt}\n\n${conversationText(userMessages)}`,
    },
  ];

  const basePayload = {
    model: config.model,
    messages,
  };

  const send = async (
    url: string,
    body: Record<string, unknown>,
  ) => {
    const response = await withTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    return assertSuccess(response, url);
  };

  const payloads = [
    { ...basePayload, max_tokens: config.maxTokens },
    { ...basePayload, max_completion_tokens: config.maxTokens },
    basePayload,
    { model: config.model, messages: mergedMessages },
  ];

  const endpointErrors: AiHttpError[] = [];

  for (const url of urls) {
    try {
      let lastParamError: AiHttpError | null = null;

      for (const payload of payloads) {
        try {
          const data = await send(url, payload);
          const content = extractOpenAiText(data);

          if (!content) {
            throw new Error("OpenAI-compatible response did not include message content.");
          }

          return { content };
        } catch (error) {
          if (!(error instanceof AiHttpError) || error.status !== 400) {
            throw error;
          }

          lastParamError = error;
        }
      }

      throw lastParamError ?? new Error("OpenAI-compatible request failed.");
    } catch (error) {
      if (isRetryableEndpointError(error)) {
        endpointErrors.push(error);
        continue;
      }

      throw error;
    }
  }

  return throwEndpointErrors("OpenAI Chat Completions", endpointErrors);
};

const sendOpenAiResponses = async (
  request: AiCompletionRequest,
): Promise<AiCompletionResponse> => {
  const { config } = request;
  const urls = endpointCandidates(config.apiBase, "/v1/responses");
  const messages = cleanMessages(request.messages);
  const instructions = buildSystemPrompt(request.paperTitle, request.contextItems);
  const structuredInput = messages.map((message) => ({
    role: message.role,
    content: [
      {
        type: "input_text",
        text: message.content,
      },
    ],
  }));

  const send = async (url: string, body: Record<string, unknown>) => {
    const response = await withTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    return assertSuccess(response, url);
  };

  const endpointErrors: AiHttpError[] = [];

  for (const url of urls) {
    try {
      let data: any;
      try {
        data = await send(url, {
          model: config.model,
          instructions,
          input: structuredInput,
          max_output_tokens: config.maxTokens,
        });
      } catch (error) {
        if (!(error instanceof AiHttpError) || error.status !== 400) {
          throw error;
        }

        try {
          data = await send(url, {
            model: config.model,
            instructions,
            input: conversationText(messages),
            max_output_tokens: config.maxTokens,
          });
        } catch (retryError) {
          if (!(retryError instanceof AiHttpError) || retryError.status !== 400) {
            throw retryError;
          }

          data = await send(url, {
            model: config.model,
            input: `${instructions}\n\n${conversationText(messages)}`,
          });
        }
      }

      const content = extractOpenAiResponsesText(data);

      if (!content) {
        throw new Error("OpenAI Responses response did not include output text.");
      }

      return { content };
    } catch (error) {
      if (isRetryableEndpointError(error)) {
        endpointErrors.push(error);
        continue;
      }

      throw error;
    }
  }

  return throwEndpointErrors("OpenAI Responses", endpointErrors);
};

const sendOpenAiResponsesAsChat = async (
  request: AiCompletionRequest,
): Promise<AiCompletionResponse> => {
  const chatRequest: AiCompletionRequest = {
    ...request,
    config: {
      ...request.config,
      provider: "openai-chat",
    },
  };

  return sendOpenAiCompatible(chatRequest);
};

const sendOpenAiResponsesWithFallback = async (
  request: AiCompletionRequest,
): Promise<AiCompletionResponse> => {
  try {
    return await sendOpenAiResponses(request);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("OpenAI Responses endpoint not found")
    ) {
      const response = await sendOpenAiResponsesAsChat(request);
      return {
        content: [
          "当前 API Base 不支持 /responses，已自动改用 Chat Completions 格式完成本次请求。",
          "",
          response.content,
        ].join("\n"),
      };
    }

    throw error;
  }
};

const sendAnthropic = async (
  request: AiCompletionRequest,
): Promise<AiCompletionResponse> => {
  const { config } = request;
  const url = endpointFor(config.apiBase, "/v1/messages");
  const messages = cleanMessages(request.messages);

  const response = await withTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens,
      system: buildSystemPrompt(request.paperTitle, request.contextItems),
      messages,
    }),
  });

  const data = await assertSuccess(response, url);
  const content = extractAnthropicText(data);

  if (!content) {
    throw new Error("Anthropic response did not include text content.");
  }

  return { content };
};

export const sendAiCompletion = async (
  request: AiCompletionRequest,
): Promise<AiCompletionResponse> => {
  validateConfig(request.config);

  if (request.config.provider === "anthropic") {
    return sendAnthropic(request);
  }

  if (request.config.provider === "openai-responses") {
    return sendOpenAiResponsesWithFallback(request);
  }

  return sendOpenAiCompatible(request);
};

interface StreamCallbacks {
  onDelta: (delta: string) => void;
}

const streamResponse = async (
  url: string,
  init: RequestInit,
  onEvent: (event: string | null, data: any) => void,
) => {
  const response = await fetch(url, init);

  if (!response.ok) {
    await assertSuccess(response, url);
  }

  if (!response.body) {
    throw new Error("AI stream response did not include a body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";

    for (const rawEvent of events) {
      const parsed = parseSseEvent(rawEvent);
      if (!parsed) {
        continue;
      }

      if (parsed.data === "[DONE]") {
        return;
      }

      try {
        onEvent(parsed.event, JSON.parse(parsed.data));
      } catch {
        onEvent(parsed.event, parsed.data);
      }
    }
  }

  if (buffer.trim()) {
    const parsed = parseSseEvent(buffer);
    if (parsed && parsed.data !== "[DONE]") {
      try {
        onEvent(parsed.event, JSON.parse(parsed.data));
      } catch {
        onEvent(parsed.event, parsed.data);
      }
    }
  }
};

const parseSseEvent = (rawEvent: string) => {
  const lines = rawEvent.split(/\r?\n/);
  let event: string | null = null;
  const data: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart());
    }
  }

  if (data.length === 0) {
    return null;
  }

  return {
    event,
    data: data.join("\n"),
  };
};

const extractOpenAiChatStreamDelta = (data: any) => {
  const delta = data?.choices?.[0]?.delta?.content;

  if (typeof delta === "string") {
    return delta;
  }

  if (Array.isArray(delta)) {
    return delta
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("");
  }

  return "";
};

const extractOpenAiResponsesStreamDelta = (data: any) => {
  if (
    data?.type === "response.output_text.delta" &&
    typeof data.delta === "string"
  ) {
    return data.delta;
  }

  if (
    data?.type === "response.output_item.added" &&
    typeof data.item?.content?.[0]?.text === "string"
  ) {
    return data.item.content[0].text;
  }

  return "";
};

const extractAnthropicStreamDelta = (data: any) => {
  if (data?.type === "content_block_delta" && data?.delta?.type === "text_delta") {
    return typeof data.delta.text === "string" ? data.delta.text : "";
  }

  return "";
};

const streamOpenAiCompatible = async (
  request: AiCompletionRequest,
  callbacks: StreamCallbacks,
) => {
  const { config } = request;
  const urls = endpointCandidates(config.apiBase, "/v1/chat/completions");
  const systemPrompt = buildSystemPrompt(request.paperTitle, request.contextItems);
  const userMessages = cleanMessages(request.messages);
  const messages = [
    { role: "system", content: systemPrompt },
    ...userMessages,
  ];
  const mergedMessages = [
    {
      role: "user",
      content: `${systemPrompt}\n\n${conversationText(userMessages)}`,
    },
  ];
  const basePayload = { model: config.model, messages, stream: true };
  const payloads = [
    { ...basePayload, max_tokens: config.maxTokens },
    { ...basePayload, max_completion_tokens: config.maxTokens },
    basePayload,
    { model: config.model, messages: mergedMessages, stream: true },
  ];
  const endpointErrors: AiHttpError[] = [];

  for (const url of urls) {
    try {
      let lastParamError: AiHttpError | null = null;

      for (const payload of payloads) {
        try {
          await streamResponse(
            url,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${config.apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            },
            (_event, data) => {
              const delta = extractOpenAiChatStreamDelta(data);
              if (delta) callbacks.onDelta(delta);
            },
          );
          return;
        } catch (error) {
          if (!(error instanceof AiHttpError) || error.status !== 400) {
            throw error;
          }

          lastParamError = error;
        }
      }

      throw lastParamError ?? new Error("OpenAI-compatible stream failed.");
    } catch (error) {
      if (isRetryableEndpointError(error)) {
        endpointErrors.push(error);
        continue;
      }

      throw error;
    }
  }

  return throwEndpointErrors("OpenAI Chat Completions", endpointErrors);
};

const streamOpenAiResponses = async (
  request: AiCompletionRequest,
  callbacks: StreamCallbacks,
) => {
  const { config } = request;
  const urls = endpointCandidates(config.apiBase, "/v1/responses");
  const messages = cleanMessages(request.messages);
  const instructions = buildSystemPrompt(request.paperTitle, request.contextItems);
  const structuredInput = messages.map((message) => ({
    role: message.role,
    content: [
      {
        type: "input_text",
        text: message.content,
      },
    ],
  }));
  const payloads = [
    {
      model: config.model,
      instructions,
      input: structuredInput,
      max_output_tokens: config.maxTokens,
      stream: true,
    },
    {
      model: config.model,
      instructions,
      input: conversationText(messages),
      max_output_tokens: config.maxTokens,
      stream: true,
    },
    {
      model: config.model,
      input: `${instructions}\n\n${conversationText(messages)}`,
      stream: true,
    },
  ];
  const endpointErrors: AiHttpError[] = [];

  for (const url of urls) {
    try {
      let lastParamError: AiHttpError | null = null;

      for (const payload of payloads) {
        try {
          await streamResponse(
            url,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${config.apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            },
            (_event, data) => {
              const delta = extractOpenAiResponsesStreamDelta(data);
              if (delta) callbacks.onDelta(delta);
            },
          );
          return;
        } catch (error) {
          if (!(error instanceof AiHttpError) || error.status !== 400) {
            throw error;
          }

          lastParamError = error;
        }
      }

      throw lastParamError ?? new Error("OpenAI Responses stream failed.");
    } catch (error) {
      if (isRetryableEndpointError(error)) {
        endpointErrors.push(error);
        continue;
      }

      throw error;
    }
  }

  return throwEndpointErrors("OpenAI Responses", endpointErrors);
};

const streamOpenAiResponsesWithFallback = async (
  request: AiCompletionRequest,
  callbacks: StreamCallbacks,
) => {
  try {
    await streamOpenAiResponses(request, callbacks);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("OpenAI Responses endpoint not found")
    ) {
      callbacks.onDelta(
        "当前 API Base 不支持 /responses，已自动改用 Chat Completions 格式完成本次请求。\n\n",
      );
      await streamOpenAiCompatible(
        {
          ...request,
          config: {
            ...request.config,
            provider: "openai-chat",
          },
        },
        callbacks,
      );
      return;
    }

    throw error;
  }
};

const streamAnthropic = async (
  request: AiCompletionRequest,
  callbacks: StreamCallbacks,
) => {
  const { config } = request;
  const url = endpointFor(config.apiBase, "/v1/messages");
  const messages = cleanMessages(request.messages);

  await streamResponse(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        system: buildSystemPrompt(request.paperTitle, request.contextItems),
        messages,
        stream: true,
      }),
    },
    (_event, data) => {
      const delta = extractAnthropicStreamDelta(data);
      if (delta) callbacks.onDelta(delta);
    },
  );
};

export const streamAiCompletion = async (
  request: AiCompletionRequest,
  callbacks: StreamCallbacks,
) => {
  validateConfig(request.config);

  if (request.config.provider === "anthropic") {
    await streamAnthropic(request, callbacks);
    return;
  }

  if (request.config.provider === "openai-responses") {
    await streamOpenAiResponsesWithFallback(request, callbacks);
    return;
  }

  await streamOpenAiCompatible(request, callbacks);
};
