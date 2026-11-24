"""Free Roofer Masters receptionist API.

Run locally with Ollama: ollama pull qwen2.5:7b-instruct
  pip install -r requirements.txt
  uvicorn main:app --host 0.0.0.0 --port 8000

Only the server holds the Supabase service-role key. Browser clients call /chat and /availability.
"""
from __future__ import annotations

import asyncio
import email
import imaplib
import json
import logging
import os
import re
import smtplib
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from email.header import decode_header
from email.message import EmailMessage
from email.utils import parseaddr
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
log = logging.getLogger("roofer-receptionist")
TZ = ZoneInfo("America/New_York")
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b-instruct")
HF_ENDPOINT = os.getenv("HF_ENDPOINT", "")
HF_TOKEN = os.getenv("HF_TOKEN", "")
ALLOWED_ORIGINS = [x.strip() for x in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if x.strip()]
SERVICE_TYPES = {"Roof Inspection", "Leak Repair", "Full Replacement Estimate", "Roof Repair", "Gutter Estimate", "Other"}
rate_buckets: dict[str, list[float]] = {}

class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: list[dict[str, str]] = Field(default_factory=list, max_length=20)
    lead_id: str | None = None
    channel: str = "chat"

class AvailabilityRequest(BaseModel):
    date: date

class BookingRequest(BaseModel):
    name: str
    phone: str
    email: str | None = None
    address: str
    service_type: str
    datetime: datetime
    notes: str = ""
    source: str = "ai_chat"

async def sb_request(method: str, path: str, *, params=None, payload=None, headers=None):
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(503, "Receptionist database is not configured")
    base_headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    base_headers.update(headers or {})
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.request(method, f"{SUPABASE_URL}/rest/v1/{path}",
            params=params, json=payload, headers=base_headers)
    if response.is_error:
        log.error("Supabase %s %s: %s", method, path, response.text[:500])
        raise HTTPException(502, "The CRM database could not complete that request")
    return response.json() if response.content else None

async def check_calendar_availability(day: date) -> list[dict[str, str]]:
    rows = await sb_request("POST", "rpc/get_available_slots", payload={"target_date": day.isoformat()})
    return [{"start": row["slot_start"], "end": row["slot_end"]} for row in rows]

async def upsert_lead(name: str, phone: str, email_addr: str | None, address: str, service: str, message: str) -> str:
    clean_phone = re.sub(r"[^+0-9]", "", phone)
    if len(clean_phone) < 7:
        raise HTTPException(422, "A valid callback phone number is required")
    existing = await sb_request("GET", "leads", params={
        "select": "id", "phone": f"eq.{phone}", "limit": "1"
    })
    if not existing and email_addr:
        existing = await sb_request("GET", "leads", params={
            "select": "id", "email": f"ilike.{email_addr}", "limit": "1"
        })
    data = {"name": name.strip(), "phone": phone.strip(), "email": email_addr or None,
            "address": address.strip(), "service": service, "message": message,
            "source": "chat", "status": "contacted", "page": "ai-receptionist"}
    if existing:
        lead_id = existing[0]["id"]
        await sb_request("PATCH", "leads", params={"id": f"eq.{lead_id}"}, payload=data)
        return lead_id
    created = await sb_request("POST", "leads", payload=data, headers={"Prefer": "return=representation"})
    return created[0]["id"]

async def book_crm_appointment(data: BookingRequest, channel: str | None = None) -> dict[str, Any]:
    if data.service_type not in SERVICE_TYPES:
        raise HTTPException(422, "Please choose a listed roofing service")
    if not data.datetime.tzinfo:
        raise HTTPException(422, "Appointment time must include a timezone")
    local = data.datetime.astimezone(TZ)
    if local.minute or local.second or local.microsecond:
        raise HTTPException(422, "Appointments must start on the hour")
    lead_id = await upsert_lead(data.name, data.phone, data.email, data.address,
                                data.service_type, data.notes or "Appointment booked by receptionist")
    source = {"chat": "ai_chat", "browser_voice": "ai_voice", "email": "email"}.get(channel or "", data.source)
    rows = await sb_request("POST", "rpc/book_roof_appointment", payload={
        "p_lead_id": lead_id, "p_customer_name": data.name, "p_customer_phone": data.phone,
        "p_customer_email": data.email, "p_property_address": data.address,
        "p_service_type": data.service_type, "p_start_time": local.isoformat(),
        "p_notes": data.notes, "p_source": source,
    })
    return {"lead_id": lead_id, "appointment": rows, "confirmation": f"You're scheduled for {local.strftime('%A, %B %-d at %-I:%M %p')} Eastern. Roofer Masters will see you then."}

async def save_log(lead_id: str | None, channel: str, direction: str, message: str, metadata=None):
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return
    try:
        await sb_request("POST", "receptionist_logs", payload={
            "lead_id": lead_id, "channel": channel, "direction": direction,
            "message": message[:12000], "metadata": metadata or {},
        })
    except Exception:
        log.exception("Could not store receptionist transcript")

SYSTEM_PROMPT = """You are Roofer Masters' friendly bilingual roofing receptionist serving Miami-Dade and Broward, Florida. Speak English or Spanish to match the visitor. Be warm, concise, honest. Services: roof inspections, leak repairs, roof repairs, full replacement estimates (metal, shingle, tile, flat), and gutters. Never invent availability, prices, warranties, or technical promises. Ask one question at a time. Collect name, callback phone, email if available, property address, requested service, preferred date. Business hours are Monday-Saturday 8 AM-6 PM Eastern, one-hour appointments. Do not say a booking is confirmed until book_crm_appointment succeeds.

You may request exactly one tool action by responding with ONLY JSON:
{"action":"check_calendar_availability","date":"YYYY-MM-DD"}
or when the visitor has explicitly selected/confirmed a returned slot and supplied all required details:
{"action":"book_crm_appointment","name":"...","phone":"...","email":"...","address":"...","service_type":"...","datetime":"ISO-8601 with -05:00 or -04:00 offset","notes":"..."}
Otherwise respond with ONLY JSON {"reply":"your natural language response"}.
Do not book based on a vague request. The visitor must explicitly confirm a specific available time.
"""

async def ask_model(messages: list[dict[str, str]]) -> str:
    if HF_ENDPOINT and HF_TOKEN:
        headers = {"Authorization": f"Bearer {HF_TOKEN}"}
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(HF_ENDPOINT, headers=headers, json={
                "inputs": "\n".join(f"{m['role']}: {m['content']}" for m in messages),
                "parameters": {"max_new_tokens": 500, "temperature": 0.25, "return_full_text": False},
            })
            response.raise_for_status()
            result = response.json()
            return result[0]["generated_text"] if isinstance(result, list) else result.get("generated_text", "")
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(f"{OLLAMA_URL}/api/chat", json={
            "model": OLLAMA_MODEL, "messages": messages, "stream": False,
            "format": "json", "options": {"temperature": 0.2},
        })
        response.raise_for_status()
        return response.json()["message"]["content"]

async def receptionist_turn(message: str, history: list[dict[str, str]], lead_id: str | None, channel: str):
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend([{"role": x["role"], "content": x["content"][:4000]} for x in history[-16:]
                     if x.get("role") in {"user", "assistant"} and isinstance(x.get("content"), str)])
    messages.append({"role": "user", "content": message})
    await save_log(lead_id, channel, "inbound", message)
    try:
        raw = await ask_model(messages)
        try:
            action = json.loads(raw)
        except json.JSONDecodeError:
            action = {"reply": raw}
        if action.get("action") == "check_calendar_availability":
            day = date.fromisoformat(action["date"])
            slots = await check_calendar_availability(day)
            if slots:
                answer = {"reply": "These times are available (Eastern): " + ", ".join(
                    datetime.fromisoformat(s["start"].replace("Z", "+00:00")).astimezone(TZ).strftime("%-I:%M %p")
                    for s in slots), "slots": slots}
            else:
                answer = {"reply": "I don't see any open appointments on that date. Would another day work?", "slots": []}
        elif action.get("action") == "book_crm_appointment":
            booking = BookingRequest(**{k: action[k] for k in BookingRequest.model_fields if k in action})
            result = await book_crm_appointment(booking, channel if channel in {"ai_chat","ai_voice","email"} else "ai_chat")
            answer = {"reply": result["confirmation"], "booking": result}
        else:
            answer = {"reply": str(action.get("reply", "How can I help with your roof today?"))}
    except HTTPException as exc:
        answer = {"reply": "I'm sorry, I couldn't complete that step. " + str(exc.detail)}
    except Exception:
        log.exception("AI receptionist turn failed")
        answer = {"reply": "I'm having trouble reaching our scheduling system right now. Please leave your name and phone number and our team will follow up."}
    await save_log(lead_id, channel, "outbound", answer["reply"], {"has_slots": bool(answer.get("slots"))})
    return answer

def allowed_rate(request: Request):
    ip = request.client.host if request.client else "unknown"
    now = time.time()
    recent = [t for t in rate_buckets.get(ip, []) if now - t < 60]
    if len(recent) >= 20:
        raise HTTPException(429, "Please wait a moment before sending another message")
    recent.append(now)
    rate_buckets[ip] = recent

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(email_worker()) if os.getenv("EMAIL_IMAP_HOST") else None
    yield
    if task:
        task.cancel()
        try: await task
        except asyncio.CancelledError: pass

app = FastAPI(title="Roofer Masters Free AI Receptionist", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_credentials=False,
                   allow_methods=["GET","POST"], allow_headers=["Content-Type"])

@app.get("/health")
async def health():
    return {"ok": True, "model": OLLAMA_MODEL if not HF_ENDPOINT else "huggingface-endpoint",
            "database_configured": bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)}

@app.post("/availability")
async def availability(body: AvailabilityRequest):
    return {"date": body.date.isoformat(), "slots": await check_calendar_availability(body.date)}

@app.post("/chat")
async def chat(body: ChatRequest, request: Request):
    allowed_rate(request)
    channel = body.channel if body.channel in {"chat","browser_voice"} else "chat"
    result = await receptionist_turn(body.message, body.history, body.lead_id,
                                     "browser_voice" if channel == "browser_voice" else "chat")
    return result

@app.post("/appointments")
async def create_appointment(body: BookingRequest):
    return await book_crm_appointment(body, body.source)

def decode_mime(value: str | None) -> str:
    if not value: return ""
    parts = decode_header(value)
    return "".join((chunk.decode(enc or "utf-8", errors="replace") if isinstance(chunk, bytes) else chunk)
                   for chunk, enc in parts)

def email_body(msg) -> str:
    chunks = []
    for part in msg.walk() if msg.is_multipart() else [msg]:
        if part.get_content_type() == "text/plain" and part.get_content_disposition() != "attachment":
            payload = part.get_payload(decode=True)
            if payload: chunks.append(payload.decode(part.get_content_charset() or "utf-8", errors="replace"))
    return "\n".join(chunks).strip()[:4000]

def email_worker_sync():
    host, user, password = os.getenv("EMAIL_IMAP_HOST"), os.getenv("EMAIL_USER"), os.getenv("EMAIL_APP_PASSWORD")
    if not all([host, user, password]): return
    mailbox = imaplib.IMAP4_SSL(host, int(os.getenv("EMAIL_IMAP_PORT", "993")))
    mailbox.login(user, password)
    mailbox.select("INBOX")
    status, data = mailbox.search(None, "UNSEEN")
    if status != "OK": mailbox.logout(); return
    for msg_id in data[0].split()[:10]:
        status, fetched = mailbox.fetch(msg_id, "(RFC822)")
        if status != "OK": continue
        msg = email.message_from_bytes(fetched[0][1])
        sender_name, sender_addr = parseaddr(msg.get("From", ""))
        subject = decode_mime(msg.get("Subject")) or "Roofing inquiry"
        body = email_body(msg)
        if not sender_addr or not body: mailbox.store(msg_id, "+FLAGS", "\\Seen"); continue
        # Ask the same model brain; email booking still requires the sender's explicit slot confirmation.
        response = asyncio.run(receptionist_turn(
            f"Incoming customer email from {sender_name} <{sender_addr}>. Subject: {subject}\n{body}\nReply as an email. Ask for missing contact/address/service details and offer availability. Do not claim a booking unless the customer explicitly confirmed a slot.",
            [], None, "email"))
        reply = EmailMessage()
        reply["Subject"] = "Re: " + subject
        reply["From"] = user
        reply["To"] = sender_addr
        reply.set_content(response["reply"] + "\n\nRoofer Masters\n(305) 942-3093\nroofermasters@gmail.com")
        with smtplib.SMTP_SSL(os.getenv("EMAIL_SMTP_HOST", "smtp.gmail.com"),
                              int(os.getenv("EMAIL_SMTP_PORT", "465"))) as smtp:
            smtp.login(user, password)
            smtp.send_message(reply)
        mailbox.store(msg_id, "+FLAGS", "\\Seen")
    mailbox.logout()

async def email_worker():
    interval = max(60, int(os.getenv("EMAIL_POLL_SECONDS", "180")))
    while True:
        try: await asyncio.to_thread(email_worker_sync)
        except asyncio.CancelledError: raise
        except Exception: log.exception("Email worker failed")
        await asyncio.sleep(interval)
