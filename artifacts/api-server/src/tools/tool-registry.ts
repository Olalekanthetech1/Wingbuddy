export interface ToolContext {
  telegramUserId: number;
  chatId: number;
}

export interface AssistantTool {
  name: string;
  description: string;
  execute: (input: unknown, context: ToolContext) => Promise<unknown>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, AssistantTool>();

  register(tool: AssistantTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): AssistantTool | undefined {
    return this.tools.get(name);
  }

  list(): AssistantTool[] {
    return [...this.tools.values()];
  }
}