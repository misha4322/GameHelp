"use client";

import { useState } from "react";

export default function CopyMyIdButton({ myId }: { myId: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(myId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = myId;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  }

  return (
    <button type="button" onClick={copy} className="copy-id-btn">
      {copied ? "✅ ID скопирован" : "📋 Скопировать мой ID"}
    </button>
  );
}