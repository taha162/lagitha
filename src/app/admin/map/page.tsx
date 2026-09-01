import { ar } from "@/i18n/ar";
import { mapPoints } from "@/lib/services/admin";
import { PageHeader, Panel } from "@/components/admin/panel";
import { AdminMap } from "./admin-map";

export const dynamic = "force-dynamic";
export const metadata = { title: ar.admin.nav.map };

export default async function AdminMapPage() {
  const reports = await mapPoints(2000);

  return (
    <>
      <PageHeader title={ar.admin.map.title} description={ar.admin.map.note} />

      <Panel>
        <AdminMap
          points={reports.map((report) => ({
            id: report.id,
            reference: report.reference,
            title: report.title,
            type: report.type,
            status: report.status,
            lat: report.approxLat,
            lng: report.approxLng,
            category: report.category.nameAr,
          }))}
        />
      </Panel>
    </>
  );
}
