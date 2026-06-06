# sn-sdk-next-ui – Next Experience UI components in your ServiceNow SDK project


Add Next Experience UI component development to a ServiceNow SDK (Fluent) project. Build components with the ServiceNow CLI, install them with the SDK.

## Why

Building on ServiceNow with the SDK / Fluent is increasingly common and powerful. `sn-sdk-next-ui` makes it even more powerful by letting you develop Next Experience components **inside** an existing SDK project, so a single repository and scoped application holds both your Fluent/server code and your UI components.

It does this by splitting responsibilities between the two toolchains:

- the **ServiceNow CLI (`snc`)** is used only to _build_ the components, and
- the **ServiceNow SDK (`now-sdk`)** is used to install the built components onto an instance alongside the rest of your application.

## Prerequisites

- An existing ServiceNow SDK project (created with `now-sdk init`).
- The **ServiceNow CLI** (`snc`) installed and on your `PATH` — used for building and the dev server. See the [UI component CLI docs](https://developer.servicenow.com/dev.do#!/reference/next-experience/australia/cli/getting-started).

## Getting started

From the root of your SDK project:

```bash
# 1. Install
npm add -D sn-sdk-next-ui

# 2. Transform the project into a hybrid SDK + Next Experience project (run once)
npm exec sn-sdk-next-ui init

# 3. Add one or more components (interactive)
npm exec sn-sdk-next-ui add
```

> [!NOTE]
> Examples in this README use `npm`. Substitute your preferred package manager — just mind the per-manager syntax:
>
> | Task | npm | pnpm | yarn |
> | --- | --- | --- | --- |
> | run a binary | `npm exec sn-sdk-next-ui …` | `pnpm exec sn-sdk-next-ui …` | `yarn sn-sdk-next-ui …` |
> | run a script | `npm run dev` | `pnpm dev` | `yarn dev` |
>
> `sn-sdk-next-ui` detects which manager invoked it and uses it for any installs it runs, so you don't need to configure anything.

## Commands

### `sn-sdk-next-ui init`

Transforms the current SDK project in place. It:

- adds the `dev`, `build`, `clean` and `deploy` scripts (your existing `transform`/`types` scripts are preserved),
- adds the Next Experience dev dependencies and a `module` entry to `package.json`,
- creates `now-ui.json` (seeded with your scope from `now.config.json`), `now-cli.json`, `.eslintrc`, `dev/index.html`, and the `example/` preview harness,
- on pnpm projects, allows pnpm to run the build scripts the UI stack needs (via `allowBuilds` in `pnpm-workspace.yaml`), and
- installs dependencies (using whichever package manager invoked it).

`init` is run **once**. It refuses to run if `now-ui.json` already exists, or if the directory isn't an SDK project (no `now.config.json`).

### `sn-sdk-next-ui add`

Interactively scaffolds one or more components. For each component it:

- creates `src/now-ui/<component>/` from the component template,
- registers the component in `now-ui.json`, and
- adds an import to the `src/now-ui` barrel.

Component names must be valid custom-element names (lowercase, start with a letter, contain a hyphen — e.g. `my-counter`).

## Project scripts (after `init`)

Run these with your package manager (`npm run build`, `pnpm build`, `yarn build`, …):

| Script    | What it does                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`     | Runs `snc ui-component develop` — a live dev server that renders the preview in `example/`.                                                                         |
| `clean`   | `now-sdk clean` and removes the `.now-cli` working directory.                                                                                                       |
| `build`   | everything in `clean` plus `snc ui-component generate-update-set`, unpacks the update set into the ServiceNow SDK `dist` folder, and then `now-sdk build`           |
| `deploy`  | `now-sdk pack && now-sdk install` — installs the built application (UI components included) onto your instance.                                                      |

## Project layout (after `init` + `add`)

```
your-sdk-project/
├── now-ui.json                 # Next Experience component manifest
├── now-cli.json                # snc dev-server config
├── dev/index.html              # dev-server page template
├── example/
│   ├── element.js              # EDIT THIS — controls the dev preview
│   └── preview.js              # preview rendering engine
└── src/
    ├── fluent/ …               # your existing SDK/Fluent code (untouched)
    ├── server/ …               # your existing server code (untouched)
    └── now-ui/
        ├── index.js            # barrel — imports every component
        └── my-counter/
            ├── index.js
            └── index.scss
```

## Customising the dev preview

The `dev` command renders every component listed in `now-ui.json`, so components you add appear automatically with their default property values.

To customise, edit `example/element.js` and add entries to the `previews` map, keyed by component tag:

```js
const previews = {
  // one instance with custom props (merged over the now-ui.json defaults):
  "my-counter": { props: { buttonSize: "lg" } },

  // several labelled variants of the same component:
  "status-badge": [
    { label: "Small", props: { buttonSize: "sm" } },
    { label: "Large", props: { buttonSize: "lg" } },
  ],
};
```

Primitive props are applied as kebab-case attributes (`buttonSize` = `button-size`); object/array props are assigned as DOM properties.

> [!NOTE]
> `dev/index.html` contains a theme stylesheet URL that points at a specific instance. Follow the comment in that file to replace it with the path from your own instance.

## Plugins

`sn-sdk-next-ui` can be extended by plugins that layer extra template files and `package.json` entries on top of the base. A plugin is any installed package that declares an `snSdkNextUiPlugin` field in its `package.json`:

```json
{
  "name": "my-sn-sdk-next-ui-plugin",
  "snSdkNextUiPlugin": "./plugin.js"
}
```

whose entry exports a descriptor:

```js
// plugin.js
export const plugin = {
  templateDir: "./template", // overlaid on the base template tree
  packageMerge: "./package.merge.json", // optional, deep-merged into package.json
};
```

Plugins declared as dependencies of your project are **discovered automatically**. You can also pass them explicitly (e.g. a local path during development):

```bash
npm exec sn-sdk-next-ui init --plugins ../my-sn-sdk-next-ui-plugin
npm exec sn-sdk-next-ui add --plugins ../my-sn-sdk-next-ui-plugin
```

## License

MIT
