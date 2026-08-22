import { getCatalog } from "@/lib/catalog/query";
import type { CatalogView } from "@/lib/catalog/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const view = new URL(request.url).searchParams.get("view");
  const selectedView: CatalogView = view === "offerings" ? "offerings" : "models";
  return Response.json(getCatalog(selectedView));
}
