#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

import { config as loadEnvFile } from "dotenv";

import { HikvisionIsapiClient } from "./client";
import { createTracingFetch, redactJsonLike } from "./debug";
import type {
  HikvisionAlertStreamChunk,
  HikvisionDebugExchange,
} from "./models";

type OutputMode = "dual" | "raw" | "json" | "summary";

type ParsedCliArgs = {
  positionals: string[];
  flags: Record<string, string[]>;
  booleans: Record<string, boolean>;
};

type ResolvedCommand = {
  group: "device" | "events" | "face";
  action: string;
  displayName: string;
  legacyAliasUsed?: string;
};

type ResolvedProfile = {
  profile?: string;
  host?: string;
  username?: string;
  password?: string;
  protocol?: "http" | "https";
  fdid?: string;
  faceLibType?: string;
  terminalNo?: string;
};

type CommandExecutionResult = {
  summary: Record<string, unknown>;
  parsed: unknown;
  raw?: unknown;
  request?: unknown;
  attachments?: Array<{
    name: string;
    content: string | Buffer;
  }>;
};

type CommandContext = {
  args: ParsedCliArgs;
  command: ResolvedCommand;
  outputMode: OutputMode;
  runDir: string;
  showTokens: boolean;
  resolvedProfile: ResolvedProfile;
  tracer: ReturnType<typeof createTracingFetch>;
  client?: HikvisionIsapiClient;
};

const DEFAULT_RUNS_DIR = path.join(process.cwd(), ".tmp", "hikvision-cli-runs");

const LEGACY_ALIASES: Record<string, [ResolvedCommand["group"], string]> = {
  probe: ["device", "probe"],
  heartbeat: ["device", "heartbeat"],
  "capture-face": ["face", "capture"],
  "count-faces": ["face", "count"],
  "search-faces": ["face", "search"],
  "add-face-record": ["face", "add"],
  "apply-face-record": ["face", "apply"],
  "full-workflow": ["face", "workflow"],
};

function loadEnv() {
  loadEnvFile({ path: path.join(process.cwd(), ".env") });
  loadEnvFile({ path: path.join(process.cwd(), ".env.local"), override: true });
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const positionals: string[] = [];
  const flags: Record<string, string[]> = {};
  const booleans: Record<string, boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const withoutPrefix = token.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    const inlineValue = equalsIndex >= 0 ? withoutPrefix.slice(equalsIndex + 1) : undefined;
    const rawName = equalsIndex >= 0 ? withoutPrefix.slice(0, equalsIndex) : withoutPrefix;

    if (rawName.startsWith("no-")) {
      booleans[rawName.slice(3)] = false;
      continue;
    }

    if (inlineValue !== undefined) {
      flags[rawName] = [...(flags[rawName] || []), inlineValue];
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[rawName] = [...(flags[rawName] || []), next];
      index += 1;
      continue;
    }

    booleans[rawName] = true;
  }

  return {
    positionals,
    flags,
    booleans,
  };
}

function getFlag(args: ParsedCliArgs, name: string) {
  return args.flags[name]?.at(-1);
}

function getFlagValues(args: ParsedCliArgs, name: string) {
  return args.flags[name] || [];
}

function getBooleanFlag(args: ParsedCliArgs, name: string, fallback = false) {
  if (name in args.booleans) {
    return args.booleans[name];
  }
  return fallback;
}

function readRequired(args: ParsedCliArgs, name: string, fallback?: string) {
  const value = getFlag(args, name) || fallback;
  if (!value) {
    throw new Error(`Missing required flag --${name}`);
  }
  return value;
}

function parseInteger(value: string | undefined, fallback?: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitCsv(values: string[]) {
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseIntegerList(args: ParsedCliArgs, ...names: string[]) {
  return [...new Set(
    names
      .flatMap((name) => splitCsv(getFlagValues(args, name)))
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
  )];
}

function maskCallbackTokens(text: string, showTokens = false) {
  if (showTokens) return text;
  return text.replace(
    /(\/api\/events\/hikvision\/)([A-Za-z0-9]+)/g,
    (_, prefix: string, token: string) => `${prefix}${token.slice(0, 6)}...${token.slice(-4)}`
  );
}

function safeJson(value: unknown, showTokens = false) {
  return JSON.stringify(
    redactJsonLike(value, showTokens),
    (_, entry) => (Buffer.isBuffer(entry) ? `[Buffer ${entry.length} bytes]` : entry),
    2
  );
}

function printSection(title: string, value: unknown, showTokens = false) {
  console.log(`\n${title}`);
  console.log(typeof value === "string" ? maskCallbackTokens(value, showTokens) : safeJson(value, showTokens));
}

function sanitizeProfileKey(profile: string) {
  return profile.trim().replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
}

export function resolveProfileEnv(profile?: string): ResolvedProfile {
  const testFallback: ResolvedProfile = {
    host: process.env.HIKVISION_TEST_HOST,
    username: process.env.HIKVISION_TEST_USERNAME,
    password: process.env.HIKVISION_TEST_PASSWORD,
    protocol: (process.env.HIKVISION_TEST_PROTOCOL as "http" | "https" | undefined) || "http",
    fdid: process.env.HIKVISION_TEST_FDID,
    faceLibType: process.env.HIKVISION_TEST_FACE_LIB_TYPE,
    terminalNo: process.env.HIKVISION_TEST_TERMINAL_NO,
  };

  if (!profile) {
    return testFallback;
  }

  const prefix = `HIKVISION_PROFILE_${sanitizeProfileKey(profile)}_`;
  return {
    profile,
    host: process.env[`${prefix}HOST`] || testFallback.host,
    username: process.env[`${prefix}USERNAME`] || testFallback.username,
    password: process.env[`${prefix}PASSWORD`] || testFallback.password,
    protocol:
      (process.env[`${prefix}PROTOCOL`] as "http" | "https" | undefined) ||
      testFallback.protocol ||
      "http",
    fdid: process.env[`${prefix}FDID`] || testFallback.fdid,
    faceLibType: process.env[`${prefix}FACE_LIB_TYPE`] || testFallback.faceLibType,
    terminalNo: process.env[`${prefix}TERMINAL_NO`] || testFallback.terminalNo,
  };
}

function resolveCommand(args: ParsedCliArgs): ResolvedCommand {
  const [first, second] = args.positionals;

  if (!first) {
    throw new Error("Missing command");
  }

  if (LEGACY_ALIASES[first]) {
    const [group, action] = LEGACY_ALIASES[first];
    return {
      group,
      action,
      displayName: `${group} ${action}`,
      legacyAliasUsed: first,
    };
  }

  const group = first as ResolvedCommand["group"];
  if (!["device", "events", "face"].includes(group)) {
    throw new Error(`Unknown command group: ${first}`);
  }

  if (!second) {
    throw new Error(`Missing ${group} action`);
  }

  return {
    group,
    action: second,
    displayName: `${group} ${second}`,
  };
}

function buildRunSlug(command: ResolvedCommand) {
  return command.displayName.replace(/\s+/g, "-").replace(/[^A-Za-z0-9_-]/g, "-");
}

async function createRunDir(command: ResolvedCommand) {
  const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  const runDir = path.join(DEFAULT_RUNS_DIR, `${timestamp}-${buildRunSlug(command)}`);
  await mkdir(runDir, { recursive: true });
  return runDir;
}

function buildClient(context: {
  args: ParsedCliArgs;
  resolvedProfile: ResolvedProfile;
  showTokens: boolean;
}) {
  const host = readRequired(context.args, "host", context.resolvedProfile.host);
  const username = readRequired(context.args, "username", context.resolvedProfile.username);
  const password = readRequired(context.args, "password", context.resolvedProfile.password);
  const protocol = ((getFlag(context.args, "protocol") || context.resolvedProfile.protocol || "http") === "https"
    ? "https"
    : "http") as "http" | "https";
  const timeoutMs = parseInteger(getFlag(context.args, "timeout-ms"), 15_000);
  const retries = parseInteger(getFlag(context.args, "retries"), 1);
  const tracer = createTracingFetch(fetch, {
    showTokens: context.showTokens,
  });

  return {
    tracer,
    client: new HikvisionIsapiClient({
      host,
      username,
      password,
      protocol,
      timeoutMs,
      retries,
      fetchImpl: tracer.fetchImpl,
    }),
  };
}

function extractLastRequest(exchanges: HikvisionDebugExchange[]) {
  return exchanges.at(-1)?.request;
}

function extractLastRawResponse(exchanges: HikvisionDebugExchange[]) {
  const last = exchanges.at(-1);
  return last?.response || last?.error;
}

async function writeArtifact(
  runDir: string,
  name: string,
  content: string | Buffer
) {
  const target = path.join(runDir, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return target;
}

async function writeExchangeArtifacts(runDir: string, exchanges: HikvisionDebugExchange[]) {
  const artifactRefs: string[] = [];
  for (const [index, exchange] of exchanges.entries()) {
    const prefix = path.join("exchanges", `${String(index + 1).padStart(2, "0")}`);
    if (exchange.request.bodyText) {
      artifactRefs.push(await writeArtifact(runDir, `${prefix}-request.txt`, exchange.request.bodyText));
    }
    if (exchange.response?.bodyText) {
      artifactRefs.push(await writeArtifact(runDir, `${prefix}-response.txt`, exchange.response.bodyText));
    }
  }
  return artifactRefs;
}

async function persistCommandBundle(context: CommandContext, result: {
  summary: Record<string, unknown>;
  parsed: unknown;
  raw?: unknown;
  request?: unknown;
  error?: unknown;
  exchanges: HikvisionDebugExchange[];
  attachments?: Array<{ name: string; content: string | Buffer }>;
}) {
  const files = [
    await writeArtifact(
      context.runDir,
      "command.json",
      safeJson(
        {
          command: context.command,
          flags: context.args.flags,
          booleans: context.args.booleans,
          profile: context.resolvedProfile.profile,
          outputMode: context.outputMode,
        },
        context.showTokens
      )
    ),
    await writeArtifact(context.runDir, "summary.json", safeJson(result.summary, context.showTokens)),
    await writeArtifact(context.runDir, "parsed-response.json", safeJson(result.parsed, context.showTokens)),
    await writeArtifact(
      context.runDir,
      "raw-response.json",
      safeJson(
        {
          request: result.request,
          raw: result.raw,
          error: result.error,
          exchanges: result.exchanges,
        },
        context.showTokens
      )
    ),
  ];

  files.push(...(await writeExchangeArtifacts(context.runDir, result.exchanges)));

  if (result.attachments) {
    for (const attachment of result.attachments) {
      files.push(await writeArtifact(context.runDir, path.join("artifacts", attachment.name), attachment.content));
    }
  }

  return files;
}

function printUsage() {
  console.log(`Usage: pnpm hikvision:cli <group> <action> [flags]

Groups:
  device   probe | heartbeat | info | access-capabilities | fdlib-capabilities
  events   capabilities | count | storage | clear | search | search-multi | stream-sample | stream-follow | snapshot-reflection
  face     capture | count | search | add | apply | workflow

Global flags:
  --profile <name>
  --output dual|raw|json|summary
  --show-tokens
  --host --username --password --protocol
  --timeout-ms --retries

Examples:
  pnpm hikvision:cli --profile office device probe
  pnpm hikvision:cli --profile office device heartbeat
  pnpm hikvision:cli --profile office events count
  pnpm hikvision:cli --profile office events clear
  pnpm hikvision:cli --profile office events search --major 5 --minor 75
  pnpm hikvision:cli --profile office events stream-follow --duration-seconds 20
  pnpm hikvision:cli --profile office events snapshot-reflection --timeout-seconds 8
`);
}

async function runDeviceCommand(context: CommandContext): Promise<CommandExecutionResult> {
  const client = context.client!;

  switch (context.command.action) {
    case "probe": {
      const parsed = {
        heartbeat: await client.getHeartbeat(),
        deviceInfo: await client.getDeviceInfo(),
        accessControl: await client.getAccessControlCapabilities(),
        fdLib: await client.getFdLibCapabilities(),
        acsEvents: await client.getAcsEventCapabilities(),
      };
      return {
        summary: {
          deviceName: (parsed.deviceInfo.deviceName as string | undefined) || (parsed.deviceInfo.model as string | undefined) || "unknown",
          serialNumber: (parsed.deviceInfo.serialNumber as string | undefined) || "unknown",
          checks: Object.keys(parsed).length,
        },
        parsed,
      };
    }
    case "heartbeat": {
      const parsed = await client.getHeartbeat();
      return {
        summary: {
          success: parsed.success,
          checkedAt: parsed.checkedAt,
        },
        parsed,
      };
    }
    case "info": {
      const parsed = await client.getDeviceInfo();
      return {
        summary: {
          deviceName: parsed.deviceName || parsed.model || "unknown",
          serialNumber: parsed.serialNumber || "unknown",
        },
        parsed,
      };
    }
    case "access-capabilities": {
      const parsed = await client.getAccessControlCapabilities();
      return {
        summary: {
          capabilityKeys: Object.keys(parsed).length,
        },
        parsed,
      };
    }
    case "fdlib-capabilities": {
      const parsed = await client.getFdLibCapabilities();
      return {
        summary: {
          capabilityKeys: Object.keys(parsed).length,
        },
        parsed,
      };
    }
    default:
      throw new Error(`Unsupported device action: ${context.command.action}`);
  }
}

async function runEventsCommand(context: CommandContext): Promise<CommandExecutionResult> {
  const client = context.client!;

  switch (context.command.action) {
    case "capabilities": {
      const parsed = await client.getAcsEventCapabilities();
      return {
        summary: {
          capabilityKeys: Object.keys(parsed).length,
        },
        parsed,
      };
    }
    case "count": {
      const major = parseInteger(getFlag(context.args, "major"), 0);
      const minor = parseInteger(getFlag(context.args, "minor"), 0);
      const parsed = await client.getAcsEventTotalNum(major, minor);
      return {
        summary: {
          major,
          minor,
          totalNum: parsed.totalNum,
        },
        parsed,
      };
    }
    case "storage": {
      const [config, capabilities] = await Promise.all([
        client.getAcsEventStorageConfig(),
        client.getAcsEventStorageCapabilities(),
      ]);
      const parsed = {
        config,
        capabilities,
      };
      return {
        summary: {
          mode: config.mode || "unknown",
          checkTime: config.checkTime || null,
          period: config.period ?? null,
          modeOptions: capabilities.modeOptions,
        },
        parsed,
      };
    }
    case "clear": {
      const parsed = await client.clearAcsEventsByTime(getFlag(context.args, "check-time") || new Date());
      return {
        summary: {
          previousMode: parsed.previousConfig.mode || null,
          appliedMode: parsed.appliedConfig.mode,
          checkTime: parsed.appliedConfig.checkTime,
          restoredMode: parsed.restoredConfig.mode || null,
          beforeCount: parsed.beforeCount,
          afterCount: parsed.afterCount,
        },
        parsed,
      };
    }
    case "search": {
      const major = parseInteger(getFlag(context.args, "major"));
      const minor = parseInteger(getFlag(context.args, "minor"));
      const parsed = await client.searchAcsEvents({
        major,
        minor,
        searchResultPosition: parseInteger(getFlag(context.args, "search-result-position"), 0),
        maxResults: parseInteger(getFlag(context.args, "max-results"), 20),
        startTime: getFlag(context.args, "start-time"),
        endTime: getFlag(context.args, "end-time"),
        employeeNo: getFlag(context.args, "employee-no"),
        cardNo: getFlag(context.args, "card-no"),
        name: getFlag(context.args, "name"),
      });
      return {
        summary: {
          major: major ?? "all",
          minor: minor ?? "all",
          records: parsed.records.length,
          totalMatches: parsed.totalMatches,
        },
        parsed,
      };
    }
    case "search-multi": {
      const major = parseInteger(getFlag(context.args, "major"), 5);
      const minors = parseIntegerList(context.args, "minors", "minor");
      if (minors.length === 0) {
        throw new Error("Missing required flag --minors");
      }
      const parsed = await client.searchAcsEventsMulti({
        major,
        minors,
        searchResultPosition: parseInteger(getFlag(context.args, "search-result-position"), 0),
        maxResults: parseInteger(getFlag(context.args, "max-results"), 20),
        startTime: getFlag(context.args, "start-time"),
        endTime: getFlag(context.args, "end-time"),
        employeeNo: getFlag(context.args, "employee-no"),
        cardNo: getFlag(context.args, "card-no"),
        name: getFlag(context.args, "name"),
      });
      return {
        summary: {
          major,
          minors,
          records: parsed.records.length,
          successfulQueries: parsed.perMinor.filter((entry) => entry.result).length,
          failedQueries: parsed.perMinor.filter((entry) => entry.error).length,
        },
        parsed,
      };
    }
    case "stream-sample": {
      const parsed = await client.readAlertStreamSample({
        timeoutMs: parseInteger(getFlag(context.args, "timeout-ms"), 5_000),
        maxBytes: parseInteger(getFlag(context.args, "max-bytes"), 8_192),
      });
      return {
        summary: {
          contentType: parsed.contentType,
          sampleBytes: parsed.sampleBytes,
          events: parsed.events.length,
          truncated: parsed.truncated,
        },
        parsed,
        raw: {
          sampleText: parsed.sampleText,
          exchanges: context.tracer.getExchanges(),
        },
        attachments: [
          {
            name: "alert-stream-sample.txt",
            content: parsed.sampleText,
          },
        ],
      };
    }
    case "stream-follow": {
      const chunkLogs: HikvisionAlertStreamChunk[] = [];
      const parsed = await client.followAlertStream({
        durationMs: (parseInteger(getFlag(context.args, "duration-seconds"), 15) || 15) * 1_000,
        onChunk: async (chunk) => {
          chunkLogs.push(chunk);
          if (context.outputMode === "dual" || context.outputMode === "raw") {
            printSection("STREAM CHUNK SUMMARY", {
              timestamp: chunk.timestamp,
              byteLength: chunk.byteLength,
              events: chunk.events.map((event) => ({
                major: event.major,
                minor: event.minor,
                employeeNo: event.employeeNo || event.employeeNoString,
                eventTime: event.eventTime || event.dateTime,
                eventType: event.eventType,
              })),
            }, context.showTokens);
            if (context.outputMode === "raw") {
              printSection("STREAM CHUNK RAW", chunk.text, context.showTokens);
            }
          }
        },
      });
      return {
        summary: {
          contentType: parsed.contentType,
          chunks: parsed.chunks.length,
          totalBytes: parsed.totalBytes,
          durationMs: parsed.durationMs,
        },
        parsed,
        raw: {
          chunks: parsed.chunks.map((chunk) => ({
            timestamp: chunk.timestamp,
            byteLength: chunk.byteLength,
            text: chunk.text,
          })),
          exchanges: context.tracer.getExchanges(),
        },
        attachments: parsed.chunks.map((chunk, index) => ({
          name: `alert-stream-chunk-${String(index + 1).padStart(2, "0")}.txt`,
          content: chunk.text,
        })),
      };
    }
    case "snapshot-reflection": {
      const parsed = await client.measureSnapshotAlertStreamReflection({
        streamId: getFlag(context.args, "stream-id") || "101",
        timeoutMs: (parseInteger(getFlag(context.args, "timeout-seconds"), 8) || 8) * 1_000,
        armDelayMs: parseInteger(getFlag(context.args, "arm-delay-ms"), 250),
      });
      return {
        summary: {
          status: parsed.status,
          streamId: parsed.streamId,
          snapshotBytes: parsed.snapshotBytes,
          firstChunkDelayMs: parsed.firstChunkDelayMs ?? null,
          reflectionDelayMs: parsed.reflectionDelayMs ?? null,
          reflectedEvents: parsed.reflectedEvents.length,
          observedChunks: parsed.observedChunks.length,
        },
        parsed,
        raw: {
          followResult: parsed.followResult,
          exchanges: context.tracer.getExchanges(),
        },
        attachments: parsed.followResult.chunks.map((chunk, index) => ({
          name: `snapshot-reflection-chunk-${String(index + 1).padStart(2, "0")}.txt`,
          content: chunk.text,
        })),
      };
    }
    default:
      throw new Error(`Unsupported events action: ${context.command.action}`);
  }
}

async function runFaceCommand(context: CommandContext): Promise<CommandExecutionResult> {
  const client = context.client!;
  const fdid = context.resolvedProfile.fdid;
  const faceLibType = context.resolvedProfile.faceLibType;

  switch (context.command.action) {
    case "capture": {
      const parsed = await client.captureFace({
        dataType: (getFlag(context.args, "data-type") as "binary" | "url" | undefined) || "url",
      });
      const captureProgress =
        parsed.status === "ready" ? parsed.image.captureProgress : parsed.captureProgress;
      return {
        summary: {
          status: parsed.status,
          captureProgress,
          hasImage: parsed.status === "ready",
        },
        parsed,
      };
    }
    case "count": {
      const parsed = await client.countFaces(
        readRequired(context.args, "fdid", fdid),
        readRequired(context.args, "face-lib-type", faceLibType),
        getFlag(context.args, "terminal-no") || context.resolvedProfile.terminalNo
      );
      return {
        summary: {
          fdid: parsed.fdid,
          faceLibType: parsed.faceLibType,
          recordDataNumber: parsed.recordDataNumber,
        },
        parsed,
      };
    }
    case "search": {
      const parsed = await client.searchFaceRecords(
        readRequired(context.args, "fdid", fdid),
        readRequired(context.args, "face-lib-type", faceLibType),
        {
          fpid: getFlag(context.args, "fpid"),
          name: getFlag(context.args, "name"),
          certificateNumber: getFlag(context.args, "certificate-number"),
          isInLibrary: getFlag(context.args, "is-in-library"),
          maxResults: parseInteger(getFlag(context.args, "max-results"), 100),
          searchResultPosition: parseInteger(getFlag(context.args, "search-result-position"), 0),
        }
      );
      return {
        summary: {
          records: parsed.records.length,
          totalMatches: parsed.totalMatches,
        },
        parsed,
      };
    }
    case "add": {
      const parsed = await client.addFaceRecord({
        fdid: readRequired(context.args, "fdid", fdid),
        faceLibType: readRequired(context.args, "face-lib-type", faceLibType),
        faceUrl: getFlag(context.args, "face-url"),
        modelData: getFlag(context.args, "model-data"),
        fpid: getFlag(context.args, "fpid"),
        name: getFlag(context.args, "name"),
        employeeNo: getFlag(context.args, "employee-no"),
      });
      return {
        summary: {
          success: parsed.success,
          fpid: parsed.fpid,
          fdid: parsed.fdid,
        },
        parsed,
      };
    }
    case "apply": {
      const parsed = await client.applyFaceRecord({
        fdid: readRequired(context.args, "fdid", fdid),
        faceLibType: readRequired(context.args, "face-lib-type", faceLibType),
        faceUrl: getFlag(context.args, "face-url"),
        modelData: getFlag(context.args, "model-data"),
        fpid: getFlag(context.args, "fpid"),
        name: getFlag(context.args, "name"),
        employeeNo: getFlag(context.args, "employee-no"),
      });
      return {
        summary: {
          success: parsed.success,
          fpid: parsed.fpid,
          fdid: parsed.fdid,
        },
        parsed,
      };
    }
    case "workflow": {
      const parsed = await client.fullCaptureAndSyncWorkflow({
        fdid: readRequired(context.args, "fdid", fdid),
        faceLibType: readRequired(context.args, "face-lib-type", faceLibType),
        terminalNo: getFlag(context.args, "terminal-no") || context.resolvedProfile.terminalNo,
        fpid: getFlag(context.args, "fpid"),
        name: getFlag(context.args, "name"),
        employeeNo: getFlag(context.args, "employee-no"),
        faceUrl: getFlag(context.args, "face-url"),
        modelData: getFlag(context.args, "model-data"),
      });
      return {
        summary: {
          captureSucceeded: parsed.captureSucceeded,
          uploadSucceeded: parsed.uploadSucceeded,
          verified: parsed.verified,
          fpid: parsed.fpid,
        },
        parsed,
      };
    }
    default:
      throw new Error(`Unsupported face action: ${context.command.action}`);
  }
}

async function executeCommand(context: CommandContext): Promise<CommandExecutionResult> {
  switch (context.command.group) {
    case "device":
      return runDeviceCommand(context);
    case "events":
      return runEventsCommand(context);
    case "face":
      return runFaceCommand(context);
    default:
      throw new Error(`Unsupported command group: ${context.command.group}`);
  }
}

function renderOutput(context: CommandContext, payload: {
  summary: Record<string, unknown>;
  parsed: unknown;
  request?: unknown;
  raw?: unknown;
  exchanges: HikvisionDebugExchange[];
  artifactFiles: string[];
}) {
  const requestSection = payload.request || extractLastRequest(payload.exchanges) || {};
  const rawSection = payload.raw || extractLastRawResponse(payload.exchanges) || {};

  switch (context.outputMode) {
    case "summary":
      printSection("COMMAND SUMMARY", payload.summary, context.showTokens);
      printSection("ARTIFACTS", payload.artifactFiles, context.showTokens);
      break;
    case "raw":
      printSection("RAW RESPONSE", rawSection, context.showTokens);
      printSection("ARTIFACTS", payload.artifactFiles, context.showTokens);
      break;
    case "json":
      console.log(
        safeJson(
          {
            summary: payload.summary,
            request: requestSection,
            parsed: payload.parsed,
            raw: rawSection,
            exchanges: payload.exchanges,
            artifactFiles: payload.artifactFiles,
          },
          context.showTokens
        )
      );
      break;
    case "dual":
    default:
      printSection("COMMAND SUMMARY", payload.summary, context.showTokens);
      printSection("REQUEST", requestSection, context.showTokens);
      printSection("PARSED RESPONSE", payload.parsed, context.showTokens);
      printSection("RAW RESPONSE", rawSection, context.showTokens);
      printSection("ARTIFACTS", payload.artifactFiles, context.showTokens);
      break;
  }
}

export async function runCli(argv = process.argv.slice(2)) {
  loadEnv();
  const args = parseCliArgs(argv);

  if (args.positionals.length === 0 || getBooleanFlag(args, "help")) {
    printUsage();
    return 0;
  }

  let command: ResolvedCommand;
  try {
    command = resolveCommand(args);
  } catch (error) {
    printUsage();
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }

  const outputMode = (getFlag(args, "output") as OutputMode | undefined) || "dual";
  const showTokens = getBooleanFlag(args, "show-tokens", false);
  const runDir = await createRunDir(command);
  const resolvedProfile = resolveProfileEnv(getFlag(args, "profile"));

  const built = buildClient({ args, resolvedProfile, showTokens });
  const context: CommandContext = {
    args,
    command,
    outputMode,
    runDir,
    showTokens,
    resolvedProfile,
    tracer: built.tracer,
    client: built.client,
  };

  try {
    const executed = await executeCommand(context);
    const exchanges = context.tracer.consumeExchanges();
    const artifactFiles = await persistCommandBundle(context, {
      summary: executed.summary,
      parsed: executed.parsed,
      raw: executed.raw,
      request: executed.request,
      exchanges,
      attachments: executed.attachments,
    });
    renderOutput(context, {
      summary: executed.summary,
      parsed: executed.parsed,
      request: executed.request,
      raw: executed.raw,
      exchanges,
      artifactFiles,
    });
    return 0;
  } catch (error) {
    const exchanges = context.tracer.consumeExchanges();
    const message = error instanceof Error ? error.message : String(error);
    const artifactFiles = await persistCommandBundle(context, {
      summary: {
        ok: false,
        message,
      },
      parsed: {
        ok: false,
        error: message,
      },
      error: error instanceof Error ? { name: error.name, message: error.message } : { message },
      exchanges,
    });
    renderOutput(context, {
      summary: {
        ok: false,
        message,
      },
      parsed: {
        ok: false,
        error: message,
      },
      raw: {
        error,
      },
      exchanges,
      artifactFiles,
    });
    return 1;
  }
}

const entryFile = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entryFile) {
  runCli().then((code) => {
    process.exitCode = code;
  });
}
