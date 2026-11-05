"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button className="btn btn-primary no-print" style={{ position: "fixed", right: 20, top: 20 }} onClick={() => window.print()}>
      <Printer size={15} /> Print or save as PDF
    </button>
  );
}
