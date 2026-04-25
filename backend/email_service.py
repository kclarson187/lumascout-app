"""email_service.py — Item #7 (Apr 2026).

Thin Postmark client that LumaScout uses to send transactional + support
mails from the correct sender for each kind of message:

  • SENDER_NOREPLY  -> noreply@lumascout.app  (verification, password
                                              reset, transactional notices)
  • SENDER_SUPPORT  -> support@lumascout.app  (support replies, contact
                                              forms, app store support)
  • SENDER_ADMIN    -> admin@lumascout.app    (internal admin alerts,
                                              moderation, abuse reports)

Usage:
    from email_service import send_email, SENDER_NOREPLY
    await send_email(
        to='user@example.com',
        subject='Verify your new email',
        text_body='Click...',
        sender=SENDER_NOREPLY,
    )

On failure (no token, network error) the function logs and returns
``False`` — it never raises into the caller. This keeps the API up even
if the email vendor is having a bad day.
"""
from __future__ import annotations
import os
import logging
from typing import Optional
import httpx
from dotenv import load_dotenv

load_dotenv()
log = logging.getLogger("email_service")

POSTMARK_TOKEN = os.environ.get("POSTMARK_SERVER_TOKEN", "")
POSTMARK_API = "https://api.postmarkapp.com/email"

# Sender map — Apr 2026 product spec.
SENDER_NOREPLY = "LumaScout <noreply@lumascout.app>"
SENDER_SUPPORT = "LumaScout Support <support@lumascout.app>"
SENDER_ADMIN = "LumaScout Admin <admin@lumascout.app>"


async def send_email(
    *,
    to: str,
    subject: str,
    text_body: str,
    html_body: Optional[str] = None,
    sender: str = SENDER_NOREPLY,
    tag: Optional[str] = None,
) -> bool:
    """Send a Postmark transactional email. Returns True on 200, else False.

    Failure modes (all logged, never raised):
      - missing POSTMARK_SERVER_TOKEN (dev/staging without keys)
      - non-200 from Postmark
      - network/timeout error
    """
    if not POSTMARK_TOKEN:
        # MOCKED: no token in env yet. Log to backend stdout so dev / QA
        # can still trace the intended message.
        log.warning(
            "[email:MOCKED] no POSTMARK_SERVER_TOKEN — would send sender=%s to=%s subject=%s",
            sender, to, subject,
        )
        return False
    payload = {
        "From": sender,
        "To": to,
        "Subject": subject,
        "TextBody": text_body,
        "MessageStream": "outbound",
    }
    if html_body:
        payload["HtmlBody"] = html_body
    if tag:
        payload["Tag"] = tag
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                POSTMARK_API,
                json=payload,
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "X-Postmark-Server-Token": POSTMARK_TOKEN,
                },
            )
            if r.status_code >= 300:
                log.error("[email] postmark error status=%s body=%s", r.status_code, r.text[:200])
                return False
            return True
    except Exception as e:
        log.exception("[email] postmark exception: %s", e)
        return False
