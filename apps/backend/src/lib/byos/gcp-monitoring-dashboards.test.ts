import { describe, expect, test } from 'bun:test'

import {
  applyDashboardFilterSelections,
  BoundedTtlCache,
  monitoringSeriesKey,
  normalizeGcpMonitoringDashboard,
  rankSeries,
} from './gcp-monitoring-dashboards'

type RawDashboardInput = Parameters<typeof normalizeGcpMonitoringDashboard>[0]

describe('normalizeGcpMonitoringDashboard', () => {
  test('normalizes mosaic widgets, saved query metadata, filters, and groups', () => {
    const dashboard = normalizeGcpMonitoringDashboard(
      {
        name: 'projects/demo/dashboards/abc-123',
        displayName: 'Production overview',
        labels: { environment: 'prod' },
        dashboardFilters: [
          {
            labelKey: 'zone',
            filterType: 'RESOURCE_LABEL',
            stringValue: 'asia-east1-a',
            stringArray: { values: ['asia-east1-a', 'asia-east1-b'] },
          },
        ],
        mosaicLayout: {
          columns: 48,
          tiles: [
            {
              xPos: 0,
              yPos: 0,
              width: 48,
              height: 24,
              widget: { title: 'Compute', collapsibleGroup: { collapsed: true } },
            },
            {
              xPos: 0,
              yPos: 4,
              width: 24,
              height: 10,
              widget: {
                id: 'cpu',
                title: 'CPU utilization',
                xyChart: {
                  dataSets: [
                    {
                      legendTemplate: '${resource.labels.instance_id}',
                      plotType: 'LINE',
                      minAlignmentPeriod: '60s',
                      timeSeriesQuery: {
                        unitOverride: '10^2.%',
                        timeSeriesFilter: {
                          filter: 'metric.type = "compute.googleapis.com/instance/cpu/utilization"',
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      } as RawDashboardInput,
      'demo',
    )

    expect(dashboard.id).toBe('abc-123')
    expect(dashboard.columns).toBe(48)
    expect(dashboard.filters[0]).toMatchObject({
      id: 'zone',
      defaultValue: 'asia-east1-a',
      options: ['asia-east1-a', 'asia-east1-b'],
    })
    expect(dashboard.widgets[0]).toMatchObject({ kind: 'group', collapsed: true })
    expect(dashboard.widgets[1]).toMatchObject({
      id: 'cpu',
      kind: 'xy',
      groupRef: 'mosaic:0',
      queries: [
        {
          index: 0,
          sourceType: 'timeSeriesFilter',
          supported: true,
          unit: '10^2.%',
        },
      ],
    })
  })

  test('normalizes grid, row, and column layouts without overlapping columns', () => {
    const grid = normalizeGcpMonitoringDashboard(
      {
        name: 'projects/demo/dashboards/grid',
        gridLayout: {
          columns: '2',
          widgets: [{ text: { content: 'a' } }, { text: { content: 'b' } }],
        },
      } as RawDashboardInput,
      'demo',
    )

    expect(grid.columns).toBe(2)
    expect(grid.widgets.map((widget) => widget.layout.x)).toEqual([0, 1])

    const row = normalizeGcpMonitoringDashboard(
      {
        name: 'projects/demo/dashboards/row',
        rowLayout: {
          rows: [{ widgets: [{ text: { content: 'a' } }, { text: { content: 'b' } }] }],
        },
      } as RawDashboardInput,
      'demo',
    )

    expect(row.widgets.map((widget) => [widget.layout.x, widget.layout.w])).toEqual([
      [0, 12],
      [12, 12],
    ])

    const column = normalizeGcpMonitoringDashboard(
      {
        name: 'projects/demo/dashboards/column',
        columnLayout: {
          columns: [
            { weight: '1', widgets: [{ text: { content: 'a' } }] },
            { weight: '3', widgets: [{ text: { content: 'b' } }] },
          ],
        },
      } as RawDashboardInput,
      'demo',
    )

    expect(column.widgets.map((widget) => [widget.layout.x, widget.layout.w])).toEqual([
      [0, 6],
      [6, 18],
    ])
  })

  test('marks advanced saved query languages as explicit unsupported queries', () => {
    const dashboard = normalizeGcpMonitoringDashboard(
      {
        name: 'projects/demo/dashboards/promql',
        gridLayout: {
          widgets: [
            {
              title: 'PromQL panel',
              xyChart: {
                dataSets: [{ timeSeriesQuery: { prometheusQuery: 'up' } }],
              },
            },
          ],
        },
      } as RawDashboardInput,
      'demo',
    )

    expect(dashboard.widgets[0]?.queries[0]).toMatchObject({
      sourceType: 'promql',
      supported: false,
    })
  })
})
describe('applyDashboardFilterSelections', () => {
  test('substitutes provider-defined variables and appends global label filters', () => {
    const result = applyDashboardFilterSelections(
      'metric.type = "custom.googleapis.com/errors" AND resource.labels.zone = "${zone}"',
      [
        {
          templateVariable: 'zone',
          stringArray: { values: ['asia-east1-a'] },
        },
        {
          labelKey: 'method',
          filterType: 'METRIC_LABEL',
          stringValue: 'POST',
        },
      ],
      { zone: 'asia-east1-a' },
    )

    expect(result).toBe(
      '(metric.type = "custom.googleapis.com/errors" AND resource.labels.zone = "asia-east1-a") AND metric.labels.method = "POST"',
    )
  })

  test('rejects values that could become Monitoring filter syntax', () => {
    expect(() =>
      applyDashboardFilterSelections(
        'metric.type = "custom.googleapis.com/errors" AND resource.labels.zone = "${zone}"',
        [{ templateVariable: 'zone' }],
        { zone: 'a" OR metric.type = "secret' },
      ),
    ).toThrow('may not contain query syntax')
  })

  test('expands label variables to predicates and omits wildcard selections', () => {
    const definitions = [
      {
        templateVariable: 'instance',
        labelKey: 'instance_id',
        filterType: 'RESOURCE_LABEL',
      },
    ]
    const base = 'metric.type = "compute.googleapis.com/instance/cpu/utilization" ${instance}'

    expect(applyDashboardFilterSelections(base, definitions, { instance: '12345' })).toBe(
      'metric.type = "compute.googleapis.com/instance/cpu/utilization" resource.labels.instance_id = "12345"',
    )
    expect(applyDashboardFilterSelections(base, definitions, { instance: '*' })).toBe(
      'metric.type = "compute.googleapis.com/instance/cpu/utilization" ',
    )
  })

  test('quotes value-only variables and resolves wildcard selections', () => {
    const definitions = [
      {
        templateVariable: 'zone',
        filterType: 'VALUE_ONLY',
        stringArray: { values: ['asia-east1-a'] },
      },
    ]
    const base = 'resource.labels.zone = monitoring.regex.full_match(${zone})'

    expect(applyDashboardFilterSelections(base, definitions, { zone: 'asia-east1-a' })).toBe(
      'resource.labels.zone = monitoring.regex.full_match("asia-east1-a")',
    )
    expect(applyDashboardFilterSelections(base, definitions, { zone: '*' })).toBe(
      'resource.labels.zone = monitoring.regex.full_match(".*")',
    )
  })
})

describe('BoundedTtlCache', () => {
  test('expires stale values and evicts the least recently used live entry', () => {
    let now = 0
    const cache = new BoundedTtlCache<string>(100, 2, () => now)

    cache.set('a', 'A')
    cache.set('b', 'B')
    expect(cache.get('a')).toBe('A')
    cache.set('c', 'C')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe('A')
    now = 101
    expect(cache.get('a')).toBeUndefined()
    expect(cache.size).toBe(1)
  })
})

describe('rankSeries', () => {
  test('METHOD_LATEST ranks by the newest point instead of historical max', () => {
    const series: Parameters<typeof rankSeries>[0] = [
      {
        name: 'peaked',
        labels: {},
        resourceType: '',
        metricType: '',
        points: [
          [1, 100],
          [2, 1],
        ],
      },
      {
        name: 'latest',
        labels: {},
        resourceType: '',
        metricType: '',
        points: [
          [1, 2],
          [2, 10],
        ],
      },
    ]

    expect(
      rankSeries(series, {
        rankingMethod: 'METHOD_LATEST',
        numTimeSeries: 1,
        direction: 'TOP',
      })[0]?.name,
    ).toBe('latest')
  })
})

test('monitoringSeriesKey cannot collide through label delimiters', () => {
  expect(monitoringSeriesKey('metric', 'resource', { a: 'b', c: 'd' })).not.toBe(
    monitoringSeriesKey('metric', 'resource', { a: 'b,c=d' }),
  )
})
