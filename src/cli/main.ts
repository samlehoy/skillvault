import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runDoctor, type DoctorReport } from "../headless/doctor.js";

/**
 * CLI entry: `skillvault` opens the TUI; `skillvault doctor [--json]` runs
 * read-only diagnostics. The bin shim calls run() and sets the exit code.
 */

function printDoctorReport(report: DoctorReport): void {
  for (const check of report.checks) {
    console.log(`${check.status.toUpperCase().padEnd(4)} ${check.id}: ${check.detail}`);
  }
  console.log(report.ok ? "\ndoctor: OK" : "\ndoctor: FAILED");
}

async function runTui(): Promise<number> {
  const [{ render }, { createElement }, { App }, { createTuiCore }] =
    await Promise.all([
      import("ink"),
      import("react"),
      import("../tui/app.js"),
      import("../app/core.js"),
    ]);
  const core = createTuiCore({
    homeDir: os.homedir(),
    projectDir: process.cwd(),
  });
  const instance = render(createElement(App, { core }));
  await instance.waitUntilExit();
  return 0;
}

export async function run(argv: readonly string[]): Promise<number> {
  const [command] = argv;

  if (command === "doctor") {
    const scratchDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "skillvault-doctor-"),
    );
    try {
      const report = runDoctor({
        homeDir: os.homedir(),
        projectDir: process.cwd(),
        scratchDir,
      });
      if (argv.includes("--json")) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printDoctorReport(report);
      }
      return report.ok ? 0 : 1;
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  }

  if (command !== undefined) {
    console.error(
      `Unknown command "${command}". Available: skillvault (TUI), skillvault doctor [--json].`,
    );
    return 2;
  }

  return runTui();
}
