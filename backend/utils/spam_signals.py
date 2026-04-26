"""
Lightweight in-process spam-signal scorer for Community posts and comments.

Computes a 0-100 score + an array of reason codes. Designed to be cheap
enough to run on every write (post/comment) without DB lookups beyond a
small per-author rate-limit query.

Heuristics (each contributes a weighted score):
  • EXCESSIVE_LINKS         — 3+ http/https URLs in body                   +30
  • LINK_DOMAIN_BLOCKLIST   — known scam TLDs / shorteners (.ru, bit.ly)   +25
  • REPEATED_EMOJI_RUN      — same emoji 5+ times in a row                 +15
  • EMOJI_FLOOD             — >12 emojis in body                            +10
  • ALL_CAPS_BODY           — 70%+ uppercase letters in long body          +12
  • REPEATED_PUNCTUATION    — !!!! or ???? / 6+ same chars in row          +8
  • SCAM_KEYWORD            — 'investment', 'crypto giveaway', 'free $'    +25
  • SHORT_BODY_LINK         — body <40 chars but contains a link           +20
  • RAPID_POSTING (caller)  — author posted 5+ items in last 10 minutes    +30
  • DUPLICATE_CONTENT (caller) — exact body matches another post in 24h    +35
  • NEW_ACCOUNT_LINK        — author created <24h ago AND link in body     +20

A score >= 70 sets `spam: true` automatically (auto-hide).
A score in [40, 70) sets `auto_flagged: true` for admin review.
A score < 40 lets the post through but stores `spam_signals` for filtering.
"""
from __future__ import annotations
import re
from typing import Any, Dict, List, Optional

# ----- Static blocklists -----------------------------------------------------
_SCAM_KEYWORDS = [
    "free crypto", "free bitcoin", "free $", "double your money",
    "guaranteed profit", "investment opportunity", "click here to claim",
    "make $$$", "make money fast", "work from home easy", "telegram me for",
    "dm me to invest", "limited slots", "pump signal", "hot tip", "guaranteed roi",
    "send seed phrase", "send wallet", "verify wallet", "validate metamask",
    "airdrop claim", "presale", "100x guaranteed",
]
_BLOCKLIST_TLDS = [".ru", ".cn", ".tk", ".ml", ".ga", ".cf"]
_SHORTENERS = ["bit.ly", "tinyurl.com", "t.co/", "shorturl.at", "is.gd", "rb.gy", "rebrand.ly"]

_LINK_RE = re.compile(r"https?://[^\s)\]]+", re.IGNORECASE)
_EMOJI_RE = re.compile(
    r"[\U0001F300-\U0001FAFF\U0001F600-\U0001F64F\U00002600-\U000026FF\U0001F900-\U0001F9FF]"
)
_REPEATED_PUNCT_RE = re.compile(r"([!?.])\1{5,}")


def compute_spam_signals(
    body: str,
    *,
    author_recent_post_count: int = 0,
    duplicate_count_24h: int = 0,
    author_age_hours: Optional[float] = None,
) -> Dict[str, Any]:
    """Score body text against the heuristics above.

    Inputs that require DB context (author_recent_post_count,
    duplicate_count_24h, author_age_hours) are passed in by the caller so
    this function stays pure and trivially testable.

    Returns:
      {
        "score": 0-100,
        "signals": [str, ...],     # reason codes
        "auto_hide": bool,         # score >= 70
        "auto_flag": bool,         # 40 <= score < 70
      }
    """
    body_str = (body or "").strip()
    body_lower = body_str.lower()
    score = 0
    signals: List[str] = []

    # ----- Links -----
    links = _LINK_RE.findall(body_str)
    if len(links) >= 3:
        score += 30
        signals.append("EXCESSIVE_LINKS")
    if links:
        any_blocked = any(
            any(host in link.lower() for host in _SHORTENERS) or
            any(link.lower().split("?")[0].rstrip("/").endswith(tld) for tld in _BLOCKLIST_TLDS) or
            any(f".{tld.strip('.')}" in link.lower().split("/")[2] for tld in _BLOCKLIST_TLDS if "//" in link)
            for link in links
        )
        if any_blocked:
            score += 25
            signals.append("LINK_DOMAIN_BLOCKLIST")
        if len(body_str) < 40:
            score += 20
            signals.append("SHORT_BODY_LINK")

    # ----- Emojis -----
    emoji_count = len(_EMOJI_RE.findall(body_str))
    if emoji_count > 12:
        score += 10
        signals.append("EMOJI_FLOOD")
    # Same emoji 5+ in a row
    if emoji_count >= 5:
        runs = re.findall(r"((.)\2{4,})", _EMOJI_RE.sub(lambda m: m.group(0), body_str))
        # Simpler: scan emoji-only substring for runs
        emojis_only = "".join(_EMOJI_RE.findall(body_str))
        if emojis_only and any(emojis_only.count(c) >= 5 for c in set(emojis_only)):
            for c in set(emojis_only):
                if c * 5 in emojis_only:
                    score += 15
                    signals.append("REPEATED_EMOJI_RUN")
                    break

    # ----- ALL CAPS -----
    if len(body_str) >= 60:
        letters = [c for c in body_str if c.isalpha()]
        if letters:
            cap_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
            if cap_ratio >= 0.70:
                score += 12
                signals.append("ALL_CAPS_BODY")

    # ----- Repeated punctuation -----
    if _REPEATED_PUNCT_RE.search(body_str):
        score += 8
        signals.append("REPEATED_PUNCTUATION")

    # ----- Scam keywords -----
    matched_kw = [kw for kw in _SCAM_KEYWORDS if kw in body_lower]
    if matched_kw:
        score += 25
        signals.append("SCAM_KEYWORD")

    # ----- Caller-provided context -----
    if author_recent_post_count >= 5:
        score += 30
        signals.append("RAPID_POSTING")
    if duplicate_count_24h >= 1:
        score += 35
        signals.append("DUPLICATE_CONTENT")
    if author_age_hours is not None and author_age_hours < 24 and links:
        score += 20
        signals.append("NEW_ACCOUNT_LINK")

    score = min(100, score)
    return {
        "score": score,
        "signals": signals,
        "auto_hide": score >= 70,
        "auto_flag": 40 <= score < 70,
    }


__all__ = ["compute_spam_signals"]
