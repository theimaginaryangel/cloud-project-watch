"use client";

import { FolderKanban, Layers, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: Layers },
  { href: "/zombies", label: "Untagged", icon: FolderKanban },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Frosted Top Navigation */}
      <header className="sticky top-0 z-30 glass-bar">
        <div className="mx-auto max-w-4xl px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-foreground"
          >
            <span className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background text-xs font-semibold">
              C
            </span>
            <span>CloudProjectWatch</span>
          </Link>

          {/* Desktop Segmented Navigation */}
          <nav
            aria-label="Primary"
            className="hidden sm:flex items-center gap-1 rounded-full bg-secondary p-1"
          >
            {NAV_ITEMS.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/" || pathname.startsWith("/projects/")
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "press-feedback rounded-full px-4 py-1.5 text-xs font-medium",
                    active
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <span className="hidden md:inline text-xs text-muted-foreground">
              Read-only
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Spacious Single-Column Content */}
      <main className="flex-1 min-w-0 pb-24 sm:pb-16">
        <div className="mx-auto w-full max-w-4xl min-w-0 px-5 sm:px-8 py-10 sm:py-12">
          {children}
        </div>
      </main>

      {/* Mobile Frosted Bottom Bar */}
      <nav
        aria-label="Mobile"
        className="fixed bottom-0 inset-x-0 z-30 sm:hidden glass-bar border-t border-b-0"
      >
        <div className="flex items-center justify-around h-16 px-3">
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
                  "press-feedback flex flex-col items-center justify-center gap-1 rounded-xl px-4 py-1.5 text-xs font-medium",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon className="size-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
