import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";
import type { Plan } from "../core/plan.js";

/**
 * Inventory-centric TUI (PRODUCT.md, "TUI-first management").
 *
 * Components never touch the filesystem or compute effective state: every
 * capability arrives through the injected {@link TuiCore} facade as typed
 * requests and responses, so cancelling a plan review provably performs no
 * mutation — the facade is simply never called.
 *
 * Keys: up/down select, l = plan link for the selected skill,
 * y/n = apply/cancel inside plan review.
 */

export type Health = "ok" | "drift" | "dangling" | "unmanaged";

export interface InventoryRow {
  readonly id: string;
  readonly scope: string;
  readonly location: string;
  readonly health: Health;
  readonly path: string;
}

export type PlanBuildOutcome =
  | { readonly ok: true; readonly plan: Plan; readonly noop: boolean }
  | { readonly ok: false; readonly message: string };

export interface ApplyOutcome {
  readonly ok: boolean;
  readonly message: string;
}

export interface TuiCore {
  loadInventory(): InventoryRow[];
  buildLinkPlan(skillId: string): PlanBuildOutcome;
  applyPlan(plan: Plan): ApplyOutcome;
}

const HEALTH_COLOR: Record<Health, string> = {
  ok: "green",
  drift: "yellow",
  dangling: "red",
  unmanaged: "cyan",
};

type View =
  | { readonly name: "inventory" }
  | { readonly name: "plan-review"; readonly plan: Plan }
  | { readonly name: "result"; readonly outcome: ApplyOutcome };

function describeOperationLine(operation: Plan["operations"][number]): string {
  switch (operation.kind) {
    case "link-create":
      return `link-create   ${operation.path} -> ${operation.targetPath}`;
    case "link-remove":
      return `link-remove   ${operation.path}`;
    case "backup":
      return `backup        ${operation.sourcePath} -> ${operation.backupId}`;
    case "restore":
      return `restore       ${operation.backupId} -> ${operation.targetPath}`;
    default:
      return operation.kind;
  }
}

export function App({ core }: { readonly core: TuiCore }) {
  const inventory = useMemo(() => core.loadInventory(), [core]);
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<View>({ name: "inventory" });
  const [notice, setNotice] = useState<string | null>(null);

  useInput((input, key) => {
    if (view.name === "plan-review") {
      if (input === "y") {
        setView({ name: "result", outcome: core.applyPlan(view.plan) });
      } else if (input === "n" || key.escape) {
        setView({ name: "inventory" });
      }
      return;
    }
    if (view.name === "result") {
      setView({ name: "inventory" });
      return;
    }

    if (key.downArrow) {
      setSelected((current) => Math.min(current + 1, inventory.length - 1));
      setNotice(null);
    } else if (key.upArrow) {
      setSelected((current) => Math.max(current - 1, 0));
      setNotice(null);
    } else if (input === "l") {
      const row = inventory[selected];
      if (!row) return;
      const built = core.buildLinkPlan(row.id);
      if (built.ok) {
        setView({ name: "plan-review", plan: built.plan });
        setNotice(null);
      } else {
        setNotice(built.message);
      }
    }
  });

  const row = inventory[selected];

  if (view.name === "plan-review") {
    const { plan } = view;
    return (
      <Box flexDirection="column">
        <Text bold>Plan review</Text>
        <Text dimColor>{plan.id}</Text>
        <Box borderStyle="round" flexDirection="column" paddingX={1}>
          {plan.operations.length === 0 ? (
            <Text dimColor>No operations: already in the desired state.</Text>
          ) : (
            plan.operations.map((operation, index) => (
              <Text key={index}>{describeOperationLine(operation)}</Text>
            ))
          )}
        </Box>
        {plan.backupRequired.length > 0 ? (
          <Text color="yellow">
            Backs up before mutation: {plan.backupRequired.join(", ")}
          </Text>
        ) : null}
        <Text>
          Apply? <Text bold>y</Text> = apply, <Text bold>n</Text> = cancel (no
          changes)
        </Text>
      </Box>
    );
  }

  if (view.name === "result") {
    return (
      <Box flexDirection="column">
        <Text bold color={view.outcome.ok ? "green" : "red"}>
          {view.outcome.ok ? "Success" : "Failed"}
        </Text>
        <Text>{view.outcome.message}</Text>
        <Text dimColor>Press any key to return.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>SkillVault</Text>
      <Text dimColor>
        {inventory.length} skills discovered · arrows select · l = plan link
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {inventory.map((entry, index) => (
          <Box key={`${entry.path}`} gap={1}>
            <Text>{index === selected ? ">" : " "}</Text>
            <Text color={HEALTH_COLOR[entry.health]}>
              {entry.health.padEnd(9)}
            </Text>
            <Text bold={index === selected}>{entry.id.padEnd(24)}</Text>
            <Text dimColor>
              {entry.scope}/{entry.location}
            </Text>
          </Box>
        ))}
      </Box>
      {row ? (
        <Box borderStyle="round" flexDirection="column" paddingX={1} marginTop={1}>
          <Text bold>{row.id}</Text>
          <Text dimColor>{row.path}</Text>
          <Text>
            {row.scope} · {row.location} · {row.health}
          </Text>
        </Box>
      ) : null}
      {notice !== null ? <Text color="red">{notice}</Text> : null}
    </Box>
  );
}
