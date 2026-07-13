// Minimal provider abstraction — one implementation (FlyProvider) exists today,
// but keeping the interface separate makes it obvious this spike's orchestrator
// (run-spike.ts) doesn't need to know Fly-specific details.
export interface SandboxCreateOpts {
  runId: string;
  image: string;
  region: string;
  env: Record<string, string>;
}

export interface SandboxHandle {
  sandboxId: string;
  baseUrl: string; // https origin serving the runner's /healthz and /run (port 8080)
  vscodeUrl: string; // https origin serving openvscode-server (port 3000), includes ?tkn=
}

export interface SandboxProvider {
  create(opts: SandboxCreateOpts): Promise<SandboxHandle>;
  destroy(sandboxId: string): Promise<void>;
}
