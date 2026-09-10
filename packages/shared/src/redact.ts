// 敏感信息脱敏工具(pure function,零依赖,可独立测试)
// 规则:
// ① JSON 键 apiKey/authorization/password/token/secret(大小写不敏感,对象/数组任意深度)→ 值替换为 "***"
//    若值是字符串且内部再嵌套 JSON,其敏感键同样命中
// ② Bearer / Basic HTTP 头凭证值 → "***"
// ③ 以 sk- 开头且总长 ≥ 8 的令牌 → "***"
// ④ URL query 中 key/token/secret/apiKey 参数值 → "***"

const MASK = "***";

/** 敏感 JSON 键(统一小写 + 下划线归一化后比较) */
const SENSITIVE_JSON_KEYS = new Set([
  "apikey",
  "api_key",
  "authorization",
  "password",
  "token",
  "secret",
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_JSON_KEYS.has(key.toLowerCase().replace(/[-\s]/g, "_"));
}

/** 规则②:Bearer/Basic HTTP 头凭证值 */
const BEARER_RE = /\b((?:Bearer|Basic)\s+)([A-Za-z0-9.+/_-]{1,}?)(?=[^A-Za-z0-9.+/_-]|$)/gi;

/** 规则③:sk- 开头且总长 ≥ 8 的令牌 */
const SK_RE = /\bsk-[A-Za-z0-9_-]{5,}\b/g;

/** 规则④:URL query 中的敏感参数值 */
const QUERY_RE = /(?=[?&])([?&][^&\s"'\n]*?(?:key|token|secret|api[_-]?key)\s*=\s*)([^&\s"'\n]+)(?=[&\s"'\n]|$)/gim

/** 规则②③④的组合顺序:先头凭证、再 query、最后令牌 */
function redactPlain(s: string): string {
  return s
    .replace(BEARER_RE, (_m, prefix: string) => prefix + MASK)
    .replace(QUERY_RE, (_m, kv: string, val: string) => kv + MASK)
    .replace(SK_RE, MASK);
}

/**
 * 规则①:递归脱敏 JSON 结构。
 * 命中敏感键 → 值替换为 "***"(不深入,避免误伤)
 * 敏感键之外的字符串值 → 先按 plain 规则扫,再把解析成功且"对象/数组"含义的
 * 嵌套 JSON 字符串重新序列化回字符串(保证嵌套 JSON 字符串内的敏感键同样命中)
 */
function redactDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDeep);
  if (typeof value === "string") {
    let out = redactPlain(value);
    // 尝试把"字符串值里嵌套的 JSON"再脱敏一层
    const trimmed = out.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const nested: unknown = JSON.parse(trimmed);
        if (typeof nested === "object" && nested !== null) {
          out = JSON.stringify(redactDeep(nested));
        }
      } catch {
        // 非合法 JSON,保持 plain 脱敏结果
      }
    }
    return out;
  }
  if (typeof value === "object" && value !== null) {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        res[k] = MASK;
      } else {
        res[k] = redactDeep(v);
      }
    }
    return res;
  }
  return value;
}

/**
 * 脱敏入口:对输入字符串应用全部规则,返回新字符串。
 * 若整串是合法 JSON 对象/数组,先走深度脱敏;否则直接做 plain 规则。
 */
export function redact(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const v: unknown = JSON.parse(trimmed);
      if (typeof v === "object" && v !== null) {
        // 保留原始前后空白/换行的近似形态(仅替换 body)
        const head = input.slice(0, input.length - trimmed.length); // 前导空白
        const body = JSON.stringify(redactDeep(v));
        return head + body;
      }
    } catch {
      // 不是合法 JSON,退回 plain
    }
  }
  return redactPlain(input);
}
