// Preview rendering engine for the dev server. You normally don't need to edit
// this file — edit example/element.js to control what gets previewed.
//
// renderPreview({ manifest, previews }) renders one card per component instance:
//   - `manifest`  is now-ui.json's `components` map (the registered components).
//   - `previews`  is your per-component override map from element.js. A component
//                 with no entry is shown once using its now-ui.json defaults.

// "buttonSize" -> "button-size" (custom-element attributes are kebab-case).
const toAttr = (name) => name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

const isPrimitive = (v) =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

// Default property values declared for a component in now-ui.json.
function defaultsFor(definition) {
  const out = {};
  for (const prop of definition.properties ?? []) {
    if (prop.defaultValue !== undefined) out[prop.name] = prop.defaultValue;
  }
  return out;
}

// Apply props to an element: primitives as kebab-case attributes, anything
// richer (objects/arrays) assigned as a DOM property.
function applyProps(el, props) {
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (isPrimitive(value)) el.setAttribute(toAttr(name), String(value));
    else el[name] = value;
  }
}

// Resolve the list of instances to render for one component. An override may be
// a single { label?, props? } or an array of them; each is merged over defaults.
function variantsFor(tag, definition, previews) {
  const base = defaultsFor(definition);
  const override = previews[tag];
  if (override === undefined) return [{ props: base }];
  const list = Array.isArray(override) ? override : [override];
  return list.map((v) => ({
    label: v.label,
    props: { ...base, ...(v.props ?? {}) },
  }));
}

function card(tag, componentLabel, variant) {
  const wrapper = document.createElement("section");
  wrapper.className = "preview-card";

  const header = document.createElement("header");
  const title = document.createElement("h2");
  title.textContent = variant.label
    ? `${componentLabel} — ${variant.label}`
    : componentLabel;
  const code = document.createElement("code");
  code.textContent = `<${tag}>`;
  header.append(title, code);

  const stage = document.createElement("div");
  stage.className = "preview-stage";
  const el = document.createElement(tag);
  applyProps(el, variant.props);
  stage.append(el);

  wrapper.append(header, stage);
  return wrapper;
}

function injectStyles() {
  if (document.getElementById("sn-sdk-now-ui-preview-styles")) return;
  const style = document.createElement("style");
  style.id = "sn-sdk-now-ui-preview-styles";
  style.textContent = `
    .preview-root { max-width: 1100px; margin: 0 auto; padding: 24px;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .preview-root > h1 { font-size: 20px; margin: 0 0 20px; }
    .preview-empty { color: #6b6b6b; }
    .preview-grid { display: grid; gap: 16px;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
    .preview-card { border: 1px solid #e0e0e0; border-radius: 8px;
      overflow: hidden; background: #fff; }
    .preview-card > header { display: flex; align-items: baseline; gap: 8px;
      flex-wrap: wrap; padding: 10px 14px; background: #f5f5f5;
      border-bottom: 1px solid #e0e0e0; }
    .preview-card h2 { font-size: 14px; margin: 0; }
    .preview-card code { font-size: 12px; color: #6b6b6b; }
    .preview-stage { padding: 20px; }
  `;
  document.head.append(style);
}

export function renderPreview({ manifest = {}, previews = {} } = {}) {
  const run = () => {
    injectStyles();

    const root = document.createElement("main");
    root.className = "preview-root";

    const heading = document.createElement("h1");
    heading.textContent = "Component preview";
    root.append(heading);

    const tags = Object.keys(manifest);
    if (tags.length === 0) {
      const empty = document.createElement("p");
      empty.className = "preview-empty";
      empty.textContent =
        "No components yet. Run `sn-sdk-now-ui add` to create one, then reload.";
      root.append(empty);
    } else {
      const grid = document.createElement("div");
      grid.className = "preview-grid";
      for (const tag of tags) {
        const definition = manifest[tag];
        const label = definition.uiBuilder?.label ?? tag;
        for (const variant of variantsFor(tag, definition, previews)) {
          grid.append(card(tag, label, variant));
        }
      }
      root.append(grid);
    }

    document.body.append(root);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
}
