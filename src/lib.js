import * as p from "@clack/prompts";
import ejs from "ejs";
import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The base template shipped with this package. Plugins are layered on top.
export const BASE_TEMPLATE_DIR = path.resolve(__dirname, "../template");

// The per-component template lives inside the base tree at this sub-path. `init`
// skips it (it isn't project scaffolding); `add` renders it once per component.
const COMPONENT_SUBPATH = path.join("src", "now-ui", "component");

// package.json fragment that `init` deep-merges into the host project. Not a
// file we copy — it's consumed.
const PACKAGE_MERGE_FILE = "package.merge.json";

// A custom element name: lowercase, starts with a letter, contains a hyphen.
const CUSTOM_ELEMENT_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

// ── Generic helpers ──────────────────────────────────────────────────────────

// Recursively merge `source` into `target`. Plain objects merge key-by-key;
// everything else (scalars, arrays) is replaced by the source value.
export function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    const bothPlainObjects =
      sv &&
      typeof sv === "object" &&
      !Array.isArray(sv) &&
      tv &&
      typeof tv === "object" &&
      !Array.isArray(tv);
    target[key] = bothPlainObjects ? deepMerge({ ...tv }, sv) : sv;
  }
  return target;
}

// Detect which package manager invoked us from npm_config_user_agent.
function detectPackageManager() {
  const ua = process.env.npm_config_user_agent ?? "";
  return ua.startsWith("pnpm")
    ? "pnpm"
    : ua.startsWith("yarn")
      ? "yarn"
      : "npm";
}

// Whether the ServiceNow CLI (snc) is on PATH.
async function checkSncInstalled() {
  try {
    await execa("snc", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf-8"));
}

// Ensure pnpm is allowed to run the given dependencies' build scripts, by
// adding them under `allowBuilds:` in pnpm-workspace.yaml. Without this, pnpm
// (10+) refuses to run those scripts and `install` exits non-zero. The file
// format is simple and known (one `  'pkg': bool` per line), so we edit it
// textually rather than pulling in a YAML dependency.
async function ensureAllowBuilds(cwd, pkgs) {
  const file = path.join(cwd, "pnpm-workspace.yaml");
  if (!(await exists(file))) return; // not a pnpm project; nothing to do
  const content = await fs.readFile(file, "utf-8");
  const lines = content.split("\n");
  const hasSection = lines.some((l) => /^allowBuilds:\s*$/.test(l));

  const present = (pkg) =>
    new RegExp(
      `^\\s+'?${pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'?\\s*:`,
      "m",
    ).test(content);
  const missing = pkgs.filter((pkg) => !present(pkg));
  if (missing.length === 0) return;

  if (!hasSection) {
    const block = [
      "allowBuilds:",
      ...missing.map((p) => `  '${p}': true`),
    ].join("\n");
    const next = content.trim()
      ? content.replace(/\n*$/, "\n") + block + "\n"
      : block + "\n";
    await fs.writeFile(file, next);
    return;
  }

  const out = [];
  for (const line of lines) {
    out.push(line);
    if (/^allowBuilds:\s*$/.test(line)) {
      for (const p of missing) out.push(`  '${p}': true`);
    }
  }
  await fs.writeFile(file, out.join("\n"));
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n");
}

// Parse the shared --plugins flag from a subcommand's argv.
function parsePluginSpecs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { plugins: { type: "string", multiple: true } },
    allowPositionals: true,
  });
  return (values.plugins ?? [])
    .flatMap((v) => v.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Plugin resolution ────────────────────────────────────────────────────────

// Pick a package's entry file from its manifest: exports("."), then
// module/main, then index.js.
function packageEntry(pkg) {
  const exp = pkg.exports;
  if (typeof exp === "string") return exp;
  if (exp && typeof exp === "object") {
    const dot = exp["."] ?? exp;
    const rel =
      typeof dot === "string"
        ? dot
        : (dot.import ?? dot.default ?? dot.node ?? dot.require);
    if (rel) return rel;
  }
  return pkg.module ?? pkg.main ?? "index.js";
}

// Load a descriptor from a plugin package directory. The plugin opts in by
// declaring a neutral `snSdkNextUiPlugin` field in its package.json pointing at the
// module that exports { templateDir, packageMerge? }. Returns null if the
// directory isn't a plugin.
async function loadPluginFromDir(dir) {
  let pkg;
  try {
    pkg = await readJson(path.join(dir, "package.json"));
  } catch {
    return null;
  }
  // The marker is what we look for — never a hard-coded package name — so the
  // public package's source never reveals which plugins exist.
  const entryRel = pkg.snSdkNextUiPlugin;
  if (!entryRel) return null;

  const entry =
    typeof entryRel === "string"
      ? path.join(dir, entryRel)
      : path.join(dir, packageEntry(pkg));
  const mod = await import(pathToFileURL(entry).href);
  const descriptor = mod.plugin ?? mod.default;
  if (!descriptor?.templateDir) {
    throw new Error(
      `Plugin "${pkg.name}" did not export a valid descriptor (expected { templateDir, packageMerge? }).`,
    );
  }
  // Resolve templateDir/packageMerge relative to the plugin's own dir.
  const base = path.dirname(entry);
  return {
    name: pkg.name,
    templateDir: path.resolve(base, descriptor.templateDir),
    packageMerge: descriptor.packageMerge
      ? path.resolve(base, descriptor.packageMerge)
      : undefined,
  };
}

// Auto-discover plugins among the host project's declared dependencies. Only
// inspects packages the project actually lists, reading just their manifests.
async function discoverPlugins(cwd) {
  let hostPkg;
  try {
    hostPkg = await readJson(path.join(cwd, "package.json"));
  } catch {
    return [];
  }
  const names = Object.keys({
    ...hostPkg.dependencies,
    ...hostPkg.devDependencies,
  });

  const found = [];
  for (const name of names) {
    const dir = path.join(cwd, "node_modules", ...name.split("/"));
    const descriptor = await loadPluginFromDir(dir);
    if (descriptor) found.push(descriptor);
  }
  return found;
}

// Resolve an explicit plugin spec given on the command line: an absolute/
// relative path to a plugin package dir (handy for local development).
async function loadPluginSpec(spec, cwd) {
  const dir = path.isAbsolute(spec) ? spec : path.resolve(cwd, spec);
  const descriptor = await loadPluginFromDir(dir);
  if (!descriptor) {
    throw new Error(
      `Plugin "${spec}" is not a valid plugin (no "snSdkNextUiPlugin" field in its package.json).`,
    );
  }
  return descriptor;
}

// Resolve the full ordered plugin list: auto-discovered first, then any passed
// explicitly via --plugins.
async function resolvePlugins(cwd, specs) {
  const plugins = await discoverPlugins(cwd);
  for (const spec of specs) {
    plugins.push(await loadPluginSpec(spec, cwd));
  }
  return plugins;
}

// ── Template rendering ─────────────────────────────────────────────────────────

// Recursively copy a template tree into `dest`, rendering `.ejs` files with EJS
// (the `.ejs` extension is stripped). `skip(relPath)` excludes entries. Plain
// files are copied verbatim — important for dev/index.html, whose `<%= ... %>`
// are webpack (HtmlWebpackPlugin) tags, not our EJS tags.
async function copyTree(srcRoot, dest, data, skip = () => false) {
  async function walk(srcDir, destDir, rel) {
    await fs.mkdir(destDir, { recursive: true });
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryRel = path.join(rel, entry.name);
      if (skip(entryRel)) continue;
      const srcPath = path.join(srcDir, entry.name);
      if (entry.isDirectory()) {
        await walk(srcPath, path.join(destDir, entry.name), entryRel);
      } else if (entry.name.endsWith(".ejs")) {
        const raw = await fs.readFile(srcPath, "utf-8");
        const out = ejs.render(raw, data);
        await fs.writeFile(path.join(destDir, entry.name.slice(0, -4)), out);
      } else {
        await fs.copyFile(srcPath, path.join(destDir, entry.name));
      }
    }
  }
  await walk(srcRoot, dest, "");
}

// Title-case a custom-element name for display, e.g. "my-counter" → "My Counter".
function toLabel(name) {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Build the now-ui.json entry for a freshly added component.
function buildComponentEntry(name) {
  return {
    innerComponents: ["now-button"],
    properties: [
      {
        name: "buttonSize",
        label: "Button size",
        fieldType: "string",
        defaultValue: "md",
        description: "The size applied to the buttons",
        required: false,
        readOnly: false,
        selectable: false,
        managed: false,
        typeMetadata: { schema: { type: "string" } },
      },
    ],
    uiBuilder: {
      associatedTypes: ["global.core", "global.landing-page"],
      label: toLabel(name),
      icon: "document",
      description: `The ${toLabel(name)} component`,
      category: "primitives",
    },
    actions: [
      {
        name: `${name.toUpperCase()}#ITEM_SELECTED`,
        label: "Item selected",
        description: "Dispatched when the user clicks a button.",
        payload: [
          {
            name: "item",
            label: "Item",
            description: "The label of the selected item.",
            fieldType: "string",
          },
        ],
      },
    ],
  };
}

// ── init: transform an SDK project into a hybrid ────────────────────────────────

export async function init({ argv = [] } = {}) {
  const cwd = process.cwd();
  p.intro("sn-sdk-next-ui init");

  try {
    // Must be run inside an existing ServiceNow SDK project.
    if (!(await exists(path.join(cwd, "now.config.json")))) {
      p.cancel(
        "No now.config.json found. Run this inside a ServiceNow SDK project (created with `now-sdk init`).",
      );
      process.exit(1);
    }
    // Idempotency guard: don't clobber an already-initialised project.
    if (await exists(path.join(cwd, "now-ui.json"))) {
      p.cancel(
        "This project already looks initialised (now-ui.json exists). Use `sn-sdk-next-ui add` to create components.",
      );
      process.exit(1);
    }
    if (!(await checkSncInstalled())) {
      p.cancel(
        "The ServiceNow CLI (snc) is required but not installed. See: https://developer.servicenow.com/dev.do#!/reference/next-experience/ui-component-cli",
      );
      process.exit(1);
    }

    const nowConfig = await readJson(path.join(cwd, "now.config.json"));
    const data = {
      scopeName: nowConfig.scope ?? "",
      scopeSysId: nowConfig.scopeId ?? "",
    };

    const plugins = await resolvePlugins(cwd, parsePluginSpecs(argv));

    const spinner = p.spinner();
    spinner.start("Adding Next Experience wiring...");

    // Lay down the base project files, skipping the per-component template and
    // the package merge fragment. Then overlay each plugin's project files.
    const skip = (rel) =>
      rel === PACKAGE_MERGE_FILE || rel === COMPONENT_SUBPATH;
    await copyTree(BASE_TEMPLATE_DIR, cwd, data, skip);
    for (const plugin of plugins) {
      await copyTree(plugin.templateDir, cwd, data, skip);
    }

    // Merge package.json: base fragment first, then each plugin's fragment.
    const pkgPath = path.join(cwd, "package.json");
    const pkg = await readJson(pkgPath);
    const mergeFiles = [
      path.join(BASE_TEMPLATE_DIR, PACKAGE_MERGE_FILE),
      ...plugins.map((pl) => pl.packageMerge).filter(Boolean),
    ];
    for (const file of mergeFiles) {
      if (!(await exists(file))) continue;
      const fragment = JSON.parse(
        ejs.render(await fs.readFile(file, "utf-8"), data),
      );
      deepMerge(pkg, fragment);
    }
    await writeJson(pkgPath, pkg);

    // Allow pnpm to run the build scripts the UI stack needs.
    await ensureAllowBuilds(cwd, ["core-js", "sn-http-request"]);

    spinner.stop("Project wired for Next Experience");

    spinner.start("Installing dependencies...");
    const pm = detectPackageManager();
    await execa(pm, ["install"], { cwd });
    spinner.stop("Dependencies installed");

    p.outro("Done! Add a component with: " + pm + " sn-sdk-next-ui add");
  } catch (error) {
    p.cancel(`init failed: ${error.message}`);
    process.exit(1);
  }
}

// ── add: scaffold one or more components ────────────────────────────────────────

export async function add({ argv = [] } = {}) {
  const cwd = process.cwd();
  p.intro("sn-sdk-next-ui add");

  try {
    const nowUiPath = path.join(cwd, "now-ui.json");
    if (!(await exists(nowUiPath))) {
      p.cancel("No now-ui.json found. Run `sn-sdk-next-ui init` first.");
      process.exit(1);
    }

    const nowUi = await readJson(nowUiPath);
    const existing = new Set(Object.keys(nowUi.components ?? {}));
    const names = await promptComponentNames(existing);

    const spinner = p.spinner();
    spinner.start("Creating components...");
    await scaffoldComponents({
      cwd,
      names,
      pluginSpecs: parsePluginSpecs(argv),
    });
    spinner.stop(`Added ${names.length} component(s): ${names.join(", ")}`);

    p.outro("Done! Build with: pnpm build");
  } catch (error) {
    p.cancel(`add failed: ${error.message}`);
    process.exit(1);
  }
}

// Scaffold the named components into the project at `cwd`: render the component
// template (plus any plugin overlays) into src/now-ui/<name>/, register each in
// now-ui.json, and add a barrel import. Separated from add() so it can run
// without the interactive prompts (e.g. in tests).
export async function scaffoldComponents({ cwd, names, pluginSpecs = [] }) {
  const nowUiPath = path.join(cwd, "now-ui.json");
  const nowUi = await readJson(nowUiPath);
  nowUi.components ??= {};

  const plugins = await resolvePlugins(cwd, pluginSpecs);

  for (const name of names) {
    const destDir = path.join(cwd, "src", "now-ui", name);
    const data = {
      componentName: name,
      scopeName: nowUi.scopeName ?? "",
      scopeSysId: nowUi.scopeSysId ?? "",
    };
    // Base component template, then each plugin's component overlay.
    await copyTree(
      path.join(BASE_TEMPLATE_DIR, COMPONENT_SUBPATH),
      destDir,
      data,
    );
    for (const plugin of plugins) {
      const pluginComponentDir = path.join(
        plugin.templateDir,
        COMPONENT_SUBPATH,
      );
      if (await exists(pluginComponentDir)) {
        await copyTree(pluginComponentDir, destDir, data);
      }
    }

    nowUi.components[name] = buildComponentEntry(name);
    await appendBarrelImport(cwd, name);
  }

  await writeJson(nowUiPath, nowUi);
  return names;
}

// Append `import './<name>'` to the now-ui barrel, creating it if needed and
// avoiding duplicates.
async function appendBarrelImport(cwd, name) {
  const barrel = path.join(cwd, "src", "now-ui", "index.js");
  let current = "";
  if (await exists(barrel)) current = await fs.readFile(barrel, "utf-8");
  const line = `import './${name}'`;
  if (current.includes(line)) return;
  const next =
    current.endsWith("\n") || current === "" ? current : current + "\n";
  await fs.writeFile(barrel, next + line + "\n");
}

// Interactive prompts: how many components, then each name. `existing` is the
// set of component names already registered, used for uniqueness validation.
async function promptComponentNames(existing) {
  const onCancel = () => {
    p.cancel("Cancelled.");
    process.exit(0);
  };

  const { count } = await p.group(
    {
      count: () =>
        p
          .text({
            message: "How many components do you want to create?",
            placeholder: "1",
            validate: (v) => {
              const n = parseInt(v, 10);
              if (isNaN(n) || n < 1 || n > 50)
                return "Enter a number between 1 and 50";
            },
          })
          .then((v) => parseInt(v, 10)),
    },
    { onCancel },
  );

  const ordinals = ["first", "second", "third", "fourth", "fifth"];
  const ordinal = (i) => ordinals[i] ?? `${i + 1}th`;
  const names = [];

  for (let i = 0; i < count; i++) {
    const name = await p.text({
      message: `What do you want your ${ordinal(i)} component to be called?`,
      placeholder: `my-component-${String.fromCharCode(97 + (i % 26))}`,
      validate: (v) => {
        if (!v || v.length === 0) return "Component name is required";
        if (!CUSTOM_ELEMENT_RE.test(v))
          return "Must be a valid custom element name: lowercase, start with a letter, contain a hyphen (e.g. my-component-a)";
        if (existing.has(v) || names.includes(v))
          return "A component with that name already exists";
      },
    });
    if (p.isCancel(name)) onCancel();
    names.push(name);
  }

  return names;
}
