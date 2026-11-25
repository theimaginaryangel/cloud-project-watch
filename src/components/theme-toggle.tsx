"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const stored = window.localStorage.getItem("tagwatch-theme");
    const prefersDark =
      stored === "dark" ||
      (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDark(prefersDark);
    document.documentElement.classList.toggle("dark", prefersDark);
  }, []);

  function toggleTheme() {
    const next = !dark;
    const root = document.documentElement;
    // Zero-transition flash-free theme switching
    root.classList.add("no-theme-transitions");
    root.classList.toggle("dark", next);
    window.localStorage.setItem("tagwatch-theme", next ? "dark" : "light");
    setDark(next);
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
