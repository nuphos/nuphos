// Single import surface into the dev-only palette tool. The sidebar help menu
// renders <DevPalette /> behind an `import.meta.env.DEV` gate, so the whole
// subtree is tree-shaken out of production builds.
export { DevPalette } from './DevPalette'
