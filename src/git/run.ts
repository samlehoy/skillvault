import { spawnSync } from "node:child_process";

/**
 * Thin shell-out to the system `git` executable (ADR-0002; ARCHITECTURE.md,
 * "Git access"). Authentication is fully delegated to the user's Git
 * configuration and credential helpers; SkillVault never reads, passes, or
 * stores credentials itself. `GIT_TERMINAL_PROMPT=0` keeps every invocation
 * non-interactive: an unauthenticated remote fails fast instead of hanging
 * the TUI on a hidden prompt.
 */

export interface GitFailure {
  readonly code: "git/not-found" | "git/failed";
  readonly message: string;
}

export type GitRunResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly error: GitFailure };

export interface GitRunOptions {
  readonly cwd?: string;
}

export function runGit(
  args: readonly string[],
  options: GitRunOptions = {},
): GitRunResult {
  const result = spawnSync("git", [...args], {
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) {
    return {
      ok: false,
      error: {
        code: "git/not-found",
        message: `Could not run the system git executable: ${result.error.message}`,
      },
    };
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    return {
      ok: false,
      error: {
        code: "git/failed",
        message:
          stderr !== ""
            ? stderr
            : `git ${args.join(" ")} exited with status ${result.status}`,
      },
    };
  }
  return { ok: true, stdout: result.stdout ?? "" };
}
