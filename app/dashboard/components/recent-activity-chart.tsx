"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis
} from "recharts";

import type { DashboardActivityPoint } from "./dashboard-types";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";

interface RecentActivityChartProps {
  data: DashboardActivityPoint[];
}

const chartConfig = {
  events: {
    label: "Events",
    color: "hsl(var(--primary))"
  }
} satisfies ChartConfig;

export function RecentActivityChart({ data }: RecentActivityChartProps) {
  return (
    <ChartContainer config={chartConfig} className="h-[300px] w-full">
      <BarChart data={data} margin={{ left: 8, right: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="hour"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval={0}
        />
        <YAxis
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          width={28}
        />
        <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
        <Bar dataKey="events" fill="var(--color-events)" radius={6} />
      </BarChart>
    </ChartContainer>
  );
}
