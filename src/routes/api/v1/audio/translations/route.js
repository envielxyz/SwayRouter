import { NextResponse } from "next/server";
import { validateAudioFile, redactAudioError } from "../audioValidation.js";
import { callAudioTranslation } from "../audioService.js";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export async function POST(request) {
  try {
    const contentType = String(request.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ error: "multipart/form-data is required" }, { status: 400 });
    }

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Failed to parse multipart form data" }, { status: 400 });
    }

    const file = formData.get("file");
    const fileValidation = validateAudioFile(file);
    if (fileValidation.error) {
      return NextResponse.json({ error: fileValidation.error }, { status: 400 });
    }

    const model = String(formData.get("model") || "").trim();
    if (!model) {
      return NextResponse.json({ error: "model is required" }, { status: 400 });
    }

    const upstreamResponse = await callAudioTranslation(formData, request);

    if (!upstreamResponse.ok) {
      const errText = await upstreamResponse.text();
      let errPayload;
      try {
        errPayload = JSON.parse(errText);
      } catch {
        errPayload = { error: errText || `Audio provider returned HTTP ${upstreamResponse.status}` };
      }
      return NextResponse.json(errPayload, { status: upstreamResponse.status });
    }

    const respContentType = upstreamResponse.headers.get("content-type") || "application/json";
    const headers = new Headers();
    headers.set("Content-Type", respContentType);
    headers.set("Access-Control-Allow-Origin", "*");

    if (respContentType.includes("json")) {
      const json = await upstreamResponse.json();
      return NextResponse.json(json, { headers });
    }

    const text = await upstreamResponse.text();
    return new Response(text, { status: 200, headers });
  } catch (error) {
    console.error("[audio/translations]", redactAudioError(error));
    return NextResponse.json({ error: redactAudioError(error) }, { status: 502 });
  }
}
