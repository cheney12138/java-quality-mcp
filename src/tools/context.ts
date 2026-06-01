import { listFlavors } from "./flavor.js"

const RULES = `
# 代码规范约束（Alibaba Java 开发手册强制条目）

## 命名规范
- 标识符不能以下划线或 $ 开头或结尾，如 _name / name_ / $name
- 类名使用 UpperCamelCase，如 UserService
- 方法名、变量名使用 lowerCamelCase，如 getUserById
- 常量全大写加下划线，如 MAX_COUNT
- Boolean 变量不能以 is 开头，序列化框架会导致字段丢失，如 isSuccess → success
- 禁止用 a/b/c 等无意义变量名

## 常量规范
- 禁止魔法字符串直接使用，应定义为常量
- long 型字面量必须用大写 L，如 100l → 100L

## 格式规范
- 缩进使用 4 个空格，禁止 Tab 字符

## OOP 规范
- equals() 调用方应是常量或确定非 null 的一侧，如 "abc".equals(str)
- 包装类型之间比较必须用 equals()，不能用 ==
- POJO 字段必须使用包装类型（Integer 而非 int），RPC 返回中基本类型默认值含义不明确
- POJO 字段不能设置默认值，由序列化框架或调用方赋值

## 集合规范
- 禁止在 foreach 循环中执行 remove 或 add 操作，会抛 ConcurrentModificationException

## 并发规范
- 禁止直接 new Thread()，应使用线程池
- 禁止 Executors.newXxx()，应使用 ThreadPoolExecutor 并显式指定参数
- SimpleDateFormat 不能声明为 static 字段，线程不安全
- ThreadLocal 使用后必须调用 remove()，防止内存泄漏

## 控制语句
- switch 必须包含 default 分支
- if/for/while 的代码体必须用花括号包裹，单行也不例外
- 单个方法不超过 80 行
- 参数不超过 5 个，超出应封装为对象
- if/for/while 嵌套不超过 3 层，超出用卫语句或抽取方法

## 注释规范
- public 方法必须有 Javadoc（/** */ 格式）
- 禁止无意义注释，如注释内容与代码完全重复

## 异常规范
- catch 块不能为空，必须处理或记录异常
- 必须打印完整异常栈，如 log.error("msg", e)，不能只打 e.getMessage()
- finally 块中禁止使用 return，会覆盖 try 中的返回值

## 日志规范
- 必须使用 SLF4J，禁止直接使用 Log4j/Logback API
- debug/info 日志禁止字符串拼接，使用占位符 {}，如 log.info("user:{}", id)

## ORM 规范
- Mapper/DAO 返回值禁止使用 HashMap，字段变更导致隐性错误

## 安全规范
- 禁止 SQL 字符串拼接，防止 SQL 注入，使用参数化查询
`

export async function getStyleContext({ file_path, intent }: {
  file_path: string
  intent?: string
}) {
  const bad  = await listFlavors({ label: "bad"  })
  const good = await listFlavors({ label: "good" })

  return {
    active_ruleset: "alibaba-basic",
    rules: RULES,
    flavor: {
      bad:  bad.slice(0, 5),
      good: good.slice(0, 5)
    },
    instruction: "生成代码必须遵守以上规范，并参考 bad 样本的反面教训。代码生成完毕后调用 validate_code 自检，有违规则修正后再输出给用户。"
  }
}
