import {
  PLANNING_STATE_ENTRY,
  restorePlanningState,
  type PlanningState,
} from "../extensions/planning/state.ts";

export type ToolParams = Record<string, unknown> | object;

export interface FakeToolDefinition {
  name: string;
  execute: (
    id: string,
    params: ToolParams,
    signal: undefined,
    onUpdate: undefined,
    ctx: FakeContext,
  ) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    details?: unknown;
  }>;
}

export interface FakeContext {
  cwd: string;
  hasUI: boolean;
  mode: string;
  ui: FakeUi;
  sessionManager: FakeSessionManager;
  isProjectTrusted: () => boolean;
  newSession: (_options: unknown) => Promise<{ cancelled: boolean }>;
}

interface FakeUi {
  select: (title: string, options: string[]) => Promise<string | undefined>;
  confirm: (title: string, body: string) => Promise<boolean>;
  input: (title: string, placeholder?: string) => Promise<string | undefined>;
  editor: (title: string, value: string) => Promise<string | undefined>;
  notify: (message: string, level?: string) => void;
  setStatus: (key: string, value?: string) => void;
  setWidget: (key: string, value?: unknown) => void;
  notifications: Array<{ message: string; level: string }>;
}

interface SessionEntry {
  type: "custom";
  customType: string;
  data: unknown;
}

class FakeSessionManager {
  private entries: SessionEntry[] = [];

  getBranch(): SessionEntry[] {
    return [...this.entries];
  }

  getEntries(): SessionEntry[] {
    return [...this.entries];
  }

  getLeafId(): string | null {
    return this.entries.length > 0 ? `leaf-${this.entries.length}` : null;
  }

  getSessionId(): string {
    return "session-under-test";
  }

  getSessionFile(): string | undefined {
    return "/tmp/session-under-test.jsonl";
  }

  append(customType: string, data: unknown): void {
    // Persisted state must survive JSON serialization exactly as Pi stores it.
    this.entries.push({
      type: "custom",
      customType,
      data: JSON.parse(JSON.stringify(data)),
    });
  }
}

export interface Harness {
  tools: Map<string, FakeToolDefinition>;
  commands: Map<string, (args: string, ctx: FakeContext) => Promise<void>>;
  handlers: Map<
    string,
    Array<(event: unknown, ctx: FakeContext) => Promise<unknown>>
  >;
  ctx: FakeContext;
  session: FakeSessionManager;
  activeTools: string[];
  allTools: Array<{
    name: string;
    description: string;
    sourceInfo: { source: string; path: string };
  }>;
  sentUserMessages: string[];
  callTool: (
    name: string,
    params: ToolParams,
  ) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    details?: unknown;
  }>;
  emit: (event: string, payload: Record<string, unknown>) => Promise<unknown>;
  runCommand: (name: string, args?: string) => Promise<void>;
  persistedState: () => PlanningState | undefined;
  queueSelect: (...answers: Array<string | undefined>) => void;
  queueConfirm: (...answers: boolean[]) => void;
  queueInput: (...answers: Array<string | undefined>) => void;
}

export interface HarnessOptions {
  cwd: string;
  hasUI?: boolean;
  extensionPath: string;
  builtinTools?: string[];
}

/**
 * Minimal in-memory ExtensionAPI/ExtensionContext stand-in that exercises the real
 * extension wiring: tool registration, tool_call gating, commands, and session state.
 */
export function createHarness(options: HarnessOptions): {
  pi: unknown;
  harness: Harness;
} {
  const selects: Array<string | undefined> = [];
  const confirms: boolean[] = [];
  const inputs: Array<string | undefined> = [];
  const session = new FakeSessionManager();

  const ui: FakeUi = {
    notifications: [],
    select: async () => (selects.length > 0 ? selects.shift() : undefined),
    confirm: async () =>
      confirms.length > 0 ? Boolean(confirms.shift()) : false,
    input: async () => (inputs.length > 0 ? inputs.shift() : undefined),
    editor: async () => (inputs.length > 0 ? inputs.shift() : undefined),
    notify: (message, level = "info") => {
      ui.notifications.push({ message, level });
    },
    setStatus: () => {},
    setWidget: () => {},
  };

  const ctx: FakeContext = {
    cwd: options.cwd,
    hasUI: options.hasUI ?? true,
    mode: options.hasUI === false ? "print" : "tui",
    ui,
    sessionManager: session,
    isProjectTrusted: () => true,
    // Fresh-session setup is covered by state/tool gating here; the harness deliberately
    // reports cancellation rather than pretending to emulate Pi's nested session runtime.
    newSession: async () => ({ cancelled: true }),
  };

  const harness: Harness = {
    tools: new Map(),
    commands: new Map(),
    handlers: new Map(),
    ctx,
    session,
    activeTools: [
      ...(options.builtinTools ?? [
        "read",
        "bash",
        "edit",
        "write",
        "grep",
        "find",
        "ls",
      ]),
    ],
    allTools: (
      options.builtinTools ?? [
        "read",
        "bash",
        "edit",
        "write",
        "grep",
        "find",
        "ls",
      ]
    ).map((name) => ({
      name,
      description: name,
      sourceInfo: { source: "builtin", path: `<builtin:${name}>` },
    })),
    sentUserMessages: [],
    callTool: async (name, params) => {
      const tool = harness.tools.get(name);
      if (!tool) throw new Error(`Tool not registered: ${name}`);
      return tool.execute("call-1", params, undefined, undefined, ctx);
    },
    emit: async (event, payload) => {
      let result: unknown;
      for (const handler of harness.handlers.get(event) ?? []) {
        result = (await handler(payload, ctx)) ?? result;
      }
      return result;
    },
    runCommand: async (name, args = "") => {
      const command = harness.commands.get(name);
      if (!command) throw new Error(`Command not registered: ${name}`);
      await command(args, ctx);
    },
    persistedState: () => {
      const entries = session
        .getBranch()
        .filter((entry) => entry.customType === PLANNING_STATE_ENTRY);
      const latest = entries[entries.length - 1];
      return latest ? restorePlanningState(latest.data) : undefined;
    },
    queueSelect: (...answers) => selects.push(...answers),
    queueConfirm: (...answers) => confirms.push(...answers),
    queueInput: (...answers) => inputs.push(...answers),
  };

  const pi = {
    registerTool(definition: FakeToolDefinition & { name: string }) {
      harness.tools.set(definition.name, definition);
      if (!harness.allTools.some((tool) => tool.name === definition.name)) {
        harness.allTools.push({
          name: definition.name,
          description: definition.name,
          sourceInfo: { source: "cli", path: options.extensionPath },
        });
      }
    },
    registerCommand(
      name: string,
      definition: {
        handler: (args: string, ctx: FakeContext) => Promise<void>;
      },
    ) {
      harness.commands.set(name, definition.handler);
    },
    registerShortcut() {},
    registerFlag() {},
    getFlag: () => undefined,
    on(
      event: string,
      handler: (event: unknown, ctx: FakeContext) => Promise<unknown>,
    ) {
      const existing = harness.handlers.get(event) ?? [];
      existing.push(handler);
      harness.handlers.set(event, existing);
    },
    getActiveTools: () => [...harness.activeTools],
    getAllTools: () => harness.allTools.map((tool) => ({ ...tool })),
    setActiveTools: (names: string[]) => {
      harness.activeTools = [...names];
    },
    appendEntry: (customType: string, data: unknown) =>
      session.append(customType, data),
    sendMessage: () => {},
    sendUserMessage: (content: string) => {
      harness.sentUserMessages.push(content);
    },
    exec: async (command: string, args: string[]) => ({
      stdout: command === "git" && args[0] === "rev-parse" ? "abc123" : "",
      stderr: "",
      code: 0,
      killed: false,
    }),
    events: { on() {}, emit() {} },
  };

  return { pi, harness };
}
