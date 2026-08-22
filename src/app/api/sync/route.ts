import { syncCatalog } from "@/lib/catalog/sync";

export const runtime = "nodejs";

export async function POST() {
  try {
    return Response.json(await syncCatalog());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "同步失败" },
      { status: 500 },
    );
  }
}
