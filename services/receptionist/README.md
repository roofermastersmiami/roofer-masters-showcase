# Roofer Masters Free AI Receptionist

## Run locally (no paid AI key)
1. Install Ollama from https://ollama.com and run `ollama pull qwen2.5:7b-instruct`.
2. Create a Python 3.11+ environment, then `pip install -r requirements.txt`.
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the server only.
4. Set `ALLOWED_ORIGINS` to your website and CRM origins.
5. Run `uvicorn main:app --host 0.0.0.0 --port 8000`.
6. In Lovable project environment settings, set `VITE_RECEPTIONIST_API_URL` to the public HTTPS URL of this FastAPI service, then rebuild the website.
7. Include the exact website origin(s) in the backend `ALLOWED_ORIGINS` value (comma-separated). Keep `SUPABASE_SERVICE_ROLE_KEY` only on the Python server; never add it to Vite variables.

For a hosted service, run Ollama on the same host/container and keep the default `OLLAMA_URL`, or set `OLLAMA_URL` to a private Ollama server reachable by the API. Do not expose an unauthenticated Ollama port to the public internet.

Optional email worker: set `EMAIL_IMAP_HOST`, `EMAIL_USER`, `EMAIL_APP_PASSWORD`; Gmail uses `imap.gmail.com` and an App Password, plus SMTP host `smtp.gmail.com`. Do not commit credentials.

Optional Hugging Face inference: set `HF_ENDPOINT` and `HF_TOKEN`; free-tier quotas and model availability are controlled by Hugging Face and may change. Ollama is the no-account/no-token route.

## Notes
- Supabase service-role key never belongs in the browser.
- The calendar is Eastern time and books only future Monday-Saturday slots, 8 AM-6 PM, one hour each.
- PostgreSQL transaction locking is the final double-booking guard.
- Browser speech recognition support varies by browser/device; it is not a phone call and has no phone-number dialing capability.
- Free hosting tiers may sleep, limit compute, or change terms. No paid API is required, but 24/7 hosted availability cannot be promised on a free plan.
