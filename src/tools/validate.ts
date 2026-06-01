import { exec, execSync } from "child_process"
import { recordValidation } from "./stats.js"
import { writeFile, unlink } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { promisify } from "util"
import { fileURLToPath } from "url"

const execAsync = promisify(exec)

const ROOT         = join(fileURLToPath(import.meta.url), "../../../")
const CS_DEPS      = join(ROOT, "bin/deps/*")
const CS_CONF      = join(ROOT, "rules/basic.xml")
const PMD_DEPS     = join(ROOT, "bin/pmd-deps/*")
const PMD_CONF     = join(ROOT, "rules/pmd-basic.xml")
function resolveJavaBin(): string {
  if (process.env.JAVA11_HOME) return join(process.env.JAVA11_HOME, "bin/java")
  if (process.env.JAVA_HOME)   return join(process.env.JAVA_HOME,   "bin/java")
  try {
    const cmd = process.platform === "win32" ? "where java" : "which java"
    return execSync(cmd, { encoding: "utf-8" }).trim().split("\n")[0]
  } catch {
    throw new Error("找不到 Java，请在 .mcp.json 的 env 中配置 JAVA_HOME 或 JAVA11_HOME")
  }
}
const JAVA_BIN = resolveJavaBin()

interface Violation {
  severity: string
  line: number
  message: string
  rule: string
}

interface DesignHint {
  method: string
  smell: string
  pattern: string
  reason: string
}

export async function validateCode(code: string) {
  const tmp = join(tmpdir(), `cq_${Date.now()}.java`)
  try {
    await writeFile(tmp, code, "utf-8")

    const [csViolations, pmdViolations] = await Promise.all([
      runCheckstyle(tmp),
      runPmd(tmp),
    ])

    const violations = [...csViolations, ...pmdViolations]
      .sort((a, b) => a.line - b.line)
    const design_hints = analyzeStructure(code)
    const result = { passed: violations.length === 0, violations, design_hints }
    recordValidation(result)
    return result
  } finally {
    await unlink(tmp).catch(() => {})
  }
}

async function runCheckstyle(file: string): Promise<Violation[]> {
  const output = await execAsync(
    `"${JAVA_BIN}" -cp "${CS_DEPS}" com.puppycrawl.tools.checkstyle.Main -c "${CS_CONF}" "${file}"`,
    { timeout: 15_000 }
  )
    .then(r => r.stdout + r.stderr)
    .catch(e  => (e.stdout ?? "") + (e.stderr ?? ""))

  return output
    .split("\n")
    .map((line: string) => {
      const m = line.match(/\[(ERROR|WARN)\]\s+.+?:(\d+)(?::\d+)?:\s+(.+?)(?:\s+\[(\w+)\])?$/)
      if (!m) return null
      return {
        severity: m[1].toLowerCase(),
        line: parseInt(m[2]),
        message: m[3].trim(),
        rule: m[4] ?? "unknown"
      } as Violation
    })
    .filter((v: Violation | null): v is Violation => v !== null)
}

async function runPmd(file: string): Promise<Violation[]> {
  const xml = await execAsync(
    `"${JAVA_BIN}" -cp "${PMD_DEPS}" net.sourceforge.pmd.cli.PmdCli check --dir "${file}" --rulesets "${PMD_CONF}" --format xml --no-fail-on-violation`,
    { timeout: 20_000 }
  )
    .then(r => r.stdout)
    .catch(e  => e.stdout ?? "")

  const violations: Violation[] = []
  const re = /<violation\s+[^>]*beginline="(\d+)"[^>]*rule="([^"]+)"[^>]*priority="(\d+)"[^>]*>([\s\S]*?)<\/violation>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const priority = parseInt(m[3])
    violations.push({
      severity: priority <= 2 ? "error" : "warn",
      line: parseInt(m[1]),
      message: m[4].trim(),
      rule: m[2],
    })
  }
  return violations
}

function extractMethods(code: string): Array<{ name: string; body: string }> {
  const KEYWORDS = new Set(["if", "for", "while", "switch", "try", "catch", "else", "synchronized", "do"])
  const results: Array<{ name: string; body: string }> = []
  const re = /\b([a-zA-Z_]\w*)\s*\([^)]*\)\s*(?:throws\s+[\w\s,]+)?\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    const name = m[1]
    if (KEYWORDS.has(name)) continue
    const start = m.index + m[0].length - 1
    let depth = 1, i = start + 1
    while (i < code.length && depth > 0) {
      if (code[i] === "{") depth++
      else if (code[i] === "}") depth--
      i++
    }
    results.push({ name, body: code.slice(start + 1, i - 1) })
  }
  return results
}

function analyzeStructure(code: string): DesignHint[] {
  const hints: DesignHint[] = []
  for (const { name, body } of extractMethods(code)) {

    // else-if chain >= 3 → 4+ 个分支
    const elseIfCount = (body.match(/\belse\s+if\s*\(/g) ?? []).length
    if (elseIfCount >= 3) {
      hints.push({
        method: name,
        smell: `${name}() 有 ${elseIfCount + 1} 个 if-else 分支`,
        pattern: "Strategy / ChainOfResponsibility",
        reason: "多个同形状条件分支，后续新增规则需修改方法体，建议用策略模式或责任链解耦"
      })
    }

    // 同一变量 instanceof >= 3 次
    const instMatches = [...body.matchAll(/\b(\w+)\s+instanceof\s+\w+/g)]
    const varCounts: Record<string, number> = {}
    for (const im of instMatches) varCounts[im[1]] = (varCounts[im[1]] ?? 0) + 1
    for (const [varName, count] of Object.entries(varCounts)) {
      if (count >= 3) {
        hints.push({
          method: name,
          smell: `${name}() 对变量 "${varName}" 有 ${count} 处 instanceof 判断`,
          pattern: "Strategy / Visitor",
          reason: "对同一变量做多次类型判断，新增类型需修改此处，建议用策略或访问者模式"
        })
      }
    }

    // 顺序 if-return 校验步骤 >= 3 → 责任链
    const lines = body.split("\n")
    let guardCount = 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      const next = (lines[i + 1] ?? "").trim()
      if (/^if\s*\(.*\)\s*return\b/.test(line)) guardCount++
      else if (/^if\s*\(/.test(line) && /^return\b/.test(next)) guardCount++
    }
    if (guardCount >= 3) {
      hints.push({
        method: name,
        smell: `${name}() 有 ${guardCount} 个顺序 if-return 校验步骤`,
        pattern: "ChainOfResponsibility",
        reason: "多个独立的顺序校验步骤，每步可单独扩展，建议用责任链模式"
      })
    }
  }
  return hints
}
