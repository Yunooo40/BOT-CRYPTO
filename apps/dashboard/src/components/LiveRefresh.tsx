"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

interface LiveRefreshProps {
  /** Session JWT, read server-side and handed down just for this WS handshake — the browser can't set a custom header on a native WebSocket. */
  token: string;
  types: string[];
  wsUrl: string;
}

interface EventFrame {
  event: string;
}

function isEventFrame(value: unknown): value is EventFrame {
  return (
    typeof value === "object" && value !== null && typeof (value as EventFrame).event === "string"
  );
}

/**
 * Subscribes to the gateway's live feed (`/ws`, M12) and asks Next.js to
 * re-fetch the current page's Server Component data on every relevant event —
 * no client-side re-implementation of the positions/analytics folding logic.
 */
export function LiveRefresh({ token, types, wsUrl }: LiveRefreshProps) {
  const router = useRouter();
  const typesKey = types.join(",");

  useEffect(() => {
    const socket = new WebSocket(`${wsUrl}/ws?token=${encodeURIComponent(token)}`);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ event: "subscribe", data: { types: typesKey.split(",") } }));
    });

    socket.addEventListener("message", (message: MessageEvent<string>) => {
      let frame: unknown;
      try {
        frame = JSON.parse(message.data);
      } catch {
        return;
      }
      if (isEventFrame(frame) && frame.event === "event") {
        router.refresh();
      }
    });

    return () => socket.close();
  }, [token, typesKey, wsUrl, router]);

  return null;
}
