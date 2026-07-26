#!/usr/bin/env node
import { run } from "../dist/cli/main.js";

process.exitCode = await run(process.argv.slice(2));
