import type { InferUITools, LanguageModelUsage, UIDataTypes, UIMessage } from "ai";

import type { ChatTools } from "@/lib/ai/chat-tools";

export type ChatMessageMetadata = {
  model?: string;
  usage?: LanguageModelUsage;
  /** The request's trace (sent to admins only: traces are operator data). */
  traceId?: string;
};

export type LuferUIMessage = UIMessage<ChatMessageMetadata, UIDataTypes, InferUITools<ChatTools>>;

export type LuferMessagePart = LuferUIMessage["parts"][number];

export type ChatToolName = keyof ChatTools;
