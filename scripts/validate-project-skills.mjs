import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const skillsRoot = "skills";
const namePattern = /^[a-z0-9-]{1,63}$/;
const failures = [];

function fail(skill, message) {
  failures.push(`${skill}: ${message}`);
}

function parseFrontmatter(skillName, text) {
  if (!text.startsWith("---\n")) {
    fail(skillName, "SKILL.md must start with YAML frontmatter");
    return null;
  }

  const end = text.indexOf("\n---\n", 4);
  if (end === -1) {
    fail(skillName, "SKILL.md frontmatter must be closed with ---");
    return null;
  }

  const raw = text.slice(4, end).trim();
  const body = text.slice(end + 5).trim();
  const fields = new Map();

  for (const line of raw.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      fail(skillName, `invalid frontmatter line: ${line}`);
      continue;
    }
    fields.set(match[1], match[2].replace(/^['\"]|['\"]$/g, ""));
  }

  return { fields, body };
}

if (!existsSync(skillsRoot)) {
  throw new Error("skills/ directory is missing");
}

for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }

  const skillName = entry.name;
  const skillDir = join(skillsRoot, skillName);
  const skillPath = join(skillDir, "SKILL.md");
  const agentPath = join(skillDir, "agents", "openai.yaml");

  if (!namePattern.test(skillName)) {
    fail(skillName, "directory name must be lowercase hyphen-case and under 64 chars");
  }
  if (!existsSync(skillPath)) {
    fail(skillName, "missing SKILL.md");
    continue;
  }
  if (!existsSync(agentPath)) {
    fail(skillName, "missing agents/openai.yaml");
  }

  const text = readFileSync(skillPath, "utf8");
  const parsed = parseFrontmatter(skillName, text);
  if (!parsed) {
    continue;
  }

  const frontmatterKeys = [...parsed.fields.keys()].sort();
  const allowedKeys = ["description", "name"];
  if (frontmatterKeys.join(",") !== allowedKeys.join(",")) {
    fail(skillName, `frontmatter keys must be exactly name and description, got ${frontmatterKeys.join(",")}`);
  }

  const name = parsed.fields.get("name");
  const description = parsed.fields.get("description");
  if (name !== skillName) {
    fail(skillName, `frontmatter name '${name}' must match directory name`);
  }
  if (!description || description.length < 40) {
    fail(skillName, "description must be specific and non-empty");
  }
  if (/TODO|\[TODO\]/.test(text)) {
    fail(skillName, "SKILL.md still contains TODO placeholder text");
  }
  if (!parsed.body.startsWith(`# `)) {
    fail(skillName, "body must start with an H1 heading");
  }

  if (existsSync(agentPath)) {
    const agentText = readFileSync(agentPath, "utf8");
    if (!agentText.includes(`$${skillName}`)) {
      fail(skillName, "agents/openai.yaml default_prompt should mention the skill name");
    }
  }
}

if (failures.length > 0) {
  console.error("Skill validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Validated ${readdirSync(skillsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length} skills.`);
