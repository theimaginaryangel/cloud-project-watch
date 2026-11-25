"use client";

import {
  Activity,
  Flame,
  Settings,
  ShieldCheck,
  Tag,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: Activity },
  { href: "/zombies", label: "Zombies", icon: Flame },
  { href: "/settings", label: "Connect & Keys", icon: Settings },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 border-r border-border bg-card/60 backdrop-blur-sm">
        <div className="flex items-center justify-between px-5 h-16">
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Tag className="size-4" />
            </span>
            <span className="text-base">TagWatch</span>
          </Link>
          <ThemeToggle />
        </div>
        <Separator />

        <nav className="flex-1 flex flex-col gap-1 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/" || pathname.startsWith("/projects/")
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors active:scale-[0.98]",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 flex flex-col gap-2">
          <Separator />
          <div className="pt-2 flex flex-col gap-1.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 text-foreground font-medium">
              <ShieldCheck className="size-3.5" />
              <span>Read-Only · $0 Describe*</span>
            </div>
            <p className="leading-relaxed">
              Scans live AWS resources via free Describe APIs. Never polls Cost Explorer.
            </p>
          </div>
        </div>
      </aside>

      {/* Mobile Top Bar */}
      <header className="sticky top-0 z-30 flex md:hidden items-center justify-between px-4 h-14 border-b border-border bg-background/90 backdrop-blur-md">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Tag className="size-3.5" />
          </span>
          <span>TagWatch</span>
        </Link>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Read-Only</Badge>
          <ThemeToggle />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 min-w-0 md:pl-64 pb-20 md:pb-10">
        <div className="mx-auto w-full max-w-6xl min-w-0 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav className="fixed bottom-0 inset-x-0 z-30 flex md:hidden items-center justify-around h-16 border-t border-border bg-background/95 backdrop-blur-md px-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/"
              ? pathname === "/" || pathname.startsWith("/projects/")
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 rounded-lg px-4 py-1.5 text-xs font-medium transition-colors active:scale-[0.97]",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className="size-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
