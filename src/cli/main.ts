import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAudit, type AuditReport } from "../audit/audit.js";
import { runDoctor, type DoctorReport } from "../headless/doctor.js";

/**
 * CLI entry: `skillvault` opens the TUI; `skillvault doctor [--json]` runs
 * read-only diagnostics; `skillvault audit [--json]` runs the read-only
 * findings audit (exit 1 only on error-severity findings). The bin shim
 * calls run() and sets the exit code.
 */

function printDoctorReport(report: DoctorReport): void {
  for (const check of report.checks) {
    console.log(`${check.status.toUpperCase().padEnd(4)} ${check.id}: ${check.detail}`);
  }
  console.log(report.ok ? "\ndoctor: OK" : "\ndoctor: FAILED");
}

function printAuditReport(report: AuditReport): void {
  if (report.findings.length === 0) {
    console.log("audit: no findings.");
    return;
  }
  for (const finding of report.findings) {
    console.log(
      `${finding.severity.toUpperCase().padEnd(5)} ${finding.id}: ${finding.message}`,
    );
    console.log(`      → ${finding.remediation}`);
  }
  console.log(
    report.ok
      ? `\naudit: OK (${report.findings.length} non-blocking finding(s))`
      : "\naudit: FAILED",
  );
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

  if (command === "audit") {
    const report = runAudit({
      homeDir: os.homedir(),
      projectDir: process.cwd(),
    });
    if (argv.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printAuditReport(report);
    }
    return report.ok ? 0 : 1;
  }

  if (command !== undefined) {
    console.error(
      `Unknown command "${command}". Available: skillvault (TUI), skillvault doctor [--json], skillvault audit [--json].`,
    );
    return 2;
  }

  return runTui();
}
