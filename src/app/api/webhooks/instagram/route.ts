import { NextResponse } from "next/server";
import { getDatabase } from "@/db/client";
import { getEnvironment } from "@/env";
import {
  persistWebhookMessages,
  verifyMetaSignature
} from "@/integrations/instagram/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const environment = getEnvironment();
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    token &&
    challenge &&
    environment.INSTAGRAM_WEBHOOK_VERIFY_TOKEN &&
    token === environment.INSTAGRAM_WEBHOOK_VERIFY_TOKEN
  ) {
    return new Response(challenge, { status: 200 });
  }

  return NextResponse.json(
    { error: "Falha na verificação do webhook." },
    { status: 403 }
  );
}

export async function POST(request: Request): Promise<Response> {
  const environment = getEnvironment();

  if (!environment.INSTAGRAM_APP_SECRET) {
    return NextResponse.json(
      { error: "Webhook não configurado." },
      { status: 503 }
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyMetaSignature(rawBody, signature, environment.INSTAGRAM_APP_SECRET)) {
    return NextResponse.json(
      { error: "Assinatura inválida." },
      { status: 401 }
    );
  }

  let payload: unknown;

  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json(
      { error: "Corpo JSON inválido." },
      { status: 400 }
    );
  }

  try {
    const result = persistWebhookMessages(
      getDatabase().sqlite,
      rawBody,
      payload
    );
    return NextResponse.json({ received: true, ...result });
  } catch {
    return NextResponse.json(
      { error: "Evento do webhook não reconhecido." },
      { status: 400 }
    );
  }
}
