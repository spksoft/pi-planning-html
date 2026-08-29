import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const INSPECTION_OPERATIONS = [
    "git_status",
    "git_diff",
    "git_log",
    "git_show",
    "package_manifest",
    "package_scripts",
    "command_version",
] as const;

export interface InspectInput {
    operation: (typeof INSPECTION_OPERATIONS)[number];
    path?: string | undefined;
    ref?: string | undefined;
    limit?: number | undefined;
    staged?: boolean | undefined;
    command?: string | undefined;
}

export interface ExecResult {
    stdout: string;
    stderr: string;
    code: number | null;
}

export type Exec = (
    command: string,
    args: string[],
    options: { cwd: string; timeout: number },
) => Promise<ExecResult>;

const VERSION_COMMANDS: Record<string, [string, string[]]> = {
    node: ["node", ["--version"]],
    npm: ["npm", ["--version"]],
    pnpm: ["pnpm", ["--version"]],
    yarn: ["yarn", ["--version"]],
    bun: ["bun", ["--version"]],
    python: ["python", ["--version"]],
    python3: ["python3", ["--version"]],
    go: ["go", ["version"]],
    rustc: ["rustc", ["--version"]],
    cargo: ["cargo", ["--version"]],
};

function projectPath(cwd: string, requested = "package.json"): string {
    const root = resolve(cwd);
    const target = resolve(root, requested);
    const fromRoot = relative(root, target);
    if (
        fromRoot === ".." ||
        fromRoot.startsWith(`..${sep}`) ||
        isAbsolute(fromRoot)
    ) {
        throw new Error("Inspection path escapes the project root.");
    }
    return target;
}

function gitPath(cwd: string, requested?: string): string | undefined {
    if (!requested) return undefined;
    const absolute = projectPath(cwd, requested);
    return relative(resolve(cwd), absolute).split(sep).join("/") || ".";
}

function bounded(text: string, maximum = 50_000): string {
    if (text.length <= maximum) return text;
    return `${text.slice(0, maximum)}\n\n[Inspection output truncated to ${maximum} characters.]`;
}

async function run(
    exec: Exec,
    cwd: string,
    command: string,
    args: string[],
): Promise<string> {
    const result = await exec(command, args, { cwd, timeout: 30_000 });
    const output = [result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n")
        .trim();
    if (result.code !== 0)
        throw new Error(
            `${command} exited ${result.code}: ${bounded(output || "no output")}`,
        );
    return bounded(output || "(no output)");
}

export async function inspectProject(
    exec: Exec,
    cwd: string,
    input: InspectInput,
): Promise<string> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
    switch (input.operation) {
        case "git_status":
            return run(exec, cwd, "git", [
                "status",
                "--short",
                "--untracked-files=all",
            ]);
        case "git_diff": {
            const args = ["diff", "--no-ext-diff"];
            if (input.staged) args.push("--cached");
            const path = gitPath(cwd, input.path);
            if (path) args.push("--", path);
            return run(exec, cwd, "git", args);
        }
        case "git_log":
            return run(exec, cwd, "git", [
                "log",
                `-${limit}`,
                "--oneline",
                "--decorate",
            ]);
        case "git_show": {
            const ref = input.ref?.trim() || "HEAD";
            if (!/^[a-zA-Z0-9_./@^~:-]+$/.test(ref))
                throw new Error("Git ref contains unsupported characters.");
            const args = ["show", "--stat", "--oneline", ref];
            const path = gitPath(cwd, input.path);
            if (path) args.push("--", path);
            return run(exec, cwd, "git", args);
        }
        case "package_manifest":
            return bounded(
                await readFile(projectPath(cwd, input.path), "utf8"),
            );
        case "package_scripts": {
            const manifest = JSON.parse(
                await readFile(projectPath(cwd, input.path), "utf8"),
            ) as { scripts?: Record<string, string> };
            return JSON.stringify(manifest.scripts ?? {}, null, 2);
        }
        case "command_version": {
            const selected = input.command?.trim() ?? "";
            const command = VERSION_COMMANDS[selected];
            if (!command)
                throw new Error(
                    `Unsupported version command: ${selected || "<missing>"}.`,
                );
            return run(exec, cwd, command[0], command[1]);
        }
    }
}
