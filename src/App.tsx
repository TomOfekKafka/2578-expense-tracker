import { useState, useEffect, useCallback } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { callMcpTool } from './api'

// ─── Types ───────────────────────────────────────────────────────────────────

type PeriodMode = 'month' | 'quarter' | 'year'

interface Period {
  mode: PeriodMode
  year: number
  month?: number   // 1–12, only for mode='month'
  quarter?: number // 1–4, only for mode='quarter'
}

interface ExpenseItem {
  category: string
  amount: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CHART_COLORS = [
  '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899',
  '#F59E0B', '#10B981', '#14B8A6', '#F97316',
  '#EF4444', '#84CC16', '#06B6D4', '#A855F7',
]

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

const MOCK_DATA: ExpenseItem[] = [
  { category: 'COGS', amount: 27226241 },
  { category: 'R&D', amount: 12453890 },
  { category: 'Sales & Marketing', amount: 9876543 },
  { category: 'G&A', amount: 5432100 },
  { category: 'Depreciation', amount: 2134567 },
  { category: 'Interest', amount: 987654 },
]

const CURRENT_YEAR = 2025
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function periodLabel(p: Period): string {
  if (p.mode === 'month') {
    return `${MONTHS[(p.month ?? 1) - 1]} ${p.year}`
  }
  if (p.mode === 'quarter') {
    return `Q${p.quarter} ${p.year}`
  }
  return `${p.year}`
}

function periodToDateFilter(p: Period): { start: string; end: string } {
  if (p.mode === 'month') {
    const m = p.month ?? 1
    const start = `${p.year}-${String(m).padStart(2, '0')}-01`
    const lastDay = new Date(p.year, m, 0).getDate()
    const end = `${p.year}-${String(m).padStart(2, '0')}-${lastDay}`
    return { start, end }
  }
  if (p.mode === 'quarter') {
    const q = p.quarter ?? 1
    const startMonth = (q - 1) * 3 + 1
    const endMonth = q * 3
    const lastDay = new Date(p.year, endMonth, 0).getDate()
    return {
      start: `${p.year}-${String(startMonth).padStart(2, '0')}-01`,
      end: `${p.year}-${String(endMonth).padStart(2, '0')}-${lastDay}`,
    }
  }
  return { start: `${p.year}-01-01`, end: `${p.year}-12-31` }
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

interface TooltipPayloadEntry {
  name: string
  value: number
  payload: { pct: number }
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadEntry[] }) {
  if (!active || !payload?.length) return null
  const item = payload[0]
  return (
    <div className="custom-tooltip">
      <p className="tooltip-name">{item.name}</p>
      <p className="tooltip-value">{formatCurrency(item.value)}</p>
      <p className="tooltip-pct">{item.payload.pct.toFixed(1)}%</p>
    </div>
  )
}

// ─── Custom Legend ────────────────────────────────────────────────────────────

interface LegendPayloadEntry {
  value: string
  color: string
  payload: { amount: number; pct: number }
}

function CustomLegend({ payload }: { payload?: LegendPayloadEntry[] }) {
  if (!payload) return null
  return (
    <ul className="chart-legend">
      {payload.map((entry, idx) => (
        <li key={idx} className="legend-item">
          <span className="legend-dot" style={{ background: entry.color }} />
          <span className="legend-label">{entry.value}</span>
          <span className="legend-amount">{formatCurrency(entry.payload.amount)}</span>
          <span className="legend-pct">{entry.payload.pct.toFixed(1)}%</span>
        </li>
      ))}
    </ul>
  )
}

// ─── Period Picker ────────────────────────────────────────────────────────────

interface PeriodPickerProps {
  period: Period
  onChange: (p: Period) => void
}

function PeriodPicker({ period, onChange }: PeriodPickerProps) {
  const setMode = (mode: PeriodMode) => {
    if (mode === 'month') onChange({ mode, year: period.year, month: period.month ?? 1 })
    else if (mode === 'quarter') onChange({ mode, year: period.year, quarter: period.quarter ?? 1 })
    else onChange({ mode, year: period.year })
  }

  return (
    <div className="period-picker">
      <div className="mode-toggle">
        {(['month', 'quarter', 'year'] as PeriodMode[]).map(m => (
          <button
            key={m}
            className={`mode-btn${period.mode === m ? ' active' : ''}`}
            onClick={() => setMode(m)}
          >
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      <div className="period-selectors">
        {/* Year selector */}
        <div className="year-selector">
          {YEARS.map(y => (
            <button
              key={y}
              className={`year-btn${period.year === y ? ' active' : ''}`}
              onClick={() => onChange({ ...period, year: y })}
            >
              {y}
            </button>
          ))}
        </div>

        {/* Month selector */}
        {period.mode === 'month' && (
          <div className="month-selector">
            {MONTHS.map((m, idx) => (
              <button
                key={m}
                className={`month-btn${period.month === idx + 1 ? ' active' : ''}`}
                onClick={() => onChange({ ...period, month: idx + 1 })}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        {/* Quarter selector */}
        {period.mode === 'quarter' && (
          <div className="quarter-selector">
            {[1, 2, 3, 4].map(q => (
              <button
                key={q}
                className={`quarter-btn${period.quarter === q ? ' active' : ''}`}
                onClick={() => onChange({ ...period, quarter: q })}
              >
                Q{q}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [period, setPeriod] = useState<Period>({
    mode: 'quarter',
    year: 2025,
    quarter: 1,
  })
  const [expenses, setExpenses] = useState<ExpenseItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usingMock, setUsingMock] = useState(false)

  const fetchData = useCallback(async (p: Period) => {
    setLoading(true)
    setError(null)
    setUsingMock(false)

    try {
      const tables = await callMcpTool('list_finance_tables', {}) as Array<{ id: number; name: string }>
      const financials = tables.find(t => /^financials$/i.test(t.name)) ?? tables[0]
      const tableId = String(financials.id)

      const { start, end } = periodToDateFilter(p)

      const data = await callMcpTool('aggregate_table_data', {
        table_id: tableId,
        dimensions: ['DR_ACC_L1.5'],
        metrics: [{ field: 'Amount', agg: 'SUM' }],
        filters: [
          { name: 'Scenario', values: ['Actuals'], is_excluded: false },
          { name: 'DR_ACC_L0', values: ['P&L'], is_excluded: false },
          { name: 'Reporting Date', values: [start, end], is_excluded: false },
        ],
      }) as Array<Record<string, unknown>>

      const items: ExpenseItem[] = data
        .map(row => ({
          category: String(row['DR_ACC_L1.5'] ?? 'Unknown'),
          amount: Math.abs(Number(row['Amount'] ?? 0)),
        }))
        .filter(item => item.amount > 0)
        .sort((a, b) => b.amount - a.amount)

      if (items.length === 0) throw new Error('No data returned')
      setExpenses(items)
    } catch (err) {
      console.warn('API error, using mock data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
      setExpenses(MOCK_DATA)
      setUsingMock(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData(period)
  }, [period, fetchData])

  const total = expenses.reduce((s, e) => s + e.amount, 0)

  const chartData = expenses.map(e => ({
    name: e.category,
    value: e.amount,
    amount: e.amount,
    pct: total > 0 ? (e.amount / total) * 100 : 0,
  }))

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="header-title">
            <h1>Expense Overview</h1>
            <p className="header-subtitle">Company P&amp;L · Actuals</p>
          </div>
          {usingMock && (
            <div className="mock-badge">Demo data</div>
          )}
        </div>
      </header>

      <main className="app-main">
        <section className="period-section">
          <h2 className="section-label">Select Period</h2>
          <PeriodPicker period={period} onChange={setPeriod} />
        </section>

        <section className="dashboard">
          <div className="summary-card">
            <p className="summary-label">Total Expenses</p>
            <p className="summary-period">{periodLabel(period)}</p>
            {loading ? (
              <div className="spinner" />
            ) : (
              <p className="summary-amount">{formatCurrency(total)}</p>
            )}
            {error && !usingMock && (
              <p className="error-msg">{error}</p>
            )}
          </div>

          <div className="chart-card">
            <h2 className="chart-title">Expenses by Category</h2>
            {loading ? (
              <div className="chart-loading">
                <div className="spinner large" />
                <p>Loading data…</p>
              </div>
            ) : (
              <div className="chart-wrapper">
                <ResponsiveContainer width="100%" height={380}>
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={90}
                      outerRadius={150}
                      paddingAngle={2}
                      dataKey="value"
                      animationBegin={0}
                      animationDuration={600}
                    >
                      {chartData.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={CHART_COLORS[index % CHART_COLORS.length]}
                          stroke="transparent"
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend content={<CustomLegend />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="donut-center">
                  <span className="donut-total-label">Total</span>
                  <span className="donut-total-value">{formatCurrency(total)}</span>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
