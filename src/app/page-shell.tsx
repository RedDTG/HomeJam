import type { ReactNode } from "react";

type Page = "admin" | "client" | "visualizer";

function parseHexColor(value: string): { hex: string; rgb: [number, number, number] } {
  const match = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return { hex: "#b8f6d0", rgb: [184, 246, 208] };
  const normalized = match[1].length === 3 ? match[1].split("").map((char) => `${char}${char}`).join("") : match[1];
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return { hex: `#${normalized.toLowerCase()}`, rgb: [red, green, blue] };
}

function parseBoolean(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() || "");
}

export function titleForPage(page: Page): string {
  return page === "admin" ? "HomeJam Admin" : page === "visualizer" ? "HomeJam Visualizer" : "HomeJam";
}

export function HomeJamDocument({ page, children }: { page: Page; children: ReactNode }) {
  const primaryColor = parseHexColor(process.env.PRIMARY_COLOR?.trim() || "#b8f6d0");
  const primaryColorFromArtwork = parseBoolean(process.env.PRIMARY_COLOR_FROM_ARTWORK);
  const [red, green, blue] = primaryColor.rgb;

  return (
    <html lang="fr">
      <head>
        <title>{titleForPage(page)}</title>
        <link rel="stylesheet" href="/assets/styles.css" />
      </head>
      <body
        data-page={page}
        data-primary-color-from-artwork={String(primaryColorFromArtwork)}
        style={{
          "--primary-color": primaryColor.hex,
          "--primary-color-rgb": `${red}, ${green}, ${blue}`,
        } as React.CSSProperties}
      >
        {children}
      </body>
    </html>
  );
}

export function HomeJamPage() {
  return (
    <>
      <main id="app" suppressHydrationWarning />
      <script type="module" src="/assets/app.js" suppressHydrationWarning />
    </>
  );
}
