import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { SplitWizard } from "@/components/split/split-wizard";
import { site } from "@/config/site";
import { features } from "@/env";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <SplitWizard mode={{ kind: "guest", defaultCurrency: site.defaultCurrency }} scanEnabled={features.scanning} />
      <SiteFooter />
    </>
  );
}
