export type FieldType = 'time' | 'number' | 'string' | 'boolean' | 'other'

export type Field = {
  name: string
  type: FieldType
  labels?: Record<string, string>
  config?: {
    unit?: string
    displayName?: string
    displayNameFromDS?: string
    interval?: number
  }
  values: unknown[]
}

export type DataFrame = {
  name?: string
  refId: string
  fields: Field[]
  meta?: {
    preferredVisualisationType?: string
    custom?: { resultType?: string }
  }
}

export type DatasourceRef = { uid: string; type: string }

export type PanelTarget = {
  refId: string
  datasource?: DatasourceRef
  expr?: string
  rawSql?: string
  query?: string
  queryType?: string
  legendFormat?: string
  format?: string
  instant?: boolean
  range?: boolean
}

export type GridPos = { x: number; y: number; w: number; h: number }

export type FieldOverride = {
  matcher?: { id?: string; options?: unknown }
  properties?: { id?: string; value?: unknown }[]
}

export type Panel = {
  id: number
  type: string
  title: string
  gridPos: GridPos
  datasource?: DatasourceRef
  targets: PanelTarget[]
  fieldConfig?: {
    defaults?: {
      unit?: string
      min?: number
      max?: number
      decimals?: number
      custom?: {
        axisCenteredZero?: boolean
        drawStyle?: string
        fillOpacity?: number
        gradientMode?: string
        lineWidth?: number
        stacking?: { group?: string; mode?: string }
      }
      thresholds?: {
        mode?: string
        steps?: { color?: string; value?: number | null }[]
      }
    }
    overrides?: FieldOverride[]
  }
  options?: Record<string, unknown>
  transformations?: { id: string; options?: Record<string, unknown> }[]
  // Rows only: whether the row is saved collapsed, and the panels nested
  // inside it while collapsed (Grafana moves them out to the top level when
  // the row is expanded and saved).
  collapsed?: boolean
  panels?: Panel[]
  // Variable name used by Grafana to clone this row/panel once per selected
  // value. Repeated rows receive a single-value scoped variable.
  repeat?: string
}

export type RepeatValue = { value: string; text: string; queryValue: string }

export type Variable = {
  name: string
  label?: string
  type: 'datasource' | 'query' | 'custom' | 'constant' | 'interval' | 'textbox' | 'unknown'
  // Default current value(s) baked into the dashboard. Used as the initial
  // pick until the user changes it via a picker. Multi-select variables carry
  // several values; the `$__all` sentinel means "All".
  currentValue: string
  currentText: string
  currentValues: string[]
  currentTexts: string[]
  multi?: boolean
  includeAll?: boolean
  allValue?: string
  // For type='query': the variable query (e.g. `label_values(metric, label)`),
  // the datasource it runs against, and an optional regex that filters (or,
  // with a capture group, extracts from) the returned option values.
  query?: string
  datasource?: DatasourceRef
  optionsRegex?: string
  // For type='datasource': the datasource type name to filter by
  // (e.g. "victoriametrics-metrics-datasource") and an optional name regex.
  datasourceTypeFilter?: string
  datasourceNameRegex?: string
}

export type Dashboard = {
  uid: string
  title: string
  panels: Panel[]
  time: { from: string; to: string }
  variables: Variable[]
}

export type TimeRange = { from: number; to: number }
