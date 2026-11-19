/** Runtime aliases are metadata, never selectable models. */
export function isDefaultModel(id: string, name = id): boolean {
  return (
    id.toLowerCase() === 'default' ||
    /^(?:(?:agent|runtime) )?default(?: model)?$/i.test(name.trim())
  )
}

export function concreteModelChoices<T extends { id: string; name: string; description?: string }>(
  models: T[],
  selected?: string,
) {
  const choices = models.filter((model) => !isDefaultModel(model.id, model.name))
  const alias = models.find((model) => model.id === selected)
  const current =
    selected && !isDefaultModel(selected, alias?.name)
      ? selected
      : choices.find(
          (model) =>
            alias?.description?.toLowerCase().includes(model.name.toLowerCase()) ||
            alias?.description?.toLowerCase() === model.id.toLowerCase(),
        )?.id

  const label =
    choices.find((model) => model.id === current)?.name ??
    (alias && !isDefaultModel('', alias.name) ? alias.name : undefined)

  return { choices, current, label }
}
