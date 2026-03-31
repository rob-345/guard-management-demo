#!/usr/bin/env node

import { promises as fs } from "fs";
import path from "path";

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, "docs/bruno/hikvision-value-series-isapi");
const TARGET_DIR = path.join(ROOT, "docs/bruno/hikvision-value-series-isapi-opencollection");

const FOLDERS = [
  { dir: "00-discovery", name: "00 Discovery", seq: 1 },
  { dir: "01-status-events", name: "01 Status Events", seq: 2 },
  { dir: "02-anti-tamper", name: "02 Anti Tamper", seq: 3 },
  { dir: "03-snapshot", name: "03 Snapshot", seq: 4 },
  { dir: "90-enrollment-push", name: "90 Enrollment Push", seq: 5 },
];

const ENV_VARS = [
  ["device_host", "192.168.0.179", false],
  ["username", "admin", false],
  ["password", "", true],
  ["track_stream_id", "1", false],
  ["security", "", true],
  ["iv", "", true],
  ["employee_no", "EMP-1022", false],
  ["person_name", "Jane Doe", false],
  ["face_url", "http://127.0.0.1:9000/faces/jane-doe.jpg", false],
  ["fdid", "1", false],
  ["face_mode", "normalMode", false],
  ["event_search_id", "codex-live-check", false],
  ["event_search_position", "0", false],
  ["event_max_results", "1", false],
  ["event_major", "1", false],
  ["event_minor", "1024", false],
  ["challenge_modulus_b64", "", true],
  ["activation_password_payload", "", true],
];

function yamlString(value) {
  return JSON.stringify(String(value));
}

function indent(text, spaces) {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n");
}

function parseKeyValueLines(lines) {
  const entries = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    entries.push([key, value]);
  }
  return entries;
}

function updateBodyDepth(depth, line) {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "{" && line[i + 1] === "{") {
      const end = line.indexOf("}}", i + 2);
      if (end === -1) {
        break;
      }
      i = end + 1;
      continue;
    }

    if (line[i] === "{") {
      depth += 1;
      continue;
    }

    if (line[i] === "}") {
      depth -= 1;
    }
  }

  return depth;
}

function parseBruRequest(content) {
  const lines = content.split(/\r?\n/);
  const result = {
    name: "",
    type: "http",
    seq: 0,
    tags: [],
    method: "GET",
    url: "",
    params: [],
    headers: [],
    authType: "inherit",
    authFields: {},
    bodyType: "none",
    bodyData: "",
    bodyMultipart: [],
  };

  let current = null;
  let blockLines = [];
  let bodyDepth = 0;

  const flush = () => {
    if (!current) return;

    const entries = parseKeyValueLines(blockLines);

    if (current === "meta") {
      for (const [key, value] of entries) {
        if (key === "name") result.name = value;
        if (key === "type") result.type = value;
        if (key === "seq") result.seq = Number(value);
        if (key === "tags") {
          // not used in this collection
        }
      }
    } else if (current === "method") {
      for (const [key, value] of entries) {
        if (key === "url") result.url = value;
        if (key === "body") result.bodyType = value || "none";
        if (key === "auth") result.authType = value || "inherit";
      }
    } else if (current === "params:query") {
      result.params = entries.map(([name, value]) => ({
        name,
        value,
        type: "query",
      }));
    } else if (current === "headers") {
      result.headers = entries.map(([name, value]) => ({
        name,
        value,
      }));
    } else if (current.startsWith("auth:")) {
      result.authType = current.slice("auth:".length);
      result.authFields = Object.fromEntries(entries);
    } else if (current.startsWith("body:")) {
      result.bodyType = current.slice("body:".length);
      if (result.bodyType === "multipart-form" || result.bodyType === "form-urlencoded") {
        result.bodyMultipart = entries.map(([name, value]) => ({
          name,
          value,
        }));
      } else {
        result.bodyData = blockLines.join("\n").trim();
      }
    }

    current = null;
    blockLines = [];
    bodyDepth = 0;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!current) {
      if (!line) continue;
      const start = line.match(/^(meta|params:query|headers|auth:[\w-]+|body:[\w-]+|get|post|put|patch|delete|options|head|trace|connect)\s*\{$/i);
      if (start) {
        current = start[1].toLowerCase();
        if (["get", "post", "put", "patch", "delete", "options", "head", "trace", "connect"].includes(current)) {
          result.method = current.toUpperCase();
          current = "method";
        } else if (current.startsWith("body:")) {
          bodyDepth = 1;
        }
        blockLines = [];
      }
      continue;
    }

    if (current.startsWith("body:")) {
      if (line === "}" && bodyDepth === 1) {
        flush();
        continue;
      }

      blockLines.push(rawLine);
      bodyDepth = updateBodyDepth(bodyDepth, rawLine);
      continue;
    }

    if (line === "}") {
      flush();
      continue;
    }

    blockLines.push(rawLine);
  }

  return result;
}

function renderRequestYaml(request) {
  const lines = [];
  lines.push("info:");
  lines.push(`  name: ${yamlString(request.name)}`);
  lines.push("  type: http");
  lines.push(`  seq: ${request.seq}`);
  lines.push("");
  lines.push("http:");
  lines.push(`  method: ${request.method}`);
  lines.push(`  url: ${yamlString(request.url)}`);

  if (request.params.length) {
    lines.push("  params:");
    for (const param of request.params) {
      lines.push(`    - name: ${yamlString(param.name)}`);
      lines.push(`      value: ${yamlString(param.value)}`);
      lines.push(`      type: ${param.type}`);
    }
  }

  if (request.headers.length) {
    lines.push("  headers:");
    for (const header of request.headers) {
      lines.push(`    - name: ${yamlString(header.name)}`);
      lines.push(`      value: ${yamlString(header.value)}`);
    }
  }

  if (request.bodyType && request.bodyType !== "none") {
    lines.push("  body:");
    lines.push(`    type: ${request.bodyType}`);
    if (request.bodyType === "json" || request.bodyType === "xml" || request.bodyType === "text") {
      lines.push("    data: |-");
      lines.push(indent(request.bodyData, 6));
    } else if (request.bodyType === "multipart-form" || request.bodyType === "form-urlencoded") {
      lines.push("    data:");
      for (const item of request.bodyMultipart) {
        lines.push(`      - name: ${yamlString(item.name)}`);
        lines.push(`        value: ${yamlString(item.value)}`);
      }
    } else {
      lines.push("    data: |-");
      lines.push(indent(request.bodyData, 6));
    }
  }

  if (request.authType && request.authType !== "inherit") {
    lines.push("  auth:");
    lines.push(`    type: ${request.authType}`);
    for (const [key, value] of Object.entries(request.authFields)) {
      lines.push(`    ${key}: ${yamlString(value)}`);
    }
  }

  lines.push("");
  lines.push("settings:");
  lines.push("  encodeUrl: true");
  lines.push("  timeout: 0");
  lines.push("  followRedirects: true");
  lines.push("  maxRedirects: 5");
  lines.push("");
  return lines.join("\n");
}

async function readBruRequests() {
  const requests = [];
  for (const folder of FOLDERS) {
    const folderDir = path.join(SOURCE_DIR, folder.dir);
    const entries = await fs.readdir(folderDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".bru")) continue;
      const sourcePath = path.join(folderDir, entry.name);
      const content = await fs.readFile(sourcePath, "utf8");
      const parsed = parseBruRequest(content);
      requests.push({
        ...parsed,
        folder: folder.dir,
        sourceName: entry.name,
      });
    }
  }
  return requests.sort((a, b) => a.seq - b.seq);
}

async function writeCollectionRoot() {
  const rootYaml = [
    "opencollection: 1.0.0",
    "",
    "info:",
    "  name: \"Hikvision Value Series ISAPI\"",
    "  summary: \"Direct Hikvision terminal ISAPI polling and enrollment collection\"",
    "",
    "config: {}",
    "",
    "request:",
    "  scripts: []",
    "",
    "bundled: false",
    "",
    "extensions:",
    "  ignore:",
    "    - node_modules",
    "    - .git",
    "",
  ].join("\n");

  await fs.writeFile(path.join(TARGET_DIR, "opencollection.yml"), rootYaml);
  await fs.mkdir(path.join(TARGET_DIR, "environments"), { recursive: true });
}

async function writeEnvironment() {
  const lines = [
    "name: local",
    "variables:",
  ];

  for (const [name, value, secret] of ENV_VARS) {
    lines.push(`  - name: ${name}`);
    lines.push(`    value: ${yamlString(value)}`);
    lines.push("    enabled: true");
    lines.push(`    secret: ${secret ? "true" : "false"}`);
    lines.push("    type: text");
  }

  lines.push("");
  await fs.writeFile(path.join(TARGET_DIR, "environments", "local.yml"), lines.join("\n"));
}

async function writeFoldersAndRequests(requests) {
  for (const folder of FOLDERS) {
    const folderPath = path.join(TARGET_DIR, folder.dir);
    await fs.mkdir(folderPath, { recursive: true });

    const folderYaml = [
      "info:",
      `  name: ${yamlString(folder.name)}`,
      "  type: folder",
      `  seq: ${folder.seq}`,
      "",
    ].join("\n");

    await fs.writeFile(path.join(folderPath, "folder.yml"), folderYaml);
  }

  for (const request of requests) {
    const targetPath = path.join(TARGET_DIR, request.folder, request.sourceName.replace(/\.bru$/i, ".yml"));
    await fs.writeFile(targetPath, renderRequestYaml(request));
  }
}

async function writeReadme() {
  const readme = [
    "# Hikvision Value Series ISAPI OpenCollection",
    "",
    "This collection is the YAML/OpenCollection version of the Hikvision terminal request pack.",
    "",
    "Open the collection folder in Bruno, or clone the repo and open the folder that contains `opencollection.yml`.",
    "",
    "`opencollection.yml` is the collection root manifest. Importing that file by itself can open an empty shell because the actual requests live in the sibling YAML files under the same folder tree.",
    "",
    "Bruno YAML/OpenCollection support starts in Bruno 3.0.0, but 3.1.0+ is the safer target for this workflow.",
    "",
    "Use `environments/local.yml` for the starting variables and fill in your terminal credentials.",
    "",
    "This collection targets the Hikvision terminal directly, not the app API.",
    "",
  ].join("\n");

  await fs.writeFile(path.join(TARGET_DIR, "README.md"), readme);
}

async function main() {
  await fs.rm(TARGET_DIR, { recursive: true, force: true });
  await fs.mkdir(TARGET_DIR, { recursive: true });

  const requests = await readBruRequests();
  await writeCollectionRoot();
  await writeEnvironment();
  await writeFoldersAndRequests(requests);
  await writeReadme();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
