import { spawn, ChildProcess } from "child_process";
import type { ClaudeStreamChunk } from "./types";

export interface ClaudeServiceOptions {
  claudePath: string;
  timeout: number;
  systemPrompt: string;
  model: string;
  extraArgs: string;
  envVars: string;
}

export interface ClaudeResult {
  text: string;
  error?: string;
}

export function sanitizeResponse(text: string): string {
  let result = text.trim();

  // Strip wrapping markdown fences (```markdown ... ``` or ``` ... ```)
  const fenceMatch = result.match(
    /^```(?:\w*)\s*\n([\s\S]*?)\n?\s*```\s*$/
  );
  if (fenceMatch) {
    result = fenceMatch[1]!.trim();
  }

  // Strip common preamble patterns
  const preamblePatterns = [
    /^(?:Here(?:'s| is) (?:the |my )?(?:revised|updated|edited|rewritten|modified) (?:text|version|content|section)[:\s]*\n+)/i,
    /^(?:Sure[,!.]?\s*(?:Here(?:'s| is)[^:\n]*[:\s]*\n+)?)/i,
  ];
  for (const pattern of preamblePatterns) {
    result = result.replace(pattern, "");
  }

  return result.trim();
}

export function parseArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let inDouble = false;
  let inSingle = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (/\s/.test(ch) && !inDouble && !inSingle) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}

export function parseEnvVars(input: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of input.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      env[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
    }
  }
  return env;
}

export function invokeClaude(
  prompt: string,
  options: ClaudeServiceOptions,
  onChunk?: (partialText: string) => void
): { promise: Promise<ClaudeResult>; cancel: () => void } {
  let proc: ChildProcess | null = null;
  let cancelled = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const promise = new Promise<ClaudeResult>((resolve) => {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--no-session-persistence",
      "--system-prompt",
      options.systemPrompt,
    ];

    if (options.model) {
      args.push("--model", options.model);
    }

    if (options.extraArgs.trim()) {
      args.push(...parseArgs(options.extraArgs));
    }

    const spawnEnv = options.envVars.trim()
      ? { ...process.env, ...parseEnvVars(options.envVars) }
      : undefined;

    proc = spawn(options.claudePath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...(spawnEnv && { env: spawnEnv }),
    });

    let stderrData = "";
    let resultText = "";
    let buffer = "";
    let resolved = false;

    const doResolve = (result: ClaudeResult) => {
      if (resolved) return;
      resolved = true;
      if (timeoutId) clearTimeout(timeoutId);
      resolve(result);
    };

    proc.stdout?.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk: ClaudeStreamChunk = JSON.parse(line);

          if (chunk.type === "assistant" && chunk.message?.content) {
            for (const block of chunk.message.content) {
              if (block.type === "text" && block.text) {
                onChunk?.(block.text);
              }
            }
          }

          if (chunk.type === "result") {
            if (chunk.is_error) {
              doResolve({
                text: "",
                error: chunk.result ?? "Unknown error from Claude CLI",
              });
              return;
            }
            resultText = chunk.result ?? "";
          }
        } catch {
          // Skip non-JSON lines
        }
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderrData += data.toString();
    });

    proc.on("close", (code) => {
      if (cancelled) {
        doResolve({ text: "", error: "Cancelled" });
        return;
      }
      if (code !== 0 && !resultText) {
        doResolve({
          text: "",
          error: stderrData || `Claude CLI exited with code ${code}`,
        });
        return;
      }
      doResolve({ text: sanitizeResponse(resultText) });
    });

    proc.on("error", (err) => {
      doResolve({
        text: "",
        error: `Failed to start Claude CLI: ${err.message}`,
      });
    });

    proc.stdin?.write(prompt);
    proc.stdin?.end();

    timeoutId = setTimeout(() => {
      if (proc && !proc.killed) {
        proc.kill();
        doResolve({
          text: "",
          error: `Claude CLI timed out after ${options.timeout} seconds`,
        });
      }
    }, options.timeout * 1000);
  });

  const cancel = () => {
    cancelled = true;
    if (proc && !proc.killed) {
      proc.kill();
    }
  };

  return { promise, cancel };
}
