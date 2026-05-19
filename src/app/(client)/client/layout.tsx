import type { ReactNode } from "react";
import { HomeJamDocument } from "../../page-shell";

export default function ClientLayout({ children }: { children: ReactNode }) {
  return <HomeJamDocument page="client">{children}</HomeJamDocument>;
}
