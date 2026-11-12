import { Car, Cog, Cpu, Fan, Plane, Smartphone, Zap, type LucideIcon } from "lucide-react";

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "motors-power": Zap,
  electronics: Cpu,
  "phones-computers": Smartphone,
  "home-appliances": Fan,
  aerospace: Plane,
  automotive: Car,
  other: Cog,
};

export function CategoryIcon({ category, size = 16 }: { category: string; size?: number }) {
  const Icon = CATEGORY_ICONS[category] ?? Cog;
  return <Icon size={size} />;
}
