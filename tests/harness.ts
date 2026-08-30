type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details?: unknown;
  terminate?: boolean;
};

interface FakeContext {
  cwd: string;
  hasUI: boolean;
  mode: string;
  ui: {
    select: (title: string, options: string[]) => Promise<string | undefined>;
    input: (title: string, placeholder?: string) => Promise<string | undefined>;
    notify: (message: string, level?: string) => void;
    notifications: Array<{ message: string; level: string }>;
  };
  sessionManager: {
    getBranch: () => unknown[];
  };
}

export interface Harness {
  tools: Map<
    string,
    {
      execute: (
        _id: string,
        params: Record<string, unknown>,
        signal: undefined,
        update: undefined,
        ctx: FakeContext,
      ) => Promise<ToolResult>;
    }
  >;
  commands: Map<string, (args: string, ctx: FakeContext) => Promise<void>>;
  ctx: FakeContext;
  activeTools: string[];
  sentUserMessages: string[];
  callTool: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<ToolResult>;
  runCommand: (name: string, args?: string) => Promise<void>;
  queueSelect: (...answers: Array<string | undefined>) => void;
  queueInput: (...answers: Array<string | undefined>) => void;
}

export function createHarness(options: { cwd: string; hasUI?: boolean }): {
  pi: unknown;
  harness: Harness;
} {
  const selects: Array<string | undefined> = [];
  const inputs: Array<string | undefined> = [];
  const ui = {
    notifications: [] as Array<{ message: string; level: string }>,
    select: async () => selects.shift(),
    input: async () => inputs.shift(),
    notify: (message: string, level = "info") =>
      ui.notifications.push({ message, level }),
  };
  const entries: unknown[] = [];
  const ctx: FakeContext = {
    cwd: options.cwd,
    hasUI: options.hasUI ?? true,
    mode: options.hasUI === false ? "print" : "tui",
    ui,
    sessionManager: {
      getBranch: () => [...entries],
    },
  };
  const tools = new Map<
    string,
    Harness["tools"] extends Map<string, infer Tool> ? Tool : never
  >();
  const commands = new Map<
    string,
    (args: string, context: FakeContext) => Promise<void>
  >();
  const activeTools = ["read", "bash", "edit", "write", "subagent"];
  const sentUserMessages: string[] = [];

  const harness: Harness = {
    tools,
    commands,
    ctx,
    activeTools,
    sentUserMessages,
    callTool: async (name, params) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool not registered: ${name}`);
      const toolResult = await tool.execute(
        "call-1",
        params,
        undefined,
        undefined,
        ctx,
      );
      entries.push({
        type: "message",
        message: {
          role: "toolResult",
          toolName: name,
          details: toolResult.details,
        },
      });
      return toolResult;
    },
    runCommand: async (name, args = "") => {
      const command = commands.get(name);
      if (!command) throw new Error(`Command not registered: ${name}`);
      await command(args, ctx);
    },
    queueSelect: (...answers) => selects.push(...answers),
    queueInput: (...answers) => inputs.push(...answers),
  };

  const pi = {
    registerTool(definition: {
      name: string;
      execute: Harness["tools"] extends Map<string, infer Tool>
        ? Tool extends { execute: infer Execute }
          ? Execute
          : never
        : never;
    }) {
      tools.set(definition.name, definition as never);
    },
    registerCommand(
      name: string,
      definition: {
        handler: (args: string, context: FakeContext) => Promise<void>;
      },
    ) {
      commands.set(name, definition.handler);
    },
    getActiveTools: () => [...activeTools],
    getAllTools: () =>
      activeTools.map((name) => ({
        name,
        description: name,
        sourceInfo: { source: "builtin", path: `<${name}>` },
      })),
    setActiveTools: (names: string[]) => {
      activeTools.splice(0, activeTools.length, ...names);
    },
    sendUserMessage: (content: string) => sentUserMessages.push(content),
  };

  return { pi, harness };
}
