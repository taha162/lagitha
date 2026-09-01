import {
  Backpack,
  Baby,
  Bike,
  Glasses,
  IdCard,
  KeyRound,
  Laptop,
  Package,
  PawPrint,
  Shirt,
  Smartphone,
  Stethoscope,
  Wallet,
  Watch,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Category icons resolved from the name stored on the Category row.
 *
 * An explicit map rather than a dynamic import: it keeps the bundle to the
 * fourteen icons the product actually uses, and an unknown name degrades to a
 * neutral package rather than crashing a page.
 */
const ICONS: Record<string, LucideIcon> = {
  Smartphone,
  Wallet,
  KeyRound,
  IdCard,
  Backpack,
  Laptop,
  Watch,
  Glasses,
  Shirt,
  Baby,
  PawPrint,
  Bike,
  Stethoscope,
  Package,
};

export function CategoryIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = ICONS[name] ?? Package;
  return <Icon className={cn("size-5", className)} aria-hidden strokeWidth={1.75} />;
}
