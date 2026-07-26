import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  discoverInstallation,
  discoverSkills,
} from "../adapters/opencode.js";
import {
  createJunction,
  inspectPath,
  removeJunction,
} from "../fs/junction.js";

/**
 * Headless `doctor` (PRODUCT.md, "Minimal Headless Operations"): diagnoses
 * configuration, links, and adapter health without mutating anything outside
 * its scratch directory. Warns describe an uninitialized-but-healthy state;
 * fails describe conditions that block SkillVault from working.
 */

export interface DoctorCheck {
  readonly id: string;
  readonly status: "pass" | "warn" | "fail";
  readonly detail: string;
}

export interface DoctorReport {
  readonly checks: readonly DoctorCheck[];
  /** True when no check failed (warnings allowed). */
  readonly ok: boolean;
}

export interface DoctorEnvironment {
  readonly homeDir: string;
  readonly projectDir?: string;
  /** Directory the junction probe may write in; always left empty. */
  readonly scratchDir: string;
  /** Injectable for tests; returns a version string or null when missing. */
  readonly gitVersion?: () => string | null;
}

function defaultGitVersion(): string | null {
  const result = spawnSync("git", ["--version"], { encoding: "utf8" });
  if (result.status !== 0 || typeof result.stdout !== "string") return null;
  return result.stdout.trim() || null;
}

function probeJunction(scratchDir: string): DoctorCheck {
  const target = path.join(scratchDir, "doctor-target");
  const link = path.join(scratchDir, "doctor-link");
  try {
    fs.mkdirSync(target, { recursive: true });
    const created = createJunction(target, link);
    if (!created.ok) {
      return {
        id: "junction-capability",
        status: "fail",
        detail: created.error.message,
      };
    }
    const inspection = inspectPath(link);
    const healthy =
      inspection.kind === "junction" && inspection.targetExists;
    removeJunction(link);
    return healthy
      ? {
          id: "junction-capability",
          status: "pass",
          detail: "Junctions can be created, inspected, and removed.",
        }
      : {
          id: "junction-capability",
          status: "fail",
          detail: "Created junction did not inspect as a live junction.",
        };
  } catch (error) {
    return {
      id: "junction-capability",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    fs.rmSync(link, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
}

export function runDoctor(env: DoctorEnvironment): DoctorReport {
  const checks: DoctorCheck[] = [];

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    id: "node-version",
    status: nodeMajor >= 20 ? "pass" : "fail",
    detail: `Node ${process.versions.node} (requires >= 20).`,
  });

  const gitVersion = (env.gitVersion ?? defaultGitVersion)();
  checks.push(
    gitVersion === null
      ? {
          id: "git",
          status: "fail",
          detail:
            "git was not found on PATH; Git sources and update checks will not work.",
        }
      : { id: "git", status: "pass", detail: gitVersion },
  );

  checks.push(probeJunction(env.scratchDir));

  const discoveryEnv = {
    homeDir: env.homeDir,
    ...(env.projectDir !== undefined ? { projectDir: env.projectDir } : {}),
  };
  const installation = discoverInstallation(discoveryEnv);
  checks.push(
    installation.present
      ? {
          id: "opencode-installation",
          status: "pass",
          detail: `OpenCode config found at ${installation.configRoot}.`,
        }
      : {
          id: "opencode-installation",
          status: "warn",
          detail: `No OpenCode config at ${installation.configRoot}.`,
        },
  );

  const skills = discoverSkills(discoveryEnv);
  const dangling = skills.filter((s) => s.dangling).length;
  checks.push({
    id: "opencode-skills",
    status: dangling > 0 ? "warn" : "pass",
    detail: `${skills.length} skill entries discovered${dangling > 0 ? `, ${dangling} dangling junction(s)` : ""}.`,
  });

  const vaultRoot = path.join(env.homeDir, ".skillvault");
  checks.push(
    inspectPath(vaultRoot).kind === "directory"
      ? {
          id: "vault-root",
          status: "pass",
          detail: `Vault root initialized at ${vaultRoot}.`,
        }
      : {
          id: "vault-root",
          status: "warn",
          detail: `Vault root not initialized yet (${vaultRoot} is created on first ingest).`,
        },
  );

  return {
    checks,
    ok: checks.every((check) => check.status !== "fail"),
  };
}
