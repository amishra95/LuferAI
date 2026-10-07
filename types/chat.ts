import type { InferUITools, LanguageModelUsage, UIDataTypes, UIMessage } from "ai";

import type { ChatTools } from "@/lib/ai/chat-tools";

export type ChatMessageMetadata = {
  model?: string;
  /** True when the reply was scripted because no model is configured. */
  demo?: boolean;
  usage?: LanguageModelUsage;
};

export type LuferUIMessage = UIMessage<ChatMessageMetadata, UIDataTypes, InferUITools<ChatTools>>;

export type LuferMessagePart = LuferUIMessage["parts"][number];

export type ChatToolName = keyof ChatTools;
