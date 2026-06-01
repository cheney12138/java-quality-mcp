import Database from "better-sqlite3"
import { join } from "path"
import { homedir } from "os"
import { mkdirSync } from "fs"

const DIR = join(homedir(), ".code-quality-mcp")
mkdirSync(DIR, { recursive: true })

const db = new Database(join(DIR, "flavor.db"))
db.exec(`
  CREATE TABLE IF NOT EXISTS validations (
    id             TEXT PRIMARY KEY,
    ts             INTEGER DEFAULT (unixepoch()),
    violations     INTEGER NOT NULL,
    rules          TEXT NOT NULL,
    hints          INTEGER NOT NULL,
    passed         INTEGER NOT NULL
  )
`)

export function recordValidation(result: {
  violations: Array<{ rule: string }>
  design_hints: Array<unknown>
}) {
  const id = `v_${Date.now()}`
  const rules = JSON.stringify(result.violations.map(v => v.rule))
  db.prepare("INSERT INTO validations (id,violations,rules,hints,passed) VALUES (?,?,?,?,?)")
    .run(id, result.violations.length, rules, result.design_hints.length, result.violations.length === 0 ? 1 : 0)
}

export function getReport() {
  const total = (db.prepare("SELECT COUNT(*) as n FROM validations").get() as { n: number }).n
  if (total === 0) return { message: "暂无数据，使用 validate_code 后自动积累" }

  const passed = (db.prepare("SELECT COUNT(*) as n FROM validations WHERE passed=1").get() as { n: number }).n
  const totalViolations = (db.prepare("SELECT SUM(violations) as n FROM validations").get() as { n: number }).n
  const totalHints = (db.prepare("SELECT SUM(hints) as n FROM validations").get() as { n: number }).n

  // 最高频违规规则 top5
  const rows = db.prepare("SELECT rules FROM validations WHERE rules != '[]'").all() as { rules: string }[]
  const ruleCount: Record<string, number> = {}
  for (const row of rows) {
    for (const rule of JSON.parse(row.rules) as string[]) {
      ruleCount[rule] = (ruleCount[rule] ?? 0) + 1
    }
  }
  const topRules = Object.entries(ruleCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([rule, count]) => ({ rule, count }))

  // 近 7 天 vs 上 7 天首次 pass 率趋势
  const now = Math.floor(Date.now() / 1000)
  const day7 = now - 7 * 86400
  const day14 = now - 14 * 86400

  const recent = db.prepare("SELECT COUNT(*) as total, SUM(passed) as p FROM validations WHERE ts >= ?").get(day7) as { total: number; p: number }
  const prev   = db.prepare("SELECT COUNT(*) as total, SUM(passed) as p FROM validations WHERE ts >= ? AND ts < ?").get(day14, day7) as { total: number; p: number }

  const recentRate = recent.total > 0 ? Math.round((recent.p / recent.total) * 100) : null
  const prevRate   = prev.total   > 0 ? Math.round((prev.p   / prev.total)   * 100) : null

  return {
    total_sessions: total,
    total_violations_caught: totalViolations,
    total_design_hints: totalHints,
    pass_rate: `${Math.round((passed / total) * 100)}%`,
    top_violated_rules: topRules,
    trend: {
      recent_7d: recentRate !== null ? `${recentRate}%` : "数据不足",
      prev_7d:   prevRate   !== null ? `${prevRate}%`   : "数据不足",
      direction: recentRate !== null && prevRate !== null
        ? recentRate > prevRate ? "↑ 提升" : recentRate < prevRate ? "↓ 下降" : "→ 持平"
        : "数据不足"
    }
  }
}
