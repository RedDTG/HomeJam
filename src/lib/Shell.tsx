"use client";

import type { ReactNode } from "react";

type Page = "admin" | "client" | "visualizer";

export function Shell({ page, title, children }: { page: Page; title: string; children: ReactNode }) {
  return (
    <section className={`shell shell-${page}`}>
      <header className="topline">
        <span className="brand">HomeJam</span>
        <span>{title}</span>
      </header>
      {children}
    </section>
  );
}
