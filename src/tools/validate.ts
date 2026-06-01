import { exec, execSync } from "child_process"
import { recordValidation } from "./stats.js"
import { writeFile, unlink } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { promisify } from "util"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const _require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TSParser = _require("tree-sitter") as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const JavaGrammar = _require("tree-sitter-java") as any
const tsParser = new TSParser()
tsParser.setLanguage(JavaGrammar)

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

function analyzeStructure(code: string): DesignHint[] {
  let tree = tsParser.parse(code)
  if (tree.rootNode.hasError) {
    tree = tsParser.parse(`class _Tmp {\n${code}\n}`)
  }

  const hints: DesignHint[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const method of tree.rootNode.descendantsOfType("method_declaration") as any[]) {
    const name: string = method.childForFieldName("name")?.text ?? "unknown"
    const body = method.childForFieldName("body")
    if (!body) continue

    // 1. else-if chain
    const maxChain = calcElseIfChain(method)
    if (maxChain >= 4) {
      hints.push({
        method: name,
        smell: `${name}() 有 ${maxChain} 个 if-else 分支`,
        pattern: "Strategy / ChainOfResponsibility",
        reason: "多个同形状条件分支，后续新增规则需修改方法体，建议用策略模式或责任链解耦"
      })
    }

    // 2. instanceof chain（跳过 lambda 内部）
    const instCounts: Record<string, number> = {}
    collectInstanceofs(method, instCounts)
    for (const [varName, count] of Object.entries(instCounts)) {
      if (count >= 3) {
        hints.push({
          method: name,
          smell: `${name}() 对变量 "${varName}" 有 ${count} 处 instanceof 判断`,
          pattern: "Strategy / Visitor",
          reason: "对同一变量做多次类型判断，新增类型需修改此处，建议用策略或访问者模式"
        })
      }
    }

    // 3. 顺序 if-return（只看方法体直接子语句，不进 lambda）
    let guardCount = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const stmt of body.namedChildren as any[]) {
      if (
        stmt.type === "if_statement" &&
        stmt.namedChildren.length === 2 &&   // [condition, consequence]，无 else
        isSingleReturn(stmt.namedChildren[1])
      ) guardCount++
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function calcElseIfChain(method: any): number {
  let max = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const ifNode of method.descendantsOfType("if_statement") as any[]) {
    // 跳过作为 else-if 的节点（父节点是 if_statement 且排在 else 后）
    const parent = ifNode.parent
    if (parent?.type === "if_statement") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const elseIdx = (parent.children as any[]).findIndex((c: any) => c.type === "else")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (elseIdx >= 0 && (parent.children as any[]).indexOf(ifNode) > elseIdx) continue
    }
    max = Math.max(max, chainLength(ifNode))
  }
  return max
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chainLength(ifNode: any): number {
  let count = 1
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children = ifNode.children as any[]
  for (let i = 0; i < children.length; i++) {
    if (children[i].type === "else" && i + 1 < children.length && children[i + 1].type === "if_statement") {
      count += chainLength(children[i + 1])
      break
    }
  }
  return count
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectInstanceofs(node: any, counts: Record<string, number>) {
  if (node.type === "lambda_expression") return
  if (node.type === "instanceof_expression") {
    const varName: string = node.namedChildren[0]?.text ?? ""
    if (varName) counts[varName] = (counts[varName] ?? 0) + 1
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const child of node.children as any[]) collectInstanceofs(child, counts)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isSingleReturn(node: any): boolean {
  if (!node) return false
  if (node.type === "return_statement") return true
  if (node.type === "block") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stmts = node.namedChildren as any[]
    return stmts.length === 1 && stmts[0].type === "return_statement"
  }
  return false
}
