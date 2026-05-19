import type { ReactNode } from "react";
import { HomeJamDocument } from "../../page-shell";

export default function VisualizerLayout({ children }: { children: ReactNode }) {
  return <HomeJamDocument page="visualizer">{children}</HomeJamDocument>;
}
