#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { init, add } from "./lib.js";
import { runUnpackCli } from "./unpack-update-set.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [cmd, ...rest] = process.argv.slice(2);

function printHelp() {
  console.log(`sdk-now-ui — Next Experience UI components inside a ServiceNow SDK project

Usage:
  sdk-now-ui init            Transform the current SDK project into a hybrid
                             SDK + Next Experience project (run once).
  sdk-now-ui add             Add one or more UI components (interactive).
  sdk-now-ui unpack          Split an snc update-set XML into SDK record files.
                             (Used internally by the generated build script.)

Options:
  --plugins <a,b>            Extra plugin specs (package names or paths) to
                             layer on top, in addition to auto-discovered ones.
                             Repeatable and/or comma-separated.
  -h, --help                 Show this help.
  -v, --version              Show the version.

Run 'sdk-now-ui unpack --help' for unpack-specific options.`);
}

async function printVersion() {
  const pkg = JSON.parse(
    await fs.readFile(path.join(__dirname, "..", "package.json"), "utf-8"),
  );
  console.log(pkg.version);
}

switch (cmd) {
  case "init":
    await init({ argv: rest });
    break;
  case "add":
    await add({ argv: rest });
    break;
  case "unpack":
    await runUnpackCli(rest);
    break;
  case "-v":
  case "--version":
    await printVersion();
    break;
  case undefined:
  case "-h":
  case "--help":
    printHelp();
    break;
  default:
    console.error(`Unknown command: ${cmd}\n`);
    printHelp();
    process.exit(1);
}
