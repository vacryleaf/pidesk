// M2 skills 存储层测试:临时目录,覆盖 list/import/setEnabled/remove/frontmatter 解析。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importSkill, listSkills, parseFrontmatter, removeSkill, setSkillEnabled } from "./skills-store";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "pidesk-skills-store-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function makeSourceSkill(name: string, frontmatter = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "pidesk-skill-src-"));
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `${frontmatter}# ${name}\nbody\n`,
    "utf8",
  );
  return skillDir;
}

describe("skills-store", () => {
  it("空数据目录 → listSkills 返回空数组", () => {
    expect(listSkills(dataDir)).toEqual([]);
  });

  it("importSkill 成功导入并返回最新 list", () => {
    const src = makeSourceSkill("my-skill", "---\nname: My Skill\ndescription: Does things\n---\n");
    const skills = importSkill(dataDir, src);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: "my-skill",
      name: "My Skill",
      description: "Does things",
      enabled: true,
      hasSkillFile: true,
    });
  });

  it("importSkill 重复导入(启用目录已存在)→ 抛错", () => {
    const src = makeSourceSkill("dup-skill");
    importSkill(dataDir, src);
    expect(() => importSkill(dataDir, src)).toThrow(/已存在/);
  });

  it("importSkill 源目录无 SKILL.md → 抛错", () => {
    const dir = mkdtempSync(join(tmpdir(), "pidesk-skill-nofile-"));
    expect(() => importSkill(dataDir, dir)).toThrow(/SKILL\.md/);
  });

  it("importSkill 源目录不存在 → 抛错", () => {
    expect(() => importSkill(dataDir, join(dataDir, "nope"))).toThrow(/不存在/);
  });

  it("importSkill 清洗非法字符:保留 [A-Za-z0-9._-]", () => {
    const src = makeSourceSkill("bad name!x");
    const skills = importSkill(dataDir, src);
    expect(skills[0]!.id).toBe("badnamex");
  });

  it("setEnabled true→false 移到 skills-disabled,false→true 移回", () => {
    const src = makeSourceSkill("toggle-skill");
    importSkill(dataDir, src);

    let skills = setSkillEnabled(dataDir, "toggle-skill", false);
    expect(skills.find((s) => s.id === "toggle-skill")!.enabled).toBe(false);

    skills = setSkillEnabled(dataDir, "toggle-skill", true);
    expect(skills.find((s) => s.id === "toggle-skill")!.enabled).toBe(true);
  });

  it("setEnabled 不存在的 id → 抛错", () => {
    expect(() => setSkillEnabled(dataDir, "ghost", false)).toThrow(/不存在/);
  });

  it("removeSkill 清理两个目录中的该 id", () => {
    const src = makeSourceSkill("gone-skill");
    importSkill(dataDir, src);
    setSkillEnabled(dataDir, "gone-skill", false);

    const skills = removeSkill(dataDir, "gone-skill");
    expect(skills).toHaveLength(0);
    expect(listSkills(dataDir)).toHaveLength(0);
  });

  it("listSkills 按 id 字典序,enabled 分别为 true/false,无 SKILL.md 也列出", () => {
    const enabledRoot = join(dataDir, "pi-agent", "skills");
    const disabledRoot = join(dataDir, "pi-agent", "skills-disabled");
    mkdirSync(join(enabledRoot, "b-skill"), { recursive: true });
    writeFileSync(
      join(enabledRoot, "b-skill", "SKILL.md"),
      "---\nname: B\ndescription: Bee\n---\n",
      "utf8",
    );
    mkdirSync(join(disabledRoot, "a-skill"), { recursive: true });
    mkdirSync(join(enabledRoot, "c-skill"), { recursive: true }); // 无 SKILL.md

    const skills = listSkills(dataDir);
    expect(skills.map((s) => s.id)).toEqual(["a-skill", "b-skill", "c-skill"]);
    expect(skills[0]).toMatchObject({ name: "a-skill", enabled: false, hasSkillFile: false });
    expect(skills[1]).toMatchObject({ name: "B", description: "Bee", enabled: true, hasSkillFile: true });
    expect(skills[2]).toMatchObject({ name: "c-skill", enabled: true, hasSkillFile: false });
  });

  it("frontmatter 解析:name/description 容错", () => {
    expect(parseFrontmatter("---\nname: X\ndescription: Y\n---\n")).toEqual({ name: "X", description: "Y" });
    expect(parseFrontmatter("---\ndescription: only-desc\n---\n")).toEqual({ description: "only-desc" });
    expect(parseFrontmatter("no frontmatter")).toEqual({});
    expect(parseFrontmatter("---\nname: 'quoted'\n---\n")).toEqual({ name: "quoted" });
    expect(parseFrontmatter("---\nname:\n---\n")).toEqual({});
  });
});
