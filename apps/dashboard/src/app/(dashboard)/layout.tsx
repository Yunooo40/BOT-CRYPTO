import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Nav />
      <main className="shell">{children}</main>
    </>
  );
}
