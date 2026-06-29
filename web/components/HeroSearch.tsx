"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Hero search box. It is a "decoy" entry point: the moment the user clicks
 * into it (focus) we hand off to /browse, where the real faceted search lives.
 * The browse page autofocuses its own search field on arrival (focus=1), so the
 * user's keystrokes land there seamlessly — they never lose what they type.
 * Any text already present at handoff is carried through via ?q=.
 */
export function HeroSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const handed = useRef(false);

  // Prefetch so the handoff is instant (input isn't a <Link>, so prefetch here).
  useEffect(() => {
    router.prefetch("/browse?focus=1");
  }, [router]);

  const handoff = (value: string) => {
    if (handed.current) return;
    handed.current = true;
    const sp = new URLSearchParams({ focus: "1" });
    if (value.trim()) sp.set("q", value.trim());
    router.push(`/browse?${sp}`);
  };

  return (
    <label className="hero-search" htmlFor="hero-search-input">
      <span className="hero-search-label mono">Search</span>
      <input
        id="hero-search-input"
        className="hero-search-input"
        type="search"
        autoComplete="off"
        placeholder="Try “Mateo St”, “night rain”, or “freeway underpass”…"
        value={q}
        aria-label="Search plates"
        onFocus={() => handoff(q)}
        onChange={(e) => {
          setQ(e.target.value);
          handoff(e.target.value);
        }}
      />
      <span className="hero-search-hint mono" aria-hidden="true">
        Get started by searching →
      </span>
    </label>
  );
}
