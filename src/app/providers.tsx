"use client";

import { ReactNode } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";

const convex = new ConvexReactClient(
  process.env.NEXT_PUBLIC_CONVEX_URL || ""
);

export function Providers({ children }: { children: ReactNode }) {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    console.warn("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
