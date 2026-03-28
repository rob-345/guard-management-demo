import type { Terminal } from "@/lib/types";

export type DashboardActivityPoint = {
  hour: string;
  events: number;
};

export type DashboardTerminalStatus = Pick<
  Terminal,
  "id" | "name" | "status" | "activation_status" | "last_seen" | "ip_address"
> & {
  site_name?: string;
};
