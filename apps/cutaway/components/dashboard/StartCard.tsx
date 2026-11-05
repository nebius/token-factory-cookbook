"use client";

import { Camera, LoaderCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { JOB_STARTED } from "@/components/ui/BuildWatcher";
import { api } from "@/lib/client/api";
import { resizeImage } from "@/lib/client/image";
import styles from "./dashboard.module.css";

/** Start a machine from a name; opening one you already have never calls the model. */
export async function startFromText(text: string, router: ReturnType<typeof useRouter>) {
  const r = await api<{ id?: number; slug?: string }>("/api/teardowns", { body: { text } });
  if (r.slug) router.push(`/t/${r.slug}`);
  else {
    window.dispatchEvent(new Event(JOB_STARTED));
    router.push(`/new?id=${r.id}`);
  }
}

export function StartCard() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const takeFile = useCallback(async (f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return void toast.error("That file isn't a picture. Try a JPG or PNG.");
    try {
      setImage(await resizeImage(f));
    } catch {
      toast.error("Couldn't open that picture. Try another one.");
    }
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/"));
      if (f) void takeFile(f);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [takeFile]);

  // A photo wins over a typed name; with neither, point at the two ways in instead of failing quietly.
  async function go() {
    if (!image && text.trim().length < 2) {
      inputRef.current?.focus();
      return void toast("Add a photo, or type the name of a machine.");
    }
    setBusy(true);
    try {
      if (!image) return await startFromText(text.trim(), router);
      const r = await api<{ id?: number; slug?: string }>("/api/teardowns", { body: { image, hint: text.trim() || undefined } });
      if (r.slug) router.push(`/t/${r.slug}`);
      else {
        window.dispatchEvent(new Event(JOB_STARTED));
        router.push(`/new?id=${r.id}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div id="start" className={styles.start}>
      <div
        className={styles.drop}
        data-drag={drag}
        data-has={!!image}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void takeFile(e.dataTransfer.files[0]);
        }}
        onClick={() => !image && fileRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label={image ? "Your photo" : "Choose a photo"}
        onKeyDown={(e) => e.key === "Enter" && !image && fileRef.current?.click()}
      >
        <span className={styles.stepNo} aria-hidden="true">
          <Camera size={26} />
        </span>
        {image ? (
          <span className={styles.preview}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="Your photo" />
            <span className={styles.dropText}>
              <b>Photo ready</b>
              <span>Kimi will work out what it is.</span>
            </span>
            <button
              className={styles.remove}
              onClick={(e) => {
                e.stopPropagation();
                setImage(null);
              }}
            >
              <X size={15} /> Remove
            </button>
          </span>
        ) : (
          <>
            <span className={styles.dropText}>
              <b>Snap or drop a photo</b>
              <span>Click to choose one, or paste a picture</span>
            </span>
          </>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void takeFile(e.target.files?.[0])} />
      </div>

      <div className={styles.nameRow}>
        <input
          id="machine-name"
          aria-label="Machine name"
          ref={inputRef}
          className={styles.nameInput}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          placeholder={image ? "Optional: what is it?" : "Or type its name"}
          autoComplete="off"
        />
        <button className={styles.go} onClick={go} disabled={busy}>
          {busy ? <LoaderCircle size={18} className="spin" /> : null}
          {busy ? "Starting" : "Open it up!"}
        </button>
      </div>
    </div>
  );
}
