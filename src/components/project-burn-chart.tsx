"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCentsUsd } from "@/lib/domain/types";
import type { ProjectSummaryDto } from "@/lib/scans/orchestrator";

interface ProjectBurnChartProps {
  projects: ProjectSummaryDto[];
}

export function ProjectBurnChart({ projects }: ProjectBurnChartProps) {
  const chartData = projects.map((p) => ({
    name: p.isOrphaned ? "Orphaned" : p.label,
    monthlyUsd: Number((p.monthlyCents / 100).toFixed(2)),
    savingsUsd: Number(
      (Math.min(p.monthlyCents, p.potentialSavingsCents) / 100).toFixed(2),
    ),
    monthlyCents: p.monthlyCents,
    savingsCents: p.potentialSavingsCents,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly Burn vs. Surgical Savings by Project</CardTitle>
        <CardDescription>
          Calculated from live free Describe* snapshots (no Cost Explorer polling)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(val: number) => `$${val}`}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={58}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.45 }}
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  borderColor: "var(--border)",
                  borderRadius: "var(--radius)",
                  color: "var(--popover-foreground)",
                  fontSize: "12px",
                }}
                formatter={(value: number, name: string) => [
                  formatCentsUsd(Math.round(value * 100)),
                  name === "monthlyUsd" ? "Est. Monthly Burn" : "Surgical Savings",
                ]}
              />
              <Bar
                dataKey="monthlyUsd"
                name="monthlyUsd"
                fill="var(--chart-1)"
                radius={[6, 6, 0, 0]}
              />
              <Bar
                dataKey="savingsUsd"
                name="savingsUsd"
                fill="var(--chart-2)"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
