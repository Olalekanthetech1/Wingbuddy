export interface ToolContext {
  telegramUserId: number;
  chatId: number;
}

export interface ToolSecurityPolicy {
  sideEffect: boolean;
  destructive: boolean;
  confirmationRequired: boolean;
  requiredCapabilities: string[];
  timeoutMs: number;
}

export const DEFAULT_TOOL_POLICY: ToolSecurityPolicy = {
  sideEffect: false,
  destructive: false,
  confirmationRequired: false,
  requiredCapabilities: [],
  timeoutMs: 30000,
};

export interface AssistantTool {
  name: string;
  description: string;
  policy?: Partial<ToolSecurityPolicy>;
  execute: (input: unknown, context: ToolContext) => Promise<unknown>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, AssistantTool>();

  register(tool: AssistantTool, policy?: Partial<ToolSecurityPolicy>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    if (policy) {
      tool.policy = { ...(tool.policy || {}), ...policy };
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): AssistantTool | undefined {
    return this.tools.get(name);
  }

  getPolicy(name: string): ToolSecurityPolicy {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ...DEFAULT_TOOL_POLICY };
    }
    return {
      ...DEFAULT_TOOL_POLICY,
      ...(tool.policy || {}),
    };
  }

  list(): AssistantTool[] {
    return [...this.tools.values()];
  }
}