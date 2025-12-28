import { TrendingUp } from "lucide-react";

export const StatsComponent: React.FC<React.HTMLAttributes<HTMLDivElement>> = (
  props
) => (
  <div
    {...props}
    className="bg-neutral-800 rounded-lg p-6 border border-neutral-700"
  >
    <div className="flex items-center gap-3 mb-2">
      <TrendingUp className="w-5 h-5 text-green-400" />
      <span className="text-sm text-neutral-400">Total Revenue</span>
    </div>
    <p className="text-3xl font-bold text-neutral-100">$12,450</p>
    <p className="text-xs text-green-400 mt-1">+12.5% from last month</p>
  </div>
);
