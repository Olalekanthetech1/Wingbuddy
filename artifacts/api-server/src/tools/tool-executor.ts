import { ToolRegistry, type ToolContext } from "./tool-registry";

export class ToolExecutor {
  constructor(private readonly registry: ToolRegistry) {}

  async execute(name: string, input: unknown, context: ToolContext): Promise<unknown> {
    const tool = this.registry.get(name);
    if (!tool) throw new Error(`Unknown assistant tool: ${name}`);
    return tool.execute(input, context);
  }
}