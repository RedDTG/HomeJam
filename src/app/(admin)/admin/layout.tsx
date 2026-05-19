import type { ReactNode } from "react";
import { HomeJamDocument } from "../../page-shell";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <HomeJamDocument page="admin">{children}</HomeJamDocument>;
}
