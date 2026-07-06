"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/login/actions";

const LINKS = [
  { href: "/positions", label: "Positions" },
  { href: "/trades", label: "Historique" },
  { href: "/analytics", label: "Analytics" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="nav">
      <strong>BOT-CRYPTO</strong>
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={pathname.startsWith(link.href) ? "page" : undefined}
        >
          {link.label}
        </Link>
      ))}
      <form action={logout}>
        <button type="submit">Déconnexion</button>
      </form>
    </nav>
  );
}
