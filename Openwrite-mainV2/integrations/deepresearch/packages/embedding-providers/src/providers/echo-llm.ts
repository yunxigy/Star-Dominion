// EchoLlmChat：确定性 echo LLM。用于 sub-agent 跑通和单测。
// 不调外部 LLM；返回基于输入的 echo 回复。
// 生产环境用 DeepSeekChat 或 OpenAICompatibleChat。

import type { LlmChat, LlmChatRequest, LlmChatResponse } from "@deepresearch/contracts";

export interface EchoLlmChatOptions {
  /** 固定延迟（ms），用于模拟真实 LLM 调用 */
  delayMs?: number;
  /** 自定义 echo 函数（默认原样返回 user + 简单包装） */
  echoFn?: (req: LlmChatRequest) => string;
}

export class EchoLlmChat implements LlmChat {
  readonly name = "echo";
  private readonly opts: EchoLlmChatOptions;

  constructor(opts: EchoLlmChatOptions = {}) {
    this.opts = opts;
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
    if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs));
    const content = this.opts.echoFn
      ? this.opts.echoFn(req)
      : `[echo] ${req.user.slice(0, 200)}`;
    return {
      content,
      usage: { promptTokens: req.user.length, completionTokens: content.length, totalTokens: req.user.length + content.length },
    };
  }
}
