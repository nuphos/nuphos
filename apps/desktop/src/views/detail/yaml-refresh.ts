export function mergeRefreshedYaml(
  currentYaml: string | null,
  draftYaml: string,
  refreshedYaml: string,
): { yamlText: string; draftYaml: string } {
  const draftIsClean = currentYaml == null || draftYaml === currentYaml

  return {
    yamlText: refreshedYaml,
    draftYaml: draftIsClean ? refreshedYaml : draftYaml,
  }
}
