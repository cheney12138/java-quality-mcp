import Database from "better-sqlite3"
import { join } from "path"
import { homedir } from "os"
import { mkdirSync } from "fs"

const DIR = join(homedir(), ".code-quality-mcp")
mkdirSync(DIR, { recursive: true })

const db = new Database(join(DIR, "flavor.db"))
db.exec(`
  CREATE TABLE IF NOT EXISTS flavors (
    id       TEXT PRIMARY KEY,
    label    TEXT NOT NULL,
    code     TEXT NOT NULL,
    note     TEXT NOT NULL,
    tags     TEXT NOT NULL DEFAULT '[]',
    created  INTEGER DEFAULT (unixepoch())
  )
`)

interface FlavorRow {
  id: string
  label: string
  code: string
  note: string
  tags: string
  created: number
}

export async function addFlavor({ code, label, note, tags = [] }: {
  code: string
  label: "good" | "bad"
  note: string
  tags?: string[]
}) {
  const id = `f_${Date.now()}`
  db.prepare("INSERT INTO flavors (id,label,code,note,tags) VALUES (?,?,?,?,?)")
    .run(id, label, code, note, JSON.stringify(tags))
  return `已记录 [${label}] 样本 id=${id}：${note}`
}

export async function listFlavors({ label, tags }: {
  label?: "good" | "bad"
  tags?: string[]
} = {}) {
  const rows = db.prepare(
    label
      ? "SELECT * FROM flavors WHERE label=? ORDER BY created DESC"
      : "SELECT * FROM flavors ORDER BY created DESC"
  ).all(...(label ? [label] : [])) as FlavorRow[]

  const parsed = rows.map(r => ({ ...r, tags: JSON.parse(r.tags) as string[] }))

  if (tags?.length) {
    return parsed.filter(r => tags.some(t => r.tags.includes(t)))
  }
  return parsed
}

export async function deleteFlavor(id: string) {
  const r = db.prepare("DELETE FROM flavors WHERE id=?").run(id)
  return r.changes > 0 ? `已删除 ${id}` : `未找到 ${id}`
}
