import { Box, Text, useApp, useInput } from "ink";
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
 * y/n = apply/cancel inside plan review, q = quit.
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

const HEALTH_STYLE: Record<Health, { color: string; symbol: string }> = {
  ok: { color: "green", symbol: "●" },
  drift: { color: "yellow", symbol: "◆" },
  dangling: { color: "red", symbol: "✖" },
  unmanaged: { color: "cyan", symbol: "○" },
};

const VISIBLE_ROWS = 12;

type View =
  | { readonly name: "inventory" }
  | { readonly name: "plan-review"; readonly plan: Plan }
  | { readonly name: "result"; readonly outcome: ApplyOutcome };

function operationParts(
  operation: Plan["operations"][number],
): { verb: string; color: string; detail: string } {
  switch (operation.kind) {
    case "link-create":
      return {
        verb: "link-create",
        color: "green",
        detail: `${operation.path} → ${operation.targetPath}`,
      };
    case "link-remove":
      return { verb: "link-remove", color: "red", detail: operation.path };
    case "backup":
      return {
        verb: "backup",
        color: "yellow",
        detail: `${operation.sourcePath} → ${operation.backupId}`,
      };
    case "restore":
      return {
        verb: "restore",
        color: "yellow",
        detail: `${operation.backupId} → ${operation.targetPath}`,
      };
    default:
      return { verb: operation.kind, color: "white", detail: "" };
  }
}

function Header({ inventory }: { readonly inventory: InventoryRow[] }) {
  const counts = useMemo(() => {
    const byHealth: Partial<Record<Health, number>> = {};
    for (const row of inventory) {
      byHealth[row.health] = (byHealth[row.health] ?? 0) + 1;
    }
    return byHealth;
  }, [inventory]);

  return (
    <Box justifyContent="space-between">
      <Text>
        <Text bold color="magenta">
          {" ⬢ SkillVault "}
        </Text>
        <Text dimColor>· {inventory.length} skills</Text>
      </Text>
      <Text>
        {(Object.keys(HEALTH_STYLE) as Health[]).map((health) => {
          const count = counts[health];
          if (!count) return null;
          const style = HEALTH_STYLE[health];
          return (
            <Text key={health}>
              {"  "}
              <Text color={style.color}>
                {style.symbol} {count}
              </Text>
              <Text dimColor> {health}</Text>
            </Text>
          );
        })}
      </Text>
    </Box>
  );
}

function Rule() {
  return <Text dimColor>{"─".repeat(78)}</Text>;
}

function InventoryTable({
  inventory,
  selected,
}: {
  readonly inventory: InventoryRow[];
  readonly selected: number;
}) {
  const start = Math.max(
    0,
    Math.min(selected - Math.floor(VISIBLE_ROWS / 2), inventory.length - VISIBLE_ROWS),
  );
  const end = Math.min(inventory.length, start + VISIBLE_ROWS);
  const window = inventory.slice(start, end);

  return (
    <Box flexDirection="column">
      {start > 0 ? <Text dimColor>{`   ↑ ${start} more`}</Text> : null}
      {window.map((row, offset) => {
        const index = start + offset;
        const isSelected = index === selected;
        const style = HEALTH_STYLE[row.health];
        const cells = `${style.symbol} ${row.health.padEnd(10)} ${row.id.padEnd(28)} `;
        return isSelected ? (
          <Text key={row.path} inverse bold>
            {`❯ ${cells}${row.scope} · ${row.location}`}
          </Text>
        ) : (
          <Text key={row.path}>
            {"  "}
            <Text color={style.color}>{cells}</Text>
            <Text dimColor>{`${row.scope} · ${row.location}`}</Text>
          </Text>
        );
      })}
      {end < inventory.length ? (
        <Text dimColor>{`   ↓ ${inventory.length - end} more`}</Text>
      ) : null}
    </Box>
  );
}

function DetailPanel({ row }: { readonly row: InventoryRow }) {
  const style = HEALTH_STYLE[row.health];
  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text>
        <Text bold>{row.id}</Text>
        {"  "}
        <Text color={style.color}>
          {style.symbol} {row.health}
        </Text>
      </Text>
      <Text>
        <Text dimColor>{"path   "}</Text>
        {row.path}
      </Text>
      <Text>
        <Text dimColor>{"where  "}</Text>
        {row.scope} · {row.location}
      </Text>
    </Box>
  );
}

function KeyBar({ keys }: { readonly keys: readonly (readonly [string, string])[] }) {
  return (
    <Text>
      {keys.map(([key, label], index) => (
        <Text key={key}>
          {index > 0 ? <Text dimColor>{"  ·  "}</Text> : " "}
          <Text bold color="cyan">
            {key}
          </Text>
          <Text dimColor> {label}</Text>
        </Text>
      ))}
    </Text>
  );
}

function PlanReview({ plan }: { readonly plan: Plan }) {
  return (
    <Box flexDirection="column">
      <Header inventory={[]} />
      <Rule />
      <Text>
        {" "}
        <Text bold>Plan review</Text>
        {"  "}
        <Text dimColor>{plan.id.slice(0, 21)}…</Text>
      </Text>
      <Box
        borderStyle="round"
        borderColor="cyan"
        flexDirection="column"
        paddingX={1}
        marginX={1}
      >
        {plan.operations.length === 0 ? (
          <Text dimColor>No operations — already in the desired state.</Text>
        ) : (
          plan.operations.map((operation, index) => {
            const parts = operationParts(operation);
            return (
              <Text key={index}>
                <Text bold color={parts.color}>
                  {parts.verb.padEnd(13)}
                </Text>
                <Text>{parts.detail}</Text>
              </Text>
            );
          })
        )}
      </Box>
      {plan.backupRequired.length > 0 ? (
        <Text>
          {" "}
          <Text color="yellow">⚠ backs up first:</Text>{" "}
          <Text dimColor>{plan.backupRequired.join(", ")}</Text>
        </Text>
      ) : null}
      <Rule />
      <KeyBar
        keys={[
          ["y", "apply"],
          ["n", "cancel — no changes"],
        ]}
      />
    </Box>
  );
}

function ResultView({ outcome }: { readonly outcome: ApplyOutcome }) {
  return (
    <Box flexDirection="column">
      <Header inventory={[]} />
      <Rule />
      <Box paddingLeft={1} flexDirection="column">
        <Text bold color={outcome.ok ? "green" : "red"}>
          {outcome.ok ? "✔ Success" : "✖ Failed"}
        </Text>
        <Text>{outcome.message}</Text>
      </Box>
      <Rule />
      <KeyBar keys={[["any key", "back to inventory"]]} />
    </Box>
  );
}

export function App({ core }: { readonly core: TuiCore }) {
  const { exit } = useApp();
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

    if (input === "q") {
      exit();
    } else if (key.downArrow) {
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

  if (view.name === "plan-review") return <PlanReview plan={view.plan} />;
  if (view.name === "result") return <ResultView outcome={view.outcome} />;

  const row = inventory[selected];

  return (
    <Box flexDirection="column">
      <Header inventory={inventory} />
      <Rule />
      <InventoryTable inventory={inventory} selected={selected} />
      <Rule />
      {row ? <DetailPanel row={row} /> : <Text dimColor> no skills found</Text>}
      {notice !== null ? (
        <Text>
          {" "}
          <Text color="red">✖ {notice}</Text>
        </Text>
      ) : null}
      <Rule />
      <KeyBar
        keys={[
          ["↑↓", "navigate"],
          ["l", "link"],
          ["q", "quit"],
        ]}
      />
    </Box>
  );
}
