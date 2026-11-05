import { NextResponse } from "next/server";
import { validateSpeechBody, redactAudioError } from "../audioValidation.js";
import { callAudioSpeech } from "../audioService.js";

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
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validation = validateSpeechBody(body);
    if (validation.error) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const upstreamResponse = await callAudioSpeech(validation.value, request);

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

    const contentType = upstreamResponse.headers.get("content-type") || "audio/mpeg";
    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(upstreamResponse.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("[audio/speech]", redactAudioError(error));
    return NextResponse.json({ error: redactAudioError(error) }, { status: 502 });
  }
}
