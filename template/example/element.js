// Dev preview — EDIT THIS FILE to control how your components render.
//
// `snc ui-component develop` serves this as the page entry. Components are read
// from now-ui.json, so anything you create with `sn-sdk-next-ui add` shows up here
// automatically using its default property values.
//
// To customise a component's preview, add an entry to `previews` below, keyed by
// the component's tag name. Two forms are supported:
//
//   // one instance with custom props (merged over the now-ui.json defaults):
//   "my-counter": { props: { buttonSize: "lg" } },
//
//   // several labelled variants of the same component:
//   "status-badge": [
//     { label: "Small", props: { buttonSize: "sm" } },
//     { label: "Large", props: { buttonSize: "lg" } },
//   ],
//
// Primitive props are set as kebab-case attributes (buttonSize -> button-size);
// object/array props are assigned as DOM properties.

import "../src/now-ui";
import nowUi from "../now-ui.json";
import { renderPreview } from "./preview.js";

const previews = {
  // "my-counter": { props: { buttonSize: "lg" } },
};

renderPreview({ manifest: nowUi.components, previews });
