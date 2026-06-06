/**
 * unpack-update-set (sn-sdk-next-ui unpack)
 *
 * Splits the single update-set XML produced by
 *   `snc ui-component generate-update-set --offline --no-type-check`
 * back into the individual record files that the internal `tectonic build`
 * would have emitted under `dist/app/{update,scope}/`.
 *
 * This lets developers with only the public `snc ui-component` extension
 * produce the unpacked record tree that `now-sdk build --skip-clean` consumes
 * and merges with the Fluent/server records.
 *
 * Usage:
 *   sn-sdk-next-ui unpack [--in <update-set.xml>] [--out <dir>] [--app-dir <name>]
 *   sn-sdk-next-ui unpack --clean
 *
 *   --in       Path to the update-set XML. Default: newest *.xml in ./.now-cli
 *   --out      Output root. Default: ./dist
 *   --app-dir  App folder name. Default: "app"
 *   --clean    Remove the ./.now-cli directory and exit (no unpacking).
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") args.in = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--app-dir") args.appDir = argv[++i];
    else if (a === "--clean") args.clean = true;
    else if (a === "-h" || a === "--help") args.help = true;
  }
  return args;
}

function findUpdateSet(nowCliDir) {
  if (!existsSync(nowCliDir)) return null;
  const xmls = readdirSync(nowCliDir)
    .filter((f) => f.endsWith(".xml"))
    .map((f) => join(nowCliDir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return xmls[0] ?? null;
}

/**
 * Reverse ServiceNow's CDATA serialization. A payload is one or more adjacent
 * CDATA sections; concatenating their contents correctly un-escapes any inner
 * "]]>" (which SN splits as "]]]]><![CDATA[>").
 */
function unwrapPayload(raw) {
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  const parts = [];
  let m;
  while ((m = re.exec(raw)) !== null) parts.push(m[1]);
  return parts.length ? parts.join("") : raw.trim();
}

export function unpack({ inPath, outRoot, appDir }) {
  const xml = readFileSync(inPath, "utf8");
  const blocks =
    xml.match(/<sys_update_xml\b[\s\S]*?<\/sys_update_xml>/g) ?? [];
  if (blocks.length === 0)
    throw new Error(`No <sys_update_xml> records found in ${inPath}`);

  const appRoot = join(outRoot, appDir);
  let written = 0;
  const byDir = {};

  for (const block of blocks) {
    const name = (block.match(/<name>([^<]+)<\/name>/) || [])[1];
    if (!name) {
      console.warn("  ! skipping a record with no <name>");
      continue;
    }
    const payloadRaw = (block.match(/<payload>([\s\S]*?)<\/payload>/) || [])[1];
    if (payloadRaw == null) {
      console.warn(`  ! ${name}: no <payload>, skipping`);
      continue;
    }
    const content = unwrapPayload(payloadRaw);

    // sys_app -> scope/, everything else -> update/
    const subDir =
      name.startsWith("sys_app_") || name === "sys_app" ? "scope" : "update";
    const destDir = join(appRoot, subDir);
    mkdirSync(destDir, { recursive: true });

    // Write the payload verbatim — it is exactly the record file content the
    // build emitted (no trailing newline added).
    writeFileSync(join(destDir, `${name}.xml`), content);
    written++;
    byDir[subDir] = (byDir[subDir] || 0) + 1;
  }

  return { written, byDir, appRoot };
}

// Entry point for `sn-sdk-next-ui unpack <args>`.
export function runUnpackCli(argv) {
  const cwd = process.cwd();
  const nowCliDir = join(cwd, ".now-cli");
  const args = parseArgs(argv);

  if (args.help) {
    console.log(
      `sn-sdk-next-ui unpack — split an snc update-set XML into SDK record files

  --in <path>      Update-set XML. Default: newest *.xml in ./.now-cli
  --out <dir>      Output root. Default: ./dist
  --app-dir <name> App folder name. Default: "app"
  --clean          Remove ./.now-cli and exit (no unpacking).`,
    );
    return;
  }

  if (args.clean) {
    // Idempotent: `force` swallows the missing-directory case.
    rmSync(nowCliDir, { recursive: true, force: true });
    console.log(`Removed ${nowCliDir}`);
    return;
  }

  const found = findUpdateSet(nowCliDir);
  if (!args.in && !found) {
    console.error(
      "No update-set XML found in ./.now-cli. Run:\n  snc ui-component generate-update-set --offline --no-type-check\nor pass --in <path>.",
    );
    process.exit(1);
  }
  const inPath = resolve(cwd, args.in ?? found);
  if (!existsSync(inPath)) {
    console.error(`Update-set XML not found: ${inPath}`);
    process.exit(1);
  }

  const appDir = args.appDir ?? "app";
  const outRoot = resolve(cwd, args.out ?? "dist");

  console.log(`Unpacking ${inPath}`);
  console.log(`  -> ${join(outRoot, appDir)}/{update,scope}`);
  const { written, byDir, appRoot } = unpack({ inPath, outRoot, appDir });
  console.log(
    `Done: ${written} record(s) written ` +
      Object.entries(byDir)
        .map(([d, n]) => `(${d}: ${n})`)
        .join(" "),
  );
  console.log(`Records are under ${appRoot}`);
}
