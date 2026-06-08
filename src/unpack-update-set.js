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
 * When some assets don't exist locally, generate-update-set must run WITHOUT
 * `--offline` (e.g. with `--fetch-assets-from-instance`). In that mode
 * validateSysApp emits a sys_app record using the instance's scope sys_id while
 * the original locally-generated record remains, producing two `sys_app_*.xml`
 * files, and every other record points at the stale id via <sys_scope>/
 * <sys_package>. Unpack drops the stale sys_app, keeps the record whose sys_id
 * matches `scopeSysId` in now-ui.json, and rewrites the stale id everywhere else
 * (see cleanupDuplicateSysApp).
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

/**
 * Read the instance-corrected scope sys_id from now-ui.json.
 *
 * When `snc ui-component generate-update-set` runs WITHOUT `--offline` (e.g. with
 * `--fetch-assets-from-instance`), validateSysApp queries the connected instance
 * and writes the real scope sys_id back into now-ui.json's `scopeSysId`. That is
 * the authoritative id for the app's sys_app record.
 */
function readScopeSysId(cwd) {
  const p = join(cwd, "now-ui.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")).scopeSysId ?? null;
  } catch {
    return null;
  }
}

/** Recursively collect every .xml file path under `dir`. */
function collectXmlFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...collectXmlFiles(p));
    else if (entry.endsWith(".xml")) out.push(p);
  }
  return out;
}

/**
 * Remove the duplicate sys_app record and rewrite its stale scope sys_id.
 *
 * Without `--offline`, validateSysApp emits a sys_app record using the instance's
 * scope sys_id while the original locally-generated record (with a different,
 * stale sys_id) also remains. This leaves two `sys_app_*.xml` files, and every
 * other record still points at the stale id via <sys_scope>/<sys_package>.
 *
 * Keep only `sys_app_<scopeSysId>.xml` (matching now-ui.json), delete the stale
 * sys_app record(s), then replace the stale sys_id with `scopeSysId` everywhere
 * under the app root so all records reference the instance scope.
 *
 * Guarded: if the expected `sys_app_<scopeSysId>.xml` isn't present we can't be
 * sure which record is canonical, so we leave everything untouched.
 *
 * Returns { removed, rewritten } — the deleted sys_app filenames and the count
 * of other files whose references were updated.
 */
function cleanupDuplicateSysApp(appRoot, scopeSysId) {
  const empty = { removed: [], rewritten: 0 };
  const scopeDir = join(appRoot, "scope");
  if (!scopeSysId || !existsSync(scopeDir)) return empty;

  const wanted = `sys_app_${scopeSysId}.xml`;
  const sysAppFiles = readdirSync(scopeDir).filter(
    (f) =>
      f.endsWith(".xml") && (f.startsWith("sys_app_") || f === "sys_app.xml"),
  );
  if (sysAppFiles.length <= 1 || !sysAppFiles.includes(wanted)) return empty;

  // Stale sys_ids are the sys_app filenames we're dropping (sans prefix/suffix).
  const removed = [];
  const staleIds = [];
  for (const f of sysAppFiles) {
    if (f === wanted) continue;
    rmSync(join(scopeDir, f));
    removed.push(f);
    const id = f.slice("sys_app_".length, -".xml".length);
    if (id) staleIds.push(id);
  }
  if (staleIds.length === 0) return { removed, rewritten: 0 };

  // Repoint every remaining record's <sys_scope>/<sys_package> at the instance id.
  let rewritten = 0;
  for (const file of collectXmlFiles(appRoot)) {
    const before = readFileSync(file, "utf8");
    let after = before;
    for (const stale of staleIds) after = after.split(stale).join(scopeSysId);
    if (after !== before) {
      writeFileSync(file, after);
      rewritten++;
    }
  }
  return { removed, rewritten };
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

export function unpack({ inPath, outRoot, appDir, scopeSysId = null }) {
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

  // Drop the stale duplicate sys_app record (and repoint references to the
  // instance scope) left behind when generate-update-set runs without --offline.
  const { removed, rewritten } = cleanupDuplicateSysApp(appRoot, scopeSysId);
  if (removed.length) {
    written -= removed.length;
    byDir.scope = (byDir.scope || 0) - removed.length;
  }

  return { written, byDir, appRoot, removed, rewritten };
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

  const scopeSysId = readScopeSysId(cwd);

  console.log(`Unpacking ${inPath}`);
  console.log(`  -> ${join(outRoot, appDir)}/{update,scope}`);
  const { written, byDir, appRoot, removed, rewritten } = unpack({
    inPath,
    outRoot,
    appDir,
    scopeSysId,
  });
  if (removed.length) {
    console.log(
      `  ~ removed ${removed.length} duplicate sys_app record(s): ${removed.join(", ")}`,
    );
    console.log(
      `  ~ repointed scope references to ${scopeSysId} in ${rewritten} file(s)`,
    );
  }
  console.log(
    `Done: ${written} record(s) written ` +
      Object.entries(byDir)
        .map(([d, n]) => `(${d}: ${n})`)
        .join(" "),
  );
  console.log(`Records are under ${appRoot}`);
}
