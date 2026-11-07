# @nuphos/design-tokens

Semantic design tokens for every Nuphos surface. Tokens are named for what they
do (`surface.sheet`, `status.attention`), never for how they look, so a palette
change never means renaming code.

`src/tokens.mjs` is the single source. Each platform reads it through an adapter:

| Platform          | Adapter                                                | Status  |
| ----------------- | ------------------------------------------------------ | ------- |
| Desktop           | `src/tailwind.mjs` (Tailwind colors and CSS variables) | In use  |
| Web, iOS, Android | Generators from the same object                        | Not yet |

## Groups

| Group     | Tokens                                                | Use                                                |
| --------- | ----------------------------------------------------- | -------------------------------------------------- |
| `surface` | `canvas`, `sheet`, `raised`, `sunken`                 | Backgrounds, from the desk up                      |
| `state`   | `hover`, `selected`                                   | Translucent tints over any surface                 |
| `text`    | `primary`, `secondary`, `tertiary`, `inverse`, `link` | Text and icons; `link` marks links in running text |
| `line`    | `control`, `focus`                                    | Control borders and focus rings only               |
| `action`  | `primary`                                             | The one primary action in a view                   |
| `status`  | `success`, `warning`, `danger`, `attention`           | Meaningful states; `attention` is "needs you"      |
| `data`    | `1`                                                   | Charts and heatmaps; vary intensity with opacity   |

There is no divider token on purpose: areas are separated by surfaces, not lines.

## Desktop

```tsx
<div className="bg-surface-sheet text-secondary hover:bg-state-hover" />
<span className="bg-data-1/40" />
```

The `text` group is registered under `textColor`, not `colors` (see `apps/desktop/tailwind.config.js`), so
text tokens are `text-primary`, `text-secondary`, `text-tertiary` and `text-inverse`. `text-text-*` generates
nothing.

Translucent tokens (`state.*`) carry their own alpha and don't take opacity modifiers.

Tailwind does not watch this package. After changing a token, restart the desktop dev server
to see it.

## Rules

- Add a token only for a new purpose, never for a one-off color.
- Light and dark must define the same tokens; tests check this.
- Text tokens must reach WCAG AA (4.5:1) on every opaque surface, and on hovered and selected
  rows of the canvas and sheet; tests check this.
- Status tokens must read as text on every surface; tests check this.

Run `npm test` here, or `bun run test` at the repository root.
