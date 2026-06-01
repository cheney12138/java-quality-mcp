#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { validateCode } from "./tools/validate.js"
import { addFlavor, listFlavors, deleteFlavor } from "./tools/flavor.js"
import { getStyleContext } from "./tools/context.js"
import { getReport } from "./tools/stats.js"

const server = new McpServer({ name: "code-quality", version: "0.1.0" })

server.tool(
  "get_style_context",
  "AI 生成 Java 代码前必须调用。返回激活的规范约束 + 用户记录的 good/bad 风格样本，作为生成约束。",
  {
    file_path: z.string().describe("当前编辑的文件路径"),
    intent: z.string().optional().describe("本次要实现的功能，如「实现优惠券校验逻辑」")
  },
  async (args) => {
    const result = await getStyleContext(args)
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  "validate_code",
  "校验 Java 代码是否符合规范，返回违规列表。AI 生成代码后必须调用自检，有违规则修正后再输出给用户。",
  {
    code: z.string().describe("待校验的完整 Java 代码片段")
  },
  async ({ code }) => {
    const result = await validateCode(code)
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  "flavor_add",
  "记录一段代码为 good 或 bad 风格样本，丰富项目专属规则。用户通过 /code-flavor-good 或 /code-flavor-bad 命令触发。",
  {
    code: z.string(),
    label: z.enum(["good", "bad"]),
    note: z.string().describe("说明原因，必填，如：嵌套超过3层，应改用卫语句"),
    tags: z.array(z.string()).optional().describe("标签，如 ['校验逻辑', '异常处理']")
  },
  async (args) => {
    const msg = await addFlavor(args)
    return { content: [{ type: "text", text: msg }] }
  }
)

server.tool(
  "flavor_list",
  "列出已记录的风格样本",
  {
    label: z.enum(["good", "bad"]).optional(),
    tags: z.array(z.string()).optional()
  },
  async (args) => {
    const rows = await listFlavors(args)
    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] }
  }
)

server.tool(
  "flavor_delete",
  "删除一条风格样本",
  {
    id: z.string().describe("样本 id，从 flavor_list 获取")
  },
  async ({ id }) => {
    const msg = await deleteFlavor(id)
    return { content: [{ type: "text", text: msg }] }
  }
)

server.tool(
  "get_quality_report",
  "生成代码质量统计报告，展示累计拦截违规数、最高频违规规则、首次 pass 率趋势等指标。",
  {},
  async () => {
    const result = await getReport()
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
  }
)

const transport = new StdioServerTransport()
await server.connect(transport)
