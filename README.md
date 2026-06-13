# sn-sdk-next-ui – Next Experience UI components in your ServiceNow SDK project


Add Next Experience UI component development to a ServiceNow SDK (Fluent) project. Build components with the ServiceNow CLI, install them with the SDK.

## Why

Building on ServiceNow with the SDK / Fluent is increasingly common and powerful. `sn-sdk-next-ui` makes it even more powerful by letting you develop Next Experience components **inside** an existing SDK project, so a single repository and scoped application holds both your Fluent/server code and your UI components.

It does this by splitting responsibilities between the two toolchains:

- the **ServiceNow CLI (`snc`)** is used only to _build_ the components, and
- the **ServiceNow SDK (`now-sdk`)** is used to install the built components onto an instance alongside the rest of your application.

Furthermore, local development is modernized with [Storybook](https://storybook.js.org): components render live in the browser with automatic reload, isolated previews, and interaction tests. This is powered by [`@dylanlindgren/storybook-addon-sn-next-ui`](https://www.npmjs.com/package/@dylanlindgren/storybook-addon-sn-next-ui), which teaches Storybook how to render Next Experience components, so you get a fast, modern feedback loop.

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
- adds the Next Experience dev dependencies to `package.json`,
- creates `now-ui.json` (seeded with your scope from `now.config.json`), `now-cli.json`, `.eslintrc`, `.storybook/`, and Storybook configuration,
- on pnpm projects, allows pnpm to run the build scripts the UI stack needs (via `allowBuilds` in `pnpm-workspace.yaml`), and
- installs dependencies (using whichever package manager invoked it).

`init` is run **once**. It refuses to run if `now-ui.json` already exists, or if the directory isn't an SDK project (no `now.config.json`).

### `sn-sdk-next-ui add`

Interactively scaffolds one or more components. For each component it:

- creates `src/now-ui/<component>/` from the component template,
- creates a Storybook story at `stories/<component>.stories.js`,
- registers the component in `now-ui.json`, and
- adds an import to the `src/now-ui` barrel.

Component names must be valid custom-element names (lowercase, start with a letter, contain a hyphen — e.g. `my-counter`).

### `sn-sdk-next-ui build`

Runs the full hybrid build. It builds your UI components with `snc`, unpacks them into the SDK `dist` folder, and runs `now-sdk build`. The result is a single application containing both your Fluent/server code and your UI components, ready to `deploy`.

You normally run this with `npm run build` (the `build` script added to your `package.json` by `init`), rather than calling it directly.

### `sn-sdk-next-ui deploy`

Packs and installs the built application onto your instance (`now-sdk pack && now-sdk install`).

You normally run this with `npm run deploy` (the `deploy` script added to your `package.json` by `init`), rather than calling it directly.

## Project scripts (after `init`)

Run these with your package manager (`npm run build`, `pnpm build`, `yarn build`, …):

| Script    | What it does                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`     | Runs Storybook with interactive component previews and live reload.                                                                                                 |
| `clean`   | `now-sdk clean` and removes the `.now-cli` working directory.                                                                                                       |
| `build`   | everything in `clean` plus `snc ui-component generate-update-set`, unpacks the update set into the ServiceNow SDK `dist` folder, and then `now-sdk build`           |
| `deploy`  | `now-sdk pack && now-sdk install` — installs the built application (UI components included) onto your instance.                                                      |

## Project layout (after `init` + `add`)

`my-counter` here is just an example component name — your components are named whatever you choose when running `add`, and you'll have one folder under `src/now-ui/` and one story per component.

```
your-sdk-project/
├── now-ui.json                 # EDIT THIS — component manifest: properties, events, UI Builder config
├── now-cli.json                # snc dev-server config
├── .storybook/
│   └── main.mjs                # Storybook configuration
├── stories/
│   └── my-counter.stories.js   # EDIT THIS — component preview and tests
└── src/
    ├── fluent/ …               # your existing SDK/Fluent code (untouched)
    ├── server/ …               # your existing server code (untouched)
    └── now-ui/
        ├── index.js            # barrel — imports every component
        └── my-counter/
            ├── index.js        # EDIT THIS — your component's logic & markup
            └── index.scss      # EDIT THIS — your component's styles
```

## Component stories

Each component gets a Storybook story file (e.g., `stories/my-counter.stories.js`). Edit these files to:

- **Define variants**: Create multiple named stories to showcase different states and prop combinations.
- **Test interactions**: Use Storybook's play functions to test user interactions and component behavior.
- **Document props**: Use `argTypes` to describe component properties with descriptions, types, and control UI.

Example story:

```js
import '../src/now-ui'

const TAG = 'my-counter'

export default {
  title: 'Components/my-counter',
  tags: ['autodocs'],
  render: (args) => {
    const el = document.createElement(TAG)
    el.setAttribute('button-size', String(args.buttonSize))
    return el
  },
  argTypes: {
    buttonSize: {
      description: 'The size applied to the buttons',
      control: { type: 'select' },
      options: ['sm', 'md', 'lg'],
    },
  },
  args: { buttonSize: 'md' },
}

export const Default = {}
export const Large = { args: { buttonSize: 'lg' } }
```

## License

MIT
