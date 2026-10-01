import { useMemo, useState } from 'react'

import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '../../components/ui/combobox'

export function RegionCombobox({
  regions,
  value,
  onChange,
}: {
  regions: readonly string[]
  value: string
  onChange: (region: string) => void
}) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()

    return q ? regions.filter((r) => r.toLowerCase().includes(q)) : regions
  }, [regions, query])

  return (
    <Combobox
      modal
      items={matches}
      filter={null}
      value={value}
      onInputValueChange={(v) => setQuery(v)}
      onOpenChange={(isOpen) => {
        if (isOpen) setQuery('')
      }}
      onValueChange={(v) => {
        if (v) onChange(v)
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur()
        }
      }}
      itemToStringLabel={(r) => r}
      autoHighlight
    >
      <ComboboxInput
        aria-label="Select region"
        placeholder="Region"
        className="h-7 w-[150px] border-zGray-800"
        inputClassName="px-2 text-[12px]"
      />
      <ComboboxContent className="w-[200px] max-h-[340px] bg-zGray-850 p-0 [padding-block:0]">
        <ComboboxList className="max-h-[300px] overflow-auto p-0 [padding-block:0]">
          {(r) => (
            <ComboboxItem key={String(r)} value={r}>
              {String(r)}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
