"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

const THEME_EVENT = "cpw-theme-change";

function subscribeTheme(callback: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener("storage", callback);
  window.addEventListener(THEME_EVENT, callback);
  media.addEventListener("change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(THEME_EVENT, callback);
    media.removeEventListener("change", callback);
  };
}

function getThemeSnapshot(): boolean {
  const stored = window.localStorage.getItem("cpw-theme");
  if (stored === "dark") return true;
  if (stored === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getServerThemeSnapshot(): boolean {
  return true;
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  function toggleTheme() {
    const next = !dark;
    const root = document.documentElement;
    root.classList.add("no-theme-transitions");
    root.classList.toggle("dark", next);
    window.localStorage.setItem("cpw-theme", next ? "dark" : "light");
    window.dispatchEvent(new Event(THEME_EVENT));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        root.classList.remove("no-theme-transitions");
      });
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="active:scale-[0.97]"
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
