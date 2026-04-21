export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { ensureTerminalLiveMonitor } = await import("./lib/terminal-live-monitor");
  ensureTerminalLiveMonitor();

  const { ensureHikvisionTerminalGateway } = await import(
    "./lib/hikvision-terminal-gateway-supervisor"
  );
  ensureHikvisionTerminalGateway();
}
