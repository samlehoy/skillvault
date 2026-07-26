import { z } from "zod";
import { normalizeSkillId } from "./skill-id.js";

/**
 * Versioned manifest (`skills.yaml`) and lockfile (`skills.lock.json`)
 * schemas (ARCHITECTURE.md, "Source resolution and locking"). Parsers accept
 * already-parsed data; file and YAML/JSON handling live at an outer layer so
 * the core stays filesystem-free.
 *
 * Schema versions other than 1 fail closed: no partial interpretation.
 */

export const SUPPORTED_SCHEMA = 1;

const nonEmpty = z.string().min(1);
const canonicalId = nonEmpty.refine(
  (value) => {
    const result = normalizeSkillId(value);
    return result.ok && result.id === value;
  },
  { message: "must be a canonical lowercase kebab-case skill ID" },
);

const gitSourceSchema = z.strictObject({
  type: z.literal("git"),
  repository: nonEmpty,
  subdir: nonEmpty.optional(),
  ref: nonEmpty.optional(),
});

const localSourceSchema = z.strictObject({
  type: z.literal("local"),
  path: nonEmpty,
});

const sourceSchema = z.discriminatedUnion("type", [
  gitSourceSchema,
  localSourceSchema,
]);

const declarationSchema = z.strictObject({
  source: sourceSchema,
  targets: z.array(canonicalId).nonempty().optional(),
});

const disabledSchema = z.strictObject({ disabled: z.literal(true) });

const manifestEntrySchema = z.union([declarationSchema, disabledSchema]);

const manifestSchema = z.strictObject({
  schema: z.literal(SUPPORTED_SCHEMA),
  skills: z.record(canonicalId, manifestEntrySchema),
});

export type SkillSource = z.infer<typeof sourceSchema>;
export type SkillDeclaration = z.infer<typeof declarationSchema>;
export type ManifestEntry = z.infer<typeof manifestEntrySchema>;
export type Manifest = z.infer<typeof manifestSchema>;

const lockedGitSourceSchema = z.strictObject({
  type: z.literal("git"),
  repository: nonEmpty,
  subdir: nonEmpty.optional(),
});

const contentHash = z
  .string()
  .regex(/^sha256:[0-9a-f]+$/, "must be a sha256:<hex> content hash");

const commitSha = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "must be a full 40-character commit SHA");

const gitLockEntrySchema = z.strictObject({
  source: lockedGitSourceSchema,
  resolved: z.strictObject({ commit: commitSha, contentHash }),
});

const localLockEntrySchema = z.strictObject({
  source: localSourceSchema,
  resolved: z.strictObject({ contentHash }),
});

const lockEntrySchema = z.union([gitLockEntrySchema, localLockEntrySchema]);

const lockfileSchema = z.strictObject({
  schema: z.literal(SUPPORTED_SCHEMA),
  skills: z.record(canonicalId, lockEntrySchema),
});

export type LockEntry = z.infer<typeof lockEntrySchema>;
export type Lockfile = z.infer<typeof lockfileSchema>;

export interface ParseError {
  readonly code: string;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export type ParseResult<TDoc, TKey extends string> =
  | { readonly ok: true } & { readonly [K in TKey]: TDoc }
  | { readonly ok: false; readonly errors: readonly ParseError[] };

function gate(
  data: unknown,
  kind: "manifest" | "lockfile",
): readonly ParseError[] | undefined {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return [
      {
        code: `${kind}/not-object`,
        path: [],
        message: `A ${kind} must be an object.`,
      },
    ];
  }
  const version = (data as Record<string, unknown>)["schema"];
  if (version !== SUPPORTED_SCHEMA) {
    return [
      {
        code: `${kind}/unsupported-schema`,
        path: ["schema"],
        message: `Unsupported ${kind} schema version ${JSON.stringify(version)}; this build supports version ${SUPPORTED_SCHEMA} only.`,
      },
    ];
  }
  return undefined;
}

function zodErrors(
  kind: "manifest" | "lockfile",
  issues: readonly z.core.$ZodIssue[],
): ParseError[] {
  return issues.map((issue) => {
    const path = issue.path.map((p) => (typeof p === "symbol" ? String(p) : p));
    if (issue.code === "invalid_key" && path[0] === "skills") {
      return {
        code: `${kind}/invalid-id`,
        path,
        message:
          issue.issues.map((nested) => nested.message).join("; ") ||
          issue.message,
      };
    }
    return { code: `${kind}/invalid`, path, message: issue.message };
  });
}

export function parseManifest(
  data: unknown,
): ParseResult<Manifest, "manifest"> {
  const gateErrors = gate(data, "manifest");
  if (gateErrors) return { ok: false, errors: gateErrors };

  const result = manifestSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, errors: zodErrors("manifest", result.error.issues) };
  }
  return { ok: true, manifest: result.data };
}

export function parseLockfile(
  data: unknown,
): ParseResult<Lockfile, "lockfile"> {
  const gateErrors = gate(data, "lockfile");
  if (gateErrors) return { ok: false, errors: gateErrors };

  const result = lockfileSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, errors: zodErrors("lockfile", result.error.issues) };
  }
  return { ok: true, lockfile: result.data };
}
