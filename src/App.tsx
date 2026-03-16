import { useState, useEffect, useRef } from 'react'
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

interface RawRow {
  'Reporting Date': number  // Unix timestamp (seconds)
  'DR_ACC_L1.5': string
  'Amount': number
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

const EXCLUDED_CATEGORIES = new Set(['revenues', '0', 'ignore'])

// Years from 2022 (data start) to 2025 (Actuals end ~early 2025)
const CURRENT_YEAR = 2025
const YEARS = [2025, 2024, 2023, 2022]

const MOCK_RAW: RawRow[] = [
  // Q1 2025 mock data (timestamps for end-of-month)
  { 'Reporting Date': 1738281600, 'DR_ACC_L1.5': 'COGS', 'Amount': 9500000 },
  { 'Reporting Date': 1738281600, 'DR_ACC_L1.5': 'R&amp;D', 'Amount': 4200000 },
  { 'Reporting Date': 1738281600, 'DR_ACC_L1.5': 'S&amp;M', 'Amount': 3100000 },
  { 'Reporting Date': 1738281600, 'DR_ACC_L1.5': 'G&amp;A', 'Amount': 1800000 },
  { 'Reporting Date': 1738281600, 'DR_ACC_L1.5': 'Finance expenses', 'Amount': 680000 },
  { 'Reporting Date': 1738281600, 'DR_ACC_L1.5': 'Revenues', 'Amount': 15000000 },
  { 'Reporting Date': 1740960000, 'DR_ACC_L1.5': 'COGS', 'Amount': 9800000 },
  { 'Reporting Date': 1740960000, 'DR_ACC_L1.5': 'R&amp;D', 'Amount': 4400000 },
  { 'Reporting Date': 1740960000, 'DR_ACC_L1.5': 'S&amp;M', 'Amount': 3300000 },
  { 'Reporting Date': 1740960000, 'DR_ACC_L1.5': 'G&amp;A', 'Amount': 1900000 },
  { 'Reporting Date': 1740960000, 'DR_ACC_L1.5': 'Finance expenses', 'Amount': 720000 },
  { 'Reporting Date': 1740960000, 'DR_ACC_L1.5': 'Revenues', 'Amount': 16000000 },
  { 'Reporting Date': 1743465600, 'DR_ACC_L1.5': 'COGS', 'Amount': 10100000 },
  { 'Reporting Date': 1743465600, 'DR_ACC_L1.5': 'R&amp;D', 'Amount': 4600000 },
  { 'Reporting Date': 1743465600, 'DR_ACC_L1.5': 'S&amp;M', 'Amount': 3500000 },
  { 'Reporting Date': 1743465600, 'DR_ACC_L1.5': 'G&amp;A', 'Amount': 2000000 },
  { 'Reporting Date': 1743465600, 'DR_ACC_L1.5': 'Finance expenses', 'Amount': 750000 },
  { 'Reporting Date': 1743465600, 'DR_ACC_L1.5': 'Revenues', 'Amount': 17000000 },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Decode HTML entities like &amp;, &amp;amp; etc. */
function decodeHtml(s: string): string {
  return new DOMParser().parseFromString(s, 'text/html').documentElement.textContent ?? s
}

function periodLabel(p: Period): string {
  if (p.mode === 'month') {
    return `${MONTHS[(p.month ?? 1) - 1]} ${p.year}`
  }
  if (p.mode === 'quarter') {
    return `Q${p.quarter} ${p.year}`
  }
  return `${p.year}`
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}

/** Filter raw rows for the selected period, decode HTML, exclude non-expenses, sum by category */
function filterAndAggregate(rawData: RawRow[], period: Period): ExpenseItem[] {
  const sums = new Map<string, number>()

  for (const row of rawData) {
    const date = new Date(row['Reporting Date'] * 1000)
    const rowYear = date.getFullYear()
    const rowMonth = date.getMonth() + 1 // 1-based

    let matches = false
    if (period.mode === 'month') {
      matches = rowYear === period.year && rowMonth === (period.month ?? 1)
    } else if (period.mode === 'quarter') {
      const q = period.quarter ?? 1
      const startMonth = (q - 1) * 3 + 1
      const endMonth = q * 3
      matches = rowYear === period.year && rowMonth >= startMonth && rowMonth <= endMonth
    } else {
      matches = rowYear === period.year
    }

    if (!matches) continue

    const rawCategory = String(row['DR_ACC_L1.5'] ?? '')
    const category = decodeHtml(rawCategory)
    if (EXCLUDED_CATEGORIES.has(category.toLowerCase())) continue

    const amount = Math.abs(Number(row['Amount'] ?? 0))
    sums.set(category, (sums.get(category) ?? 0) + amount)
  }

  return Array.from(sums.entries())
    .map(([category, amount]) => ({ category, amount }))
    .filter(item => item.amount > 0)
    .sort((a, b) => b.amount - a.amount)
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
    year: CURRENT_YEAR,
    quarter: 1,
  })
  const [rawData, setRawData] = useState<RawRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usingMock, setUsingMock] = useState(false)
  const hasFetched = useRef(false)

  // Fetch ALL data once on mount (no date filter — filter client-side)
  useEffect(() => {
    if (hasFetched.current) return
    hasFetched.current = true

    const fetchAll = async () => {
      setLoading(true)
      setError(null)
      setUsingMock(false)

      try {
        const data = await callMcpTool('aggregate_table_data', {
          table_id: '16528',
          dimensions: ['Reporting Date', 'DR_ACC_L1.5'],
          metrics: [{ field: 'Amount', agg: 'SUM' }],
          filters: [
            { name: 'Scenario', values: ['Actuals'], is_excluded: false },
            { name: 'DR_ACC_L0', values: ['P&L'], is_excluded: false },
          ],
        }) as RawRow[]

        if (!Array.isArray(data) || data.length === 0) throw new Error('No data returned')
        setRawData(data)
      } catch (err) {
        console.warn('API error, using mock data:', err)
        setError(err instanceof Error ? err.message : 'Failed to load data')
        setRawData(MOCK_RAW)
        setUsingMock(true)
      } finally {
        setLoading(false)
      }
    }

    fetchAll()
  }, [])

  // Filter & aggregate client-side whenever rawData or period changes
  useEffect(() => {
    if (rawData.length === 0) return
    setExpenses(filterAndAggregate(rawData, period))
  }, [rawData, period])

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
            {error && usingMock && (
              <p className="error-msg">Using demo data</p>
            )}
            <div className="summary-categories">
              <p className="summary-cat-count">{expenses.length} categories</p>
            </div>
          </div>

          <div className="chart-card">
            <h2 className="chart-title">Expenses by Category · {periodLabel(period)}</h2>
            {loading ? (
              <div className="chart-loading">
                <div className="spinner large" />
                <p>Loading data…</p>
              </div>
            ) : expenses.length === 0 ? (
              <div className="chart-loading">
                <p className="no-data">No expense data for this period</p>
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
