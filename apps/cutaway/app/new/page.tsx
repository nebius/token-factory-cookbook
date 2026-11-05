import { redirect } from "next/navigation";
import { GenerationView } from "@/components/gen/GenerationView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Designing" };

export default async function NewPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const id = Number((await searchParams).id);
  if (!Number.isInteger(id) || id <= 0) redirect("/");
  return <GenerationView id={id} />;
}
