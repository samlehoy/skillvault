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

type Domain = "skills" | "mcp" | "plugins";
const DOMAINS: readonly Domain[] = ["skills", "mcp", "plugins"];
const DOMAIN_LABEL: Record<Domain, string> = {
  skills: "Skills",
  mcp: "MCP",
  plugins: "Plugins",
};

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
      /** Text of the set-source input while it is open (undefined = closed). */
      readonly sourceInput?: string;
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
  domain,
}: {
  readonly total?: number;
  readonly domain?: Domain;
}) {
  return (
    <Box justifyContent="space-between">
      <Text>
        <Text bold color="magenta">
          {" ⬢ SkillVault "}
        </Text>
        {total !== undefined ? <Text dimColor>· {total} skills</Text> : null}
        {domain !== undefined ? (
          <Text>
            {"   "}
            {DOMAINS.map((d) => (
              <Text key={d}>
                <Text inverse={d === domain} bold={d === domain}>
                  {` ${DOMAIN_LABEL[d]} `}
                </Text>{" "}
              </Text>
            ))}
            <Text dimColor>(Tab)</Text>
          </Text>
        ) : null}
      </Text>
      {total !== undefined || domain !== undefined ? (
        <Text dimColor>? help · q quit </Text>
      ) : null}
    </Box>
  );
}

function TabBar({
  inventory,
  filterIndex,
}: {
  readonly inventory: readonly AggregatedSkillView[];
  readonly filterIndex: number;
}) {
  const countFor = (key: LocationKey): number =>
    inventory.filter((row) => row.targets[key]).length;
  const tabs = [
    { label: "All", count: inventory.length },
    ...LOCATION_KEYS.map((key) => ({
      label: LOCATION_LABEL[key],
      count: countFor(key),
    })),
  ];
  return (
    <Text>
      {tabs.map((tab, index) => (
        <Text key={tab.label}>
          {"  "}
          <Text inverse={index === filterIndex} bold={index === filterIndex}>
            {` ${tab.label} (${tab.count}) `}
          </Text>
        </Text>
      ))}
    </Text>
  );
}

const SECTION_HINT: Record<Health, string> = {
  managed: "linked into the SkillVault vault",
  external: "links owned by another tool",
  broken: "link target is missing",
  unmanaged: "not yet managed — press Enter to manage",
};

function Rule() {
  return <Text dimColor>{"─".repeat(78)}</Text>;
}

function summaryFor(skill: AggregatedSkillView): string {
  const targetCount = LOCATION_KEYS.filter((key) => skill.targets[key]).length;
  const copies = skill.locations.length;
  return `${targetCount} IDE${copies > 1 ? ` · ${copies} copies` : ""}`;
}

export type Grouping = "status" | "bundle";

const UNKNOWN_BUNDLE = "(unknown source)";

type DisplayLine =
  | {
      readonly type: "header";
      readonly key: string;
      readonly symbol: string;
      readonly color: string;
      readonly title: string;
      readonly hint: string;
      readonly count: number;
    }
  | { readonly type: "gap" }
  | { readonly type: "row"; readonly row: AggregatedSkillView; readonly rowIndex: number };

const bundleKeyOf = (row: AggregatedSkillView): string =>
  row.bundle ?? UNKNOWN_BUNDLE;

function InventoryTable({
  rows,
  selected,
  grouping,
}: {
  readonly rows: readonly AggregatedSkillView[];
  readonly selected: number;
  readonly grouping: Grouping;
}) {
  const lines: DisplayLine[] = [];
  let previousKey: string | null = null;
  rows.forEach((row, rowIndex) => {
    const sectionKey = grouping === "status" ? row.health : bundleKeyOf(row);
    if (sectionKey !== previousKey) {
      if (previousKey !== null) lines.push({ type: "gap" });
      if (grouping === "status") {
        const style = HEALTH_STYLE[row.health];
        lines.push({
          type: "header",
          key: sectionKey,
          symbol: style.symbol,
          color: style.color,
          title: row.health.toUpperCase(),
          hint: SECTION_HINT[row.health],
          count: rows.filter((r) => r.health === row.health).length,
        });
      } else {
        lines.push({
          type: "header",
          key: sectionKey,
          symbol: "▣",
          color: row.bundle !== undefined ? "magenta" : "white",
          title: sectionKey,
          hint:
            row.bundle !== undefined
              ? "installed from this source repository"
              : "no installer lockfile mentions these skills",
          count: rows.filter((r) => bundleKeyOf(r) === sectionKey).length,
        });
      }
      previousKey = sectionKey;
    }
    lines.push({ type: "row", row, rowIndex });
  });

  const selectedLine = lines.findIndex(
    (line) => line.type === "row" && line.rowIndex === selected,
  );
  const start = Math.max(
    0,
    Math.min(selectedLine - Math.floor(VISIBLE_ROWS / 2), lines.length - VISIBLE_ROWS),
  );
  const end = Math.min(lines.length, start + VISIBLE_ROWS);

  return (
    <Box flexDirection="column">
      {start > 0 ? <Text dimColor>{`   ↑ ${start} more`}</Text> : null}
      {lines.slice(start, end).map((line, offset) => {
        if (line.type === "gap") return <Text key={`gap-${offset}`}> </Text>;
        if (line.type === "header") {
          return (
            <Text key={`header-${line.key}`}>
              {" "}
              <Text bold color={line.color}>
                {line.symbol} {line.title} ({line.count})
              </Text>
              <Text dimColor> — {line.hint}</Text>
            </Text>
          );
        }
        const { row, rowIndex } = line;
        const style = HEALTH_STYLE[row.health];
        const cells = `${style.symbol} ${row.id.padEnd(28)} ${summaryFor(row)}`;
        return rowIndex === selected ? (
          <Text key={row.id} inverse bold>
            {`❯ ${cells}`}
          </Text>
        ) : (
          <Text key={row.id}>
            {"  "}
            <Text color={style.color}>{`${style.symbol} `}</Text>
            <Text>{`${row.id.padEnd(28)} `}</Text>
            <Text dimColor>{summaryFor(row)}</Text>
          </Text>
        );
      })}
      {end < lines.length ? (
        <Text dimColor>{`   ↓ ${lines.length - end} more`}</Text>
      ) : null}
    </Box>
  );
}

function DetailPanel({
  skill,
  bundleCount,
}: {
  readonly skill: AggregatedSkillView;
  readonly bundleCount: number;
}) {
  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text>
        <Text bold>{skill.id}</Text>
        {" · in: "}
        <Text color="cyan">
          {LOCATION_KEYS.filter((key) => skill.targets[key])
            .map((key) => LOCATION_LABEL[key])
            .join(", ")}
        </Text>
        {" — "}
        {skill.locations.length} location{skill.locations.length === 1 ? "" : "s"}:
      </Text>
      {skill.bundle !== undefined ? (
        <Text>
          {"  "}
          <Text color="magenta">▣ part of {skill.bundle}</Text>
          <Text dimColor>
            {" — "}
            {bundleCount} skill{bundleCount === 1 ? "" : "s"} in this bundle
          </Text>
        </Text>
      ) : null}
      {skill.locations.map((location) => (
        <Text key={location.path}>
          {"  "}
          <Text color={HEALTH_STYLE[location.health].color}>
            {`${LOCATION_LABEL[location.key].padEnd(13)} `}
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
  ["●", "managed — linked into the SkillVault vault"],
  ["◆", "external — link owned by another tool (e.g. npx skills)"],
  ["✖", "broken — link whose target no longer exists"],
  ["○", "unmanaged — plain folder, not yet managed"],
  ["↑ ↓", "move selection"],
  ["← →", "switch target tab"],
  ["Tab", "switch domain: Skills / MCP / Plugins (read-only)"],
  ["Enter", "open the action panel for the selected skill"],
  ["/", "incremental search (Esc clears)"],
  ["a, 1-5", "filter by target"],
  ["g", "group by status / by bundle (source repository)"],
  ["space", "toggle a target checkbox (action panel)"],
  ["m", "build the consolidated plan (action panel)"],
  ["s", "set/correct the source repo — user-verified (action panel)"],
  ["y / n", "apply / cancel in plan review — cancel changes nothing"],
  ["Esc", "back one level"],
  ["q", "quit (from the inventory only)"],
];

export function App({ core }: { readonly core: TuiCore }) {
  const { exit } = useApp();
  const [refresh, setRefresh] = useState(0);
  const inventory = useMemo(() => core.loadInventory(), [core, refresh]);
  const interrupted = useMemo(
    () => core.interruptedTransactions(),
    [core, refresh],
  );
  const nothingManagedYet =
    inventory.length > 0 &&
    !inventory.some((r) => r.locations.some((l) => l.health === "managed"));
  const [selectedRaw, setSelected] = useState(0);
  const [view, setView] = useState<View>({ name: "inventory" });
  const [filterIndex, setFilterIndex] = useState(0);
  const [grouping, setGrouping] = useState<Grouping>("status");
  const [domain, setDomain] = useState<Domain>("skills");
  const mcp = useMemo(() => core.mcpInventory(), [core, refresh]);
  const plugins = useMemo(() => core.pluginInventory(), [core, refresh]);
  const [search, setSearch] = useState({ active: false, text: "" });
  const [notice, setNotice] = useState<string | null>(null);

  const rows = useMemo(() => {
    const filterKey =
      filterIndex > 0 ? LOCATION_KEYS[filterIndex - 1] : undefined;
    const filtered = inventory.filter(
      (row) =>
        (filterKey === undefined || row.targets[filterKey]) &&
        (search.text === "" || row.id.includes(search.text)),
    );
    if (grouping === "status") return filtered;
    // Bundle grouping: labelled bundles alphabetically, unlabelled skills
    // last; the stable sort keeps the severity-then-id order within each
    // bundle section.
    return [...filtered].sort((a, b) => {
      if (a.bundle === undefined && b.bundle === undefined) return 0;
      if (a.bundle === undefined) return 1;
      if (b.bundle === undefined) return -1;
      return a.bundle.localeCompare(b.bundle);
    });
  }, [inventory, filterIndex, search.text, grouping]);
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
      if (view.sourceInput !== undefined) {
        if (key.escape) {
          const { sourceInput: _closed, ...rest } = view;
          setView(rest);
        } else if (key.return) {
          const outcome = core.assignSource(view.skill.id, view.sourceInput);
          if (outcome.ok) {
            setRefresh((n) => n + 1);
            setView({ name: "inventory" });
          } else {
            setView({ ...view, notice: outcome.message });
          }
        } else if (key.backspace || key.delete) {
          setView({ ...view, sourceInput: view.sourceInput.slice(0, -1) });
        } else if (input && !key.ctrl && !key.meta) {
          setView({ ...view, sourceInput: view.sourceInput + input });
        }
        return;
      }
      if (input === "s") {
        setView({ ...view, sourceInput: "" });
      } else if (key.downArrow) {
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

    if (key.tab) {
      setDomain(
        (current) =>
          DOMAINS[(DOMAINS.indexOf(current) + 1) % DOMAINS.length] ?? "skills",
      );
      return;
    }
    if (domain !== "skills") {
      // MCP and Plugins tabs are read-only inventories: no selection, no
      // actions (ADR-0007).
      if (input === "q") exit();
      else if (input === "?") setView({ name: "help" });
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
    } else if (input === "g") {
      setGrouping((current) => (current === "status" ? "bundle" : "status"));
    } else if (key.rightArrow) {
      setFilterIndex((current) => (current + 1) % (LOCATION_KEYS.length + 1));
    } else if (key.leftArrow) {
      setFilterIndex(
        (current) =>
          (current + LOCATION_KEYS.length) % (LOCATION_KEYS.length + 1),
      );
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
    const bundleSize =
      view.skill.bundle !== undefined
        ? inventory.filter((r) => r.bundle === view.skill.bundle).length
        : 0;
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
        {view.skill.bundle !== undefined ? (
          <Text>
            {" "}
            <Text color="magenta">▣ part of {view.skill.bundle}</Text>
            {view.skill.bundleConfidence !== undefined ? (
              <Text dimColor> ({view.skill.bundleConfidence})</Text>
            ) : null}
            <Text dimColor>
              {" — "}
              {bundleSize} skill{bundleSize === 1 ? "" : "s"} from this bundle
              {" · whole-bundle apply arrives with batch support"}
            </Text>
          </Text>
        ) : null}
        {view.sourceInput !== undefined ? (
          <Text>
            {" "}
            <Text bold color="magenta">
              set source repo:
            </Text>
            <Text> {view.sourceInput}</Text>
            <Text inverse> </Text>
            <Text dimColor>
              {"  (owner/repo or URL · Enter save · Esc cancel)"}
            </Text>
          </Text>
        ) : null}
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
            ["s", "set source"],
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

  if (domain === "mcp") {
    return (
      <Box flexDirection="column">
        <Header domain="mcp" />
        <Rule />
        {mcp.servers.length === 0 ? (
          <Text> No MCP servers found in the supported IDE configs.</Text>
        ) : (
          <Box flexDirection="column" paddingLeft={1}>
            {mcp.servers.map((server) => (
              <Text key={`${server.ide}:${server.name}`}>
                <Text bold>{server.name.padEnd(20)}</Text>
                <Text color="cyan">{server.ide.padEnd(16)}</Text>
                <Text dimColor>{server.transport.padEnd(8)}</Text>
                <Text>{server.target}</Text>
                {server.enabled === false ? (
                  <Text color="yellow"> (disabled)</Text>
                ) : null}
                {server.secretKeys.length > 0 ? (
                  <Text dimColor> · secrets: {server.secretKeys.join(", ")}</Text>
                ) : null}
              </Text>
            ))}
          </Box>
        )}
        {mcp.findings.map((finding) => (
          <Text key={finding}>
            {" "}
            <Text color="yellow">⚠ {finding}</Text>
          </Text>
        ))}
        {mcp.warnings.map((warning) => (
          <Text key={warning} dimColor>
            {"  "}
            {warning}
          </Text>
        ))}
        <Text dimColor> Read-only inventory — secret values are never shown.</Text>
        <Rule />
        <KeyBar
          keys={[
            ["Tab", "domain"],
            ["?", "help"],
            ["q", "quit"],
          ]}
        />
      </Box>
    );
  }

  if (domain === "plugins") {
    return (
      <Box flexDirection="column">
        <Header domain="plugins" />
        <Rule />
        {plugins.plugins.length === 0 ? (
          <Text> No plugins found in the supported IDE configs.</Text>
        ) : (
          <Box flexDirection="column" paddingLeft={1}>
            {plugins.plugins.map((plugin) => (
              <Text key={`${plugin.ide}:${plugin.name}`}>
                <Text color="cyan">{plugin.ide.padEnd(10)}</Text>
                <Text bold>{plugin.name.padEnd(40)}</Text>
                <Text dimColor>{plugin.detail}</Text>
              </Text>
            ))}
          </Box>
        )}
        {plugins.warnings.map((warning) => (
          <Text key={warning} dimColor>
            {"  "}
            {warning}
          </Text>
        ))}
        <Text dimColor> Read-only inventory — managing plugins is out of MVP scope.</Text>
        <Rule />
        <KeyBar
          keys={[
            ["Tab", "domain"],
            ["?", "help"],
            ["q", "quit"],
          ]}
        />
      </Box>
    );
  }

  const row = rows[selected];

  return (
    <Box flexDirection="column">
      <Header total={inventory.length} domain="skills" />
      <Rule />
      <TabBar inventory={inventory} filterIndex={filterIndex} />
      <Rule />
      {interrupted.length > 0 ? (
        <Text>
          {" "}
          <Text color="red" bold>
            ⚠ {interrupted.length} interrupted transaction
            {interrupted.length === 1 ? "" : "s"} from an earlier run
          </Text>
          <Text dimColor>
            {" — backups are preserved under ~/.skillvault/backups; run"}
            {" skillvault doctor for details"}
          </Text>
        </Text>
      ) : null}
      {nothingManagedYet ? (
        <Text dimColor>
          {" ✦ First run: nothing is managed yet — select a skill and press"}
          {" Enter to bring it under SkillVault. g groups by source repo."}
        </Text>
      ) : null}
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
        <InventoryTable rows={rows} selected={selected} grouping={grouping} />
      )}
      <Rule />
      {row ? (
        <DetailPanel
          skill={row}
          bundleCount={
            row.bundle !== undefined
              ? inventory.filter((r) => r.bundle === row.bundle).length
              : 0
          }
        />
      ) : null}
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
          ["←→", "target"],
          ["g", "group"],
          ["?", "help"],
          ["q", "quit"],
        ]}
      />
    </Box>
  );
}
