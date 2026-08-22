import { z } from "zod";
import {
  deleteWorkbenchCredential,
  getWorkbenchCredential,
  getWorkbenchCredentialStatuses,
  saveWorkbenchCredential,
} from "@/lib/catalog/workbench-credentials";

export const runtime = "nodejs";

const uidSchema = z.string().min(1).max(300);
const saveSchema = z.object({
  uid: uidSchema,
  apiKey: z.string().trim().min(1).max(2_000),
});
const uidBodySchema = z.object({ uid: uidSchema });

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const parsed = z.array(uidSchema).max(100).safeParse(new URL(request.url).searchParams.getAll("uid"));
  if (!parsed.success) {
    return Response.json({ error: "模型 ID 列表无效。" }, { status: 400, headers: noStore });
  }
  return Response.json(
    { configured: getWorkbenchCredentialStatuses(parsed.data) },
    { headers: noStore },
  );
}

export async function PUT(request: Request) {
  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "API Key 或模型 ID 无效。" }, { status: 400, headers: noStore });
  }
  saveWorkbenchCredential(parsed.data.uid, parsed.data.apiKey);
  return Response.json({ saved: true }, { headers: noStore });
}

export async function POST(request: Request) {
  const parsed = uidBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "模型 ID 无效。" }, { status: 400, headers: noStore });
  }
  const apiKey = getWorkbenchCredential(parsed.data.uid);
  if (!apiKey) {
    return Response.json({ error: "这个模型尚未保存 API Key。" }, { status: 404, headers: noStore });
  }
  return Response.json({ apiKey }, { headers: noStore });
}

export async function DELETE(request: Request) {
  const parsed = uidBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "模型 ID 无效。" }, { status: 400, headers: noStore });
  }
  return Response.json(
    { deleted: deleteWorkbenchCredential(parsed.data.uid) },
    { headers: noStore },
  );
}
