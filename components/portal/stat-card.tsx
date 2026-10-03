import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
}) {
  return (
    <Card className="gap-2">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardDescription>{label}</CardDescription>
        {Icon ? <Icon className="text-muted-foreground size-4" aria-hidden /> : null}
      </CardHeader>
      <CardContent>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
        {hint ? <p className="text-muted-foreground mt-1.5 text-xs">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
