import fs from "node:fs";
import path from "node:path";

/**
 * Directory-junction primitives (ARCHITECTURE.md, "Vault and Link Model").
 *
 * Every managed-link mutation in SkillVault flows through this module. The
 * invariants it protects:
 *
 * - A link is only ever removed when it is verifiably a link (`lstat`), so a
 *   real directory can never be deleted by link management.
 * - Removing a link never touches the target's content.
 * - Junction targets are stored absolute; `type: "junction"` needs no
 *   elevation on Windows and degrades to a directory symlink elsewhere.
 */

export interface JunctionError {
  readonly code:
    | "junction/target-missing"
    | "junction/target-not-directory"
    | "junction/link-exists"
    | "junction/not-a-link"
    | "junction/missing"
    | "junction/io-error";
  readonly path: string;
  readonly message: string;
}

export type JunctionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: JunctionError };

const fail = (
  code: JunctionError["code"],
  errPath: string,
  message: string,
): JunctionResult => ({ ok: false, error: { code, path: errPath, message } });

export type PathInspection =
  | { readonly kind: "missing" }
  | { readonly kind: "directory" }
  | { readonly kind: "file" }
  | {
      readonly kind: "junction";
      readonly target: string;
      readonly targetExists: boolean;
    };

export function inspectPath(inspected: string): PathInspection {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(inspected);
  } catch {
    return { kind: "missing" };
  }

  if (stats.isSymbolicLink()) {
    const target = path.resolve(
      path.dirname(inspected),
      fs.readlinkSync(inspected),
    );
    return { kind: "junction", target, targetExists: fs.existsSync(target) };
  }
  if (stats.isDirectory()) return { kind: "directory" };
  return { kind: "file" };
}

export function createJunction(target: string, link: string): JunctionResult {
  const absoluteTarget = path.resolve(target);

  const targetInspection = inspectPath(absoluteTarget);
  if (targetInspection.kind === "missing") {
    return fail(
      "junction/target-missing",
      absoluteTarget,
      `Junction target does not exist: ${absoluteTarget}`,
    );
  }
  if (targetInspection.kind !== "directory") {
    return fail(
      "junction/target-not-directory",
      absoluteTarget,
      `Junction target is not a directory: ${absoluteTarget}`,
    );
  }
  if (inspectPath(link).kind !== "missing") {
    return fail(
      "junction/link-exists",
      link,
      `Cannot create junction: something already exists at ${link}`,
    );
  }

  try {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(absoluteTarget, link, "junction");
    return { ok: true };
  } catch (error) {
    return fail(
      "junction/io-error",
      link,
      `Failed to create junction: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function removeJunction(link: string): JunctionResult {
  const inspection = inspectPath(link);
  if (inspection.kind === "missing") {
    return fail("junction/missing", link, `No link exists at ${link}`);
  }
  if (inspection.kind !== "junction") {
    return fail(
      "junction/not-a-link",
      link,
      `Refusing to remove ${link}: it is a real ${inspection.kind}, not a link.`,
    );
  }

  try {
    fs.rmdirSync(link);
    return { ok: true };
  } catch (error) {
    return fail(
      "junction/io-error",
      link,
      `Failed to remove junction: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
