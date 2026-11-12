"use client";

import clsx from "clsx";
import { Check } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/client/api";
import type { Room, RoomInput } from "@/lib/shared/types";
import { useApp } from "./OpenDuetApp";
import { BotAvatar, Button, Drawer, Field, Segmented, inputClass } from "./ui";

export function RoomForm({ room, onDone }: { room?: Room; onDone?: (room: Room) => void }) {
  const { state, open, toast } = useApp();
  const [initial, setInitial] = useState<RoomInput>(() =>
    room ? { ...room } : { name: "", topic: "", emoji: "", memberIds: [], leadId: null, responder: "auto", pinned: false },
  );
  const [form, setForm] = useState<RoomInput>(initial);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = <K extends keyof RoomInput>(k: K, v: RoomInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const toggleMember = (id: string) =>
    setForm((f) => {
      const memberIds = f.memberIds.includes(id) ? f.memberIds.filter((m) => m !== id) : [...f.memberIds, id];
      const leadId = f.leadId && memberIds.includes(f.leadId) ? f.leadId : (memberIds[0] ?? null);
      return { ...f, memberIds, leadId };
    });

  const save = async () => {
    setSaving(true);
    try {
      if (room) {
        const { room: saved } = await api.updateRoom(room.id, form);
        setInitial({ ...saved });
        setForm({ ...saved });
        onDone?.(saved);
      } else {
        const { room: created } = await api.createRoom(form);
        open(`room:${created.id}`);
        onDone?.(created);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!room || !window.confirm(`Delete ${room.name}? The room's chat is deleted too.`)) return;
    try {
      await api.deleteRoom(room.id);
      open(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't delete.");
    }
  };

  const members = state.bots.filter((b) => form.memberIds.includes(b.id));

  return (
    <div className="flex flex-col">
      <div className="space-y-5">
        <Field label="Name">
          <input className={inputClass} value={form.name} maxLength={40} onChange={(e) => set("name", e.target.value)} placeholder="Launch crew" />
        </Field>
        <Field label="Topic" hint="Optional. Bots see it, and Jev uses it when routing.">
          <input className={inputClass} value={form.topic} maxLength={120} onChange={(e) => set("topic", e.target.value)} placeholder="Planning the v2 launch" />
        </Field>

        <div>
          <span className="mb-1.5 block text-[12.5px] font-medium text-mute">Members</span>
          {state.bots.length === 0 && <p className="text-sm text-mute">Make a bot first.</p>}
          <ul className="space-y-1 rounded-2xl bg-raised p-1.5">
            {state.bots.map((bot) => {
              const on = form.memberIds.includes(bot.id);
              return (
                <li key={bot.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggleMember(bot.id)}
                    className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-hover"
                  >
                    <BotAvatar bot={bot} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px]">{bot.name}</span>
                      <span className="block truncate text-[12.5px] text-mute">{bot.title || bot.description}</span>
                    </span>
                    <span
                      className={clsx(
                        "flex h-5 w-5 items-center justify-center rounded-full",
                        on ? "bg-accent text-accent-ink" : "ring-1 ring-line-strong",
                      )}
                    >
                      {on && <Check size={13} strokeWidth={3} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <Field label="Who answers when nobody is @mentioned">
          <Segmented
            value={form.responder}
            onChange={(v) => set("responder", v)}
            options={[
              { value: "auto", label: "Auto", hint: state.status?.keys.jev ? "Jev picks." : "Jev picks (needs key)." },
              { value: "lead", label: "Lead", hint: "The lead answers." },
              { value: "everyone", label: "Everyone", hint: "Each bot answers." },
            ]}
          />
        </Field>

        {members.length > 0 && (
          <Field label="Lead" hint="Answers when routing is unsure, and in Lead mode.">
            <select className={clsx(inputClass, "appearance-none")} value={form.leadId ?? ""} onChange={(e) => set("leadId", e.target.value || null)}>
              {members.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {room && (
          <div className="pt-2">
            <Button variant="danger" size="sm" onClick={remove}>
              Delete room
            </Button>
          </div>
        )}
      </div>

      {(dirty || !room) && (
        <div className="sticky bottom-0 -mx-5 mt-5 flex items-center justify-end gap-2 border-t border-line bg-side px-5 py-3">
          {room && (
            <Button variant="ghost" onClick={() => setForm(initial)}>
              Discard
            </Button>
          )}
          <Button variant="primary" onClick={save} disabled={saving || !form.name.trim() || (room && !dirty)}>
            {saving ? "Saving…" : room ? "Save changes" : "Create room"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function NewRoomDrawer({ onClose }: { onClose: () => void }) {
  return (
    <Drawer title="New room" onClose={onClose}>
      <RoomForm onDone={onClose} />
    </Drawer>
  );
}
