"use client";

import { Camera, Check, ImageUp, X } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Shot = { file: File; url: string };

/**
 * Full-screen camera for phones: snap several bills (or pages of one long bill), then tap Done.
 * Needs HTTPS or localhost for the live camera; otherwise it falls back to the phone's camera app.
 */
export function CameraScanner({
  open,
  onClose,
  onDone,
  mode,
  max = 20,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (files: File[]) => void;
  /** "bills": each photo is a separate bill. "pages": all photos are pages of one bill. */
  mode: "bills" | "pages";
  max?: number;
}) {
  const video = React.useRef<HTMLVideoElement>(null);
  const stream = React.useRef<MediaStream | null>(null);
  const fallbackInput = React.useRef<HTMLInputElement>(null);
  const libraryInput = React.useRef<HTMLInputElement>(null);
  const [shots, setShots] = React.useState<Shot[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);
  const [flash, setFlash] = React.useState(false);
  const limit = mode === "pages" ? Math.min(max, 4) : max;

  const stop = React.useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setReady(false);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(window.isSecureContext ? "This browser can't open the camera here." : "The live camera needs a secure (https) connection.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().then(() => setReady(true));
        }
      })
      .catch((e: DOMException) =>
        setError(e.name === "NotAllowedError" ? "Camera access was blocked. Allow it in your browser settings, or use the options below." : "Couldn't start the camera."),
      );
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, stop]);

  // Free preview URLs when the scanner closes.
  React.useEffect(() => {
    if (open) return;
    setShots((s) => {
      s.forEach((x) => URL.revokeObjectURL(x.url));
      return [];
    });
  }, [open]);

  const snap = () => {
    const v = video.current;
    if (!v || !v.videoWidth || shots.length >= limit) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `scan-${Date.now()}.jpg`, { type: "image/jpeg" });
        setShots((s) => [...s, { file, url: URL.createObjectURL(blob) }]);
        setFlash(true);
        navigator.vibrate?.(30);
        setTimeout(() => setFlash(false), 120);
      },
      "image/jpeg",
      0.9,
    );
  };

  const finish = (extra: File[] = []) => {
    const files = [...shots.map((s) => s.file), ...extra].slice(0, limit);
    stop();
    onDone(files);
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label="Scan bills">
      <div className="flex items-center justify-between px-4 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <button
          onClick={() => {
            stop();
            onClose();
          }}
          aria-label="Close camera"
          className="flex size-11 items-center justify-center rounded-full bg-white/10"
        >
          <X className="size-5" />
        </button>
        <p className="text-sm text-white/80">
          {mode === "pages" ? "Pages of one bill" : "One photo per bill"} · {shots.length}/{limit}
        </p>
        <span className="size-11" />
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {!error && <video ref={video} playsInline muted autoPlay className="size-full object-cover" aria-label="Camera preview" />}
        {!error && ready && (
          <div aria-hidden className="pointer-events-none absolute inset-6 rounded-lg border-2 border-white/40 sm:inset-x-[20%]" />
        )}
        {flash && <div className="absolute inset-0 bg-white/70" />}
        {error && (
          <div className="flex size-full flex-col items-center justify-center gap-4 px-8 text-center">
            <Camera className="size-8 text-white/60" />
            <p>{error}</p>
            <div className="grid w-full max-w-xs gap-2">
              <Button variant="inverse" size="lg" onClick={() => fallbackInput.current?.click()}>
                <Camera /> Use the camera app
              </Button>
              <Button variant="outline" size="lg" className="border-white/30 text-white hover:bg-white/10" onClick={() => libraryInput.current?.click()}>
                <ImageUp /> Choose from library
              </Button>
            </div>
          </div>
        )}
      </div>

      {shots.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 pt-3 [scrollbar-width:none]">
          {shots.map((s, i) => (
            <div key={s.url} className="relative shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt={`Shot ${i + 1}`} className="size-16 rounded-sm object-cover" />
              <button
                onClick={() =>
                  setShots((list) => {
                    URL.revokeObjectURL(s.url);
                    return list.filter((x) => x !== s);
                  })
                }
                aria-label={`Delete shot ${i + 1}`}
                className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-white text-[#17171c]"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 items-center px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4">
        <button onClick={() => libraryInput.current?.click()} className="justify-self-start text-sm text-white/80 underline underline-offset-4">
          Library
        </button>
        <button
          onClick={snap}
          disabled={!ready || shots.length >= limit}
          aria-label="Take photo"
          className={cn("size-[72px] justify-self-center rounded-full border-4 border-white bg-white/90 transition active:scale-95 disabled:opacity-40")}
        />
        <Button variant="inverse" onClick={() => finish()} disabled={shots.length === 0} className="justify-self-end">
          <Check /> Done{shots.length ? ` (${shots.length})` : ""}
        </Button>
      </div>

      <input
        ref={fallbackInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = [...(e.target.files ?? [])];
          e.target.value = "";
          if (f.length) finish(f);
        }}
      />
      <input
        ref={libraryInput}
        type="file"
        accept="image/*,application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          const f = [...(e.target.files ?? [])];
          e.target.value = "";
          if (f.length) finish(f);
        }}
      />
    </div>,
    document.body,
  );
}
