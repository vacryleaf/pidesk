// M2 skills 存储层(纯存储,不含 UI/IPC):
// - 启用根:<dataDir>/pi-agent/skills/;停用根:<dataDir>/pi-agent/skills-disabled/
// - 每个 skill 一个目录,根下 SKILL.md
// - frontmatter 仅简单识别首行 `---` 到下一个 `---` 之间的 name:/description:,容错处理

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, join } from "node:path";
import type { SkillInfo } from "@pidesk/shared";

const SKILL_FILE = "SKILL.md";

function skillsRoot(dataDir: string): string {
  return join(dataDir, "pi-agent", "skills");
}

function skillsDisabledRoot(dataDir: string): string {
  return join(dataDir, "pi-agent", "skills-disabled");
}

function ensureRoot(root: string): void {
  mkdirSync(root, { recursive: true });
}

/** 清洗非法字符:只保留 [A-Za-z0-9._-];全空则抛错 */
function sanitizeId(raw: string): string {
  const id = [...raw].filter((ch) => /[A-Za-z0-9._-]/.test(ch)).join("");
  if (!id) {
    throw new Error(`skills: 无效的 skill 目录名: "${raw}"`);
  }
  return id;
}

/** 简单 frontmatter 解析:仅识别首行 `---` 到下一个 `---` 之间的 name:/description: */
export function parseFrontmatter(content: string): { name?: string; description?: string } {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return {};
  }
  let name: string | undefined;
  let description: string | undefined;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "---") {
      break;
    }
    const nameMatch = /^name:\s*(.*)$/.exec(line);
    if (nameMatch) {
      const v = nameMatch[1]!.trim().replace(/^["']|["']$/g, "");
      if (v && name === undefined) {
        name = v;
      }
      continue;
    }
    const descMatch = /^description:\s*(.*)$/.exec(line);
    if (descMatch) {
      const v = descMatch[1]!.trim().replace(/^["']|["']$/g, "");
      if (v && description === undefined) {
        description = v;
      }
    }
  }
  return { name, description };
}

function readSkillMeta(dir: string): { name?: string; description?: string; hasSkillFile: boolean } {
  const file = join(dir, SKILL_FILE);
  if (!existsSync(file) || !statSync(file).isFile()) {
    return { hasSkillFile: false };
  }
  try {
    return { ...parseFrontmatter(readFileSync(file, "utf8")), hasSkillFile: true };
  } catch {
    return { hasSkillFile: true };
  }
}

/** 扫描单个根目录,返回该目录下的 skill 列表(enabled 统一由调用方设置) */
function scanRoot(root: string, enabled: boolean): SkillInfo[] {
  if (!existsSync(root)) {
    return [];
  }
  const out: SkillInfo[] = [];
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    if (!statSync(dir).isDirectory()) {
      continue;
    }
    const meta = readSkillMeta(dir);
    out.push({
      id: entry,
      name: meta.name ?? entry,
      description: meta.description,
      enabled,
      hasSkillFile: meta.hasSkillFile,
    });
  }
  return out;
}

/** 列出全部 skills:扫两个目录,按 id 字典序 */
export function listSkills(dataDir: string): SkillInfo[] {
  const all = [...scanRoot(skillsRoot(dataDir), true), ...scanRoot(skillsDisabledRoot(dataDir), false)];
  all.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return all;
}

/** 从 sourceDir 导入 skill 到启用目录;返回最新 list */
export function importSkill(dataDir: string, sourceDir: string): SkillInfo[] {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new Error(`skills: 源目录不存在: ${sourceDir}`);
  }
  if (!existsSync(join(sourceDir, SKILL_FILE))) {
    throw new Error(`skills: 源目录缺少 ${SKILL_FILE}: ${sourceDir}`);
  }
  const id = sanitizeId(basename(sourceDir));
  const dest = join(skillsRoot(dataDir), id);
  if (existsSync(join(skillsRoot(dataDir), id)) || existsSync(join(skillsDisabledRoot(dataDir), id))) {
    throw new Error(`skills: skill 已存在: ${id}`);
  }
  ensureRoot(skillsRoot(dataDir));
  cpSync(sourceDir, dest, { recursive: true });
  return listSkills(dataDir);
}

/** 启用/停用:在 skills/ 与 skills-disabled/ 间 rename;返回最新 list */
export function setSkillEnabled(dataDir: string, id: string, enabled: boolean): SkillInfo[] {
  const from = enabled
    ? join(skillsDisabledRoot(dataDir), id)
    : join(skillsRoot(dataDir), id);
  const to = enabled
    ? join(skillsRoot(dataDir), id)
    : join(skillsDisabledRoot(dataDir), id);
  ensureRoot(skillsRoot(dataDir));
  ensureRoot(skillsDisabledRoot(dataDir));
  if (!existsSync(from)) {
    throw new Error(`skills: skill 不存在: ${id}`);
  }
  renameSync(from, to);
  return listSkills(dataDir);
}

/** 删除 skill(两个根都清理);返回最新 list */
export function removeSkill(dataDir: string, id: string): SkillInfo[] {
  rmSync(join(skillsRoot(dataDir), id), { recursive: true, force: true });
  rmSync(join(skillsDisabledRoot(dataDir), id), { recursive: true, force: true });
  return listSkills(dataDir);
}
