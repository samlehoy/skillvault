import { Box, Text, useApp, useInput } from "ink";
import { useMemo, useState } from "react";
import type {
  AggregatedSkillView,
  ApplyOutcome,
  ContentCheck,
  Health,
  LocationKey,
  TuiCore,
} from "../app/core.js";
import type { Plan } from "../core/plan.js";

/**
 * Skill-first inventory TUI (docs/TUI_FLOW.md). Components never touch the
 * filesystem or compute paths: every capability arrives through the injected
 * {@link TuiCore} facade, so cancelling a plan review provably performs no
 * mutation — the facade is simply never called.
 */

export type { AggregatedSkillView, ApplyOutcome, Health, TuiCore } from "../app/core.js";

const HEALTH_STYLE: Record<
  Health,
  { color: string; symbol: string; meaning: string }
> = {
  managed: {
    color: "green",
    symbol: "●",
    meaning: "linked into the SkillVault vault",
  },
  external: {
    color: "yellow",
    symbol: "◆",
    meaning: "link owned by another tool (e.g. npx skills)",
  },
  broken: {
    color: "red",
    symbol: "✖",
    meaning: "link whose target no longer exists",
  },
  unmanaged: {
    color: "cyan",
    symbol: "○",
    meaning: "plain folder, not yet managed — press Enter to manage",
  },
};

const LOCATION_KEYS: readonly LocationKey[] = [
  "opencode",
  "antigravity",
  "antigravity-ide",
  "claude-external",
  "agents-external",
];
const LOCATION_LABEL: Record<LocationKey, string> = {
  opencode: "opencode",
  antigravity: "antigrav",
  "antigravity-ide": "antigrav-ide",
  "claude-external": "claude",
  "agents-external": "agents",
};
const LOCATION_CODE: Record<LocationKey, string> = {
  opencode: "oc",
  antigravity: "av",
  "antigravity-ide": "ai",
  "claude-external": "cl",
  "agents-external": "ag",
};

const VISIBLE_ROWS = 12;

interface PanelEntry {
  readonly kind: "existing" | "create";
  readonly key: LocationKey;
  readonly path: string;
  readonly checked: boolean;
}

type ConflictOptions = Extract<ContentCheck, { identical: false }>["options"];

type View =
  | { readonly name: "inventory" }
  | {
      readonly name: "action";
      readonly skill: AggregatedSkillView;
      readonly entries: readonly PanelEntry[];
      readonly cursor: number;
      readonly canonicalPath?: string;
      readonly notice?: string;
    }
  | {
      readonly name: "pick";
      readonly skill: AggregatedSkillView;
      readonly options: ConflictOptions;
      readonly cursor: number;
    }
  | { readonly name: "plan"; readonly plan: Plan }
  | { readonly name: "result"; readonly outcome: ApplyOutcome }
  | { readonly name: "help" };

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

function Header({
  total,
  filterIndex,
}: {
  readonly total?: number;
  readonly filterIndex?: number;
}) {
  return (
    <Box justifyContent="space-between">
      <Text>
        <Text bold color="magenta">
          {" ⬢ SkillVault "}
        </Text>
        {total !== undefined ? <Text dimColor>· {total} skills</Text> : null}
      </Text>
      {filterIndex !== undefined ? (
        <Text>
          <Text inverse={filterIndex === 0}>[a All]</Text>
          {LOCATION_KEYS.map((key, index) => (
            <Text key={key} inverse={filterIndex === index + 1}>
              {` [${index + 1} ${LOCATION_LABEL[key]}]`}
            </Text>
          ))}
        </Text>
      ) : null}
    </Box>
  );
}

function Legend({ inventory }: { readonly inventory: readonly AggregatedSkillView[] }) {
  const counts = useMemo(() => {
    const byHealth: Partial<Record<Health, number>> = {};
    for (const row of inventory) {
      byHealth[row.health] = (byHealth[row.health] ?? 0) + 1;
    }
    return byHealth;
  }, [inventory]);

  return (
    <Box flexDirection="column" paddingLeft={1}>
      {(Object.keys(HEALTH_STYLE) as Health[]).map((health) => {
        const style = HEALTH_STYLE[health];
        const count = counts[health] ?? 0;
        return (
          <Text key={health} dimColor={count === 0}>
            <Text {...(count > 0 ? { color: style.color } : {})}>
              {style.symbol} {String(count).padStart(3)}
            </Text>
            <Text bold={count > 0}>{` ${health.padEnd(10)}`}</Text>
            <Text dimColor>{style.meaning}</Text>
          </Text>
        );
      })}
    </Box>
  );
}

function Rule() {
  return <Text dimColor>{"─".repeat(78)}</Text>;
}

function matrixFor(skill: AggregatedSkillView): string {
  return LOCATION_KEYS.map(
    (key) => `${LOCATION_CODE[key]}${skill.targets[key] ? "✓" : "–"}`,
  ).join(" ");
}

function InventoryTable({
  rows,
  selected,
}: {
  readonly rows: readonly AggregatedSkillView[];
  readonly selected: number;
}) {
  const start = Math.max(
    0,
    Math.min(selected - Math.floor(VISIBLE_ROWS / 2), rows.length - VISIBLE_ROWS),
  );
  const end = Math.min(rows.length, start + VISIBLE_ROWS);
  const window = rows.slice(start, end);

  return (
    <Box flexDirection="column">
      {start > 0 ? <Text dimColor>{`   ↑ ${start} more`}</Text> : null}
      {window.map((row, offset) => {
        const index = start + offset;
        const isSelected = index === selected;
        const style = HEALTH_STYLE[row.health];
        const copies =
          row.locations.length > 1 ? `${row.locations.length} copies` : "";
        const cells = `${style.symbol} ${row.id.padEnd(28)} ${matrixFor(row)}   ${copies}`;
        return isSelected ? (
          <Text key={row.id} inverse bold>
            {`❯ ${cells}`}
          </Text>
        ) : (
          <Text key={row.id}>
            {"  "}
            <Text color={style.color}>{`${style.symbol} `}</Text>
            <Text>{`${row.id.padEnd(28)} `}</Text>
            <Text dimColor>{`${matrixFor(row)}   ${copies}`}</Text>
          </Text>
        );
      })}
      {end < rows.length ? (
        <Text dimColor>{`   ↓ ${rows.length - end} more`}</Text>
      ) : null}
    </Box>
  );
}

function DetailPanel({ skill }: { readonly skill: AggregatedSkillView }) {
  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text>
        <Text bold>{skill.id}</Text>
        {" — found in "}
        {skill.locations.length} location{skill.locations.length === 1 ? "" : "s"}:
      </Text>
      {skill.locations.map((location) => (
        <Text key={location.path}>
          {"  "}
          <Text color={HEALTH_STYLE[location.health].color}>
            {LOCATION_LABEL[location.key].padEnd(9)}
          </Text>
          <Text>{location.path}</Text>
          <Text dimColor>
            {"  ("}
            {location.entryKind === "junction"
              ? "junction"
              : location.key === "agents-external"
                ? "store"
                : "copy"}
            {")"}
          </Text>
        </Text>
      ))}
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

const HELP_LINES: readonly (readonly [string, string])[] = [
  ["↑ ↓", "move selection"],
  ["Enter", "open the action panel for the selected skill"],
  ["/", "incremental search (Esc clears)"],
  ["a, 1-5", "filter by target"],
  ["space", "toggle a target checkbox (action panel)"],
  ["m", "build the consolidated plan (action panel)"],
  ["y / n", "apply / cancel in plan review — cancel changes nothing"],
  ["Esc", "back one level"],
  ["q", "quit (from the inventory only)"],
];

export function App({ core }: { readonly core: TuiCore }) {
  const { exit } = useApp();
  const [refresh, setRefresh] = useState(0);
  const inventory = useMemo(() => core.loadInventory(), [core, refresh]);
  const [selectedRaw, setSelected] = useState(0);
  const [view, setView] = useState<View>({ name: "inventory" });
  const [filterIndex, setFilterIndex] = useState(0);
  const [search, setSearch] = useState({ active: false, text: "" });
  const [notice, setNotice] = useState<string | null>(null);

  const rows = useMemo(() => {
    const filterKey =
      filterIndex > 0 ? LOCATION_KEYS[filterIndex - 1] : undefined;
    return inventory.filter(
      (row) =>
        (filterKey === undefined || row.targets[filterKey]) &&
        (search.text === "" || row.id.includes(search.text)),
    );
  }, [inventory, filterIndex, search.text]);
  const selected = Math.min(selectedRaw, Math.max(0, rows.length - 1));

  const openActionPanel = (
    skill: AggregatedSkillView,
    canonicalPath?: string,
  ): void => {
    const entries: PanelEntry[] = [
      ...skill.locations.map((location) => ({
        kind: "existing" as const,
        key: location.key,
        path: location.path,
        checked: true,
      })),
      ...core.creatableTargets(skill.id).map((target) => ({
        kind: "create" as const,
        key: target.key,
        path: target.path,
        checked: false,
      })),
    ];
    setView({
      name: "action",
      skill,
      entries,
      cursor: 0,
      ...(canonicalPath !== undefined ? { canonicalPath } : {}),
    });
  };

  useInput((input, key) => {
    if (view.name === "help") {
      setView({ name: "inventory" });
      return;
    }

    if (view.name === "pick") {
      if (key.downArrow) {
        setView({
          ...view,
          cursor: Math.min(view.cursor + 1, view.options.length - 1),
        });
      } else if (key.upArrow) {
        setView({ ...view, cursor: Math.max(view.cursor - 1, 0) });
      } else if (key.return) {
        const option = view.options[view.cursor];
        if (option) openActionPanel(view.skill, option.path);
      } else if (key.escape) {
        setView({ name: "inventory" });
      }
      return;
    }

    if (view.name === "action") {
      if (key.downArrow) {
        setView({
          ...view,
          cursor: Math.min(view.cursor + 1, view.entries.length - 1),
        });
      } else if (key.upArrow) {
        setView({ ...view, cursor: Math.max(view.cursor - 1, 0) });
      } else if (input === " ") {
        setView({
          ...view,
          entries: view.entries.map((entry, index) =>
            index === view.cursor
              ? { ...entry, checked: !entry.checked }
              : entry,
          ),
        });
      } else if (input === "m") {
        const outcome = core.buildManagePlan({
          id: view.skill.id,
          paths: view.entries
            .filter((entry) => entry.kind === "existing" && entry.checked)
            .map((entry) => entry.path),
          createKeys: view.entries
            .filter((entry) => entry.kind === "create" && entry.checked)
            .map((entry) => entry.key),
          ...(view.canonicalPath !== undefined
            ? { canonicalPath: view.canonicalPath }
            : {}),
        });
        if (outcome.ok) {
          setView({ name: "plan", plan: outcome.plan });
        } else if (outcome.code === "conflict") {
          setView({
            name: "pick",
            skill: view.skill,
            options: outcome.options,
            cursor: 0,
          });
        } else {
          setView({ ...view, notice: outcome.message });
        }
      } else if (key.escape) {
        setView({ name: "inventory" });
      }
      return;
    }

    if (view.name === "plan") {
      if (input === "y") {
        setView({ name: "result", outcome: core.applyPlan(view.plan) });
      } else if (input === "n" || key.escape) {
        setView({ name: "inventory" });
      }
      return;
    }

    if (view.name === "result") {
      setRefresh((n) => n + 1);
      setView({ name: "inventory" });
      return;
    }

    // inventory
    if (search.active) {
      if (key.escape) {
        setSearch({ active: false, text: "" });
      } else if (key.return) {
        setSearch((s) => ({ ...s, active: false }));
      } else if (key.backspace || key.delete) {
        setSearch((s) => ({ ...s, text: s.text.slice(0, -1) }));
      } else if (input && !key.ctrl && !key.meta) {
        setSearch((s) => ({ ...s, text: s.text + input }));
      }
      return;
    }

    if (input === "q") {
      exit();
    } else if (input === "?") {
      setView({ name: "help" });
    } else if (input === "/") {
      setSearch({ active: true, text: "" });
    } else if (input === "a") {
      setFilterIndex(0);
    } else if (/^[1-9]$/.test(input)) {
      const index = Number(input);
      if (index <= LOCATION_KEYS.length) setFilterIndex(index);
    } else if (key.downArrow) {
      setSelected((current) => Math.min(current + 1, Math.max(0, rows.length - 1)));
      setNotice(null);
    } else if (key.upArrow) {
      setSelected((current) => Math.max(current - 1, 0));
      setNotice(null);
    } else if (key.escape && search.text !== "") {
      setSearch({ active: false, text: "" });
    } else if (key.return) {
      const row = rows[selected];
      if (!row) return;
      const check = core.checkContent(row.id);
      if (check.identical) {
        openActionPanel(row);
      } else {
        setView({ name: "pick", skill: row, options: check.options, cursor: 0 });
      }
    }
  });

  if (view.name === "help") {
    return (
      <Box flexDirection="column">
        <Header />
        <Rule />
        <Text bold> Keys</Text>
        {HELP_LINES.map(([keys, meaning]) => (
          <Text key={keys}>
            {"  "}
            <Text bold color="cyan">
              {keys.padEnd(8)}
            </Text>
            <Text dimColor>{meaning}</Text>
          </Text>
        ))}
        <Rule />
        <KeyBar keys={[["any key", "close help"]]} />
      </Box>
    );
  }

  if (view.name === "pick") {
    return (
      <Box flexDirection="column">
        <Header />
        <Rule />
        <Text>
          {" "}
          <Text bold>{view.skill.id}</Text>
          {"  "}
          <Text color="yellow">
            ⚠ {view.options.length} copies with DIFFERENT content — pick the
            canonical one
          </Text>
        </Text>
        <Box flexDirection="column" paddingLeft={1}>
          {view.options.map((option, index) => {
            const line = `${LOCATION_LABEL[option.key].padEnd(9)} ${option.path}  sha:${option.hashShort}`;
            return index === view.cursor ? (
              <Text key={option.path} inverse bold>{`❯ ${line}`}</Text>
            ) : (
              <Text key={option.path}>{`  ${line}`}</Text>
            );
          })}
        </Box>
        <Text dimColor>
          {" "}
          The chosen copy becomes the vault content; the others are backed up
          and replaced by junctions when you apply the plan.
        </Text>
        <Rule />
        <KeyBar
          keys={[
            ["↑↓", "select"],
            ["Enter", "choose"],
            ["Esc", "back"],
          ]}
        />
      </Box>
    );
  }

  if (view.name === "action") {
    return (
      <Box flexDirection="column">
        <Header />
        <Rule />
        <Text>
          {" "}
          <Text bold>{view.skill.id}</Text>
          {"   "}
          <Text dimColor>
            {view.skill.locations.length} location
            {view.skill.locations.length === 1 ? "" : "s"}
            {view.canonicalPath !== undefined
              ? ` · canonical: ${view.canonicalPath}`
              : " · content identical"}
          </Text>
        </Text>
        <Text bold> Manage in which targets?</Text>
        <Box flexDirection="column" paddingLeft={1}>
          {view.entries.map((entry, index) => {
            const box = entry.checked ? "[x]" : "[ ]";
            const note =
              entry.kind === "create" ? "  (will be created)" : "";
            const line = `${box} ${LOCATION_LABEL[entry.key].padEnd(9)} ${entry.path}${note}`;
            return index === view.cursor ? (
              <Text key={entry.path} inverse bold>{`❯ ${line}`}</Text>
            ) : (
              <Text key={entry.path}>{`  ${line}`}</Text>
            );
          })}
        </Box>
        {view.notice !== undefined ? (
          <Text>
            {" "}
            <Text color="red">✖ {view.notice}</Text>
          </Text>
        ) : null}
        <Rule />
        <KeyBar
          keys={[
            ["space", "toggle"],
            ["m", "build plan"],
            ["Esc", "back"],
          ]}
        />
      </Box>
    );
  }

  if (view.name === "plan") {
    const { plan } = view;
    return (
      <Box flexDirection="column">
        <Header />
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
            <Text color="yellow">
              ⚠ backs up first: {plan.backupRequired.length} path(s)
            </Text>
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

  if (view.name === "result") {
    return (
      <Box flexDirection="column">
        <Header />
        <Rule />
        <Box paddingLeft={1} flexDirection="column">
          <Text bold color={view.outcome.ok ? "green" : "red"}>
            {view.outcome.ok ? "✔ Success" : "✖ Failed"}
          </Text>
          <Text>{view.outcome.message}</Text>
        </Box>
        <Rule />
        <KeyBar keys={[["any key", "back to inventory"]]} />
      </Box>
    );
  }

  const row = rows[selected];

  return (
    <Box flexDirection="column">
      <Header total={inventory.length} filterIndex={filterIndex} />
      <Rule />
      <Legend inventory={inventory} />
      <Rule />
      {rows.length === 0 ? (
        <Box flexDirection="column" paddingLeft={1}>
          <Text> No skills found{search.text ? ` for "${search.text}"` : ""}.</Text>
          <Text dimColor>
            {" "}
            SkillVault looked in the OpenCode, Claude Code, and agents-store
            directories. Run `skillvault doctor` for a diagnosis.
          </Text>
        </Box>
      ) : (
        <InventoryTable rows={rows} selected={selected} />
      )}
      <Rule />
      {row ? <DetailPanel skill={row} /> : null}
      {notice !== null ? (
        <Text>
          {" "}
          <Text color="red">✖ {notice}</Text>
        </Text>
      ) : null}
      {search.active || search.text !== "" ? (
        <Text>
          {" "}
          <Text bold color="cyan">
            /
          </Text>
          <Text> {search.text}</Text>
          {search.active ? <Text inverse> </Text> : null}
        </Text>
      ) : null}
      <Rule />
      <KeyBar
        keys={[
          ["↑↓", "select"],
          ["Enter", "manage"],
          ["/", "search"],
          ["a,1-5", "filter"],
          ["?", "help"],
          ["q", "quit"],
        ]}
      />
    </Box>
  );
}
