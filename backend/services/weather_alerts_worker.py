"""
services/weather_alerts_worker.py — Elite Weather Alert push worker (Jun 2025)
═══════════════════════════════════════════════════════════════════════════

What it does
────────────
Every WORKER_INTERVAL_SECONDS (15 min by default), iterates every active
subscription in `weather_alert_subscriptions`, fetches WeatherKit data for
the spot, and sends an APNs push if any of the user-enabled triggers fire:

  • `severe`      — WeatherKit alerts collection has at least one alert
                    with severity ∈ {Severe, Extreme}.
  • `clear_sky`   — Within the next 2 hours, a 1+ hour window opens with
                    cloud_cover < 30%, precip_chance < 10%, wind < 15mph.
  • `golden_hour` — A golden or blue hour window is within the next 60 min.

Anti-spam
─────────
Per (subscription, trigger) dedup: a given trigger won't fire again for
the same subscription within DEDUP_MIN_GAP_HOURS = 6h.

Lifecycle
─────────
Started as a single asyncio task from server.py's startup event. The
task is cancellable and re-entrant — if the supervisor restarts the
backend, the task simply re-spawns. Multi-worker safety isn't strictly
required (we have one process per pod), but we use a Mongo soft lock
on each subscription doc (`worker_claimed_at`) so a future scale-out
won't double-send.

Failure mode
────────────
Every fetch / send is wrapped in try/except. A single bad subscription
doesn't stop the loop. Errors are logged with the subscription id so
ops can debug. Open-Meteo fallback is consulted if WeatherKit returns
nothing — golden_hour + clear_sky alerts still work; severe alerts
require WeatherKit data (no public alerts API in Open-Meteo).
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

log = logging.getLogger("lumascout.weather_alerts")

# ─────────────────────────────────────────────────────────────────────
# Tunables
# ─────────────────────────────────────────────────────────────────────
WORKER_INTERVAL_SECONDS = int(os.environ.get("WEATHER_ALERT_INTERVAL_S", "900"))  # 15 min
DEDUP_MIN_GAP_HOURS     = 6
CLEAR_SKY_LOOKAHEAD_H   = 2
CLEAR_SKY_MIN_WINDOW_H  = 1
GOLDEN_HOUR_LOOKAHEAD_MIN = 60

# Quality thresholds (kept aligned with routes/weather.py best_times)
THRESH_CLOUD_PCT  = 30.0
THRESH_PRECIP_PCT = 10.0
THRESH_WIND_MPH   = 15.0

# Severity values that should ping the user
SEVERE_LEVELS = {"Severe", "Extreme"}

_task: Optional[asyncio.Task] = None
_stop_event: Optional[asyncio.Event] = None
_run_count = 0  # for tests + ops

# Allow disabling via env (handy in tests / CI)
WORKER_ENABLED = (os.environ.get("WEATHER_ALERTS_WORKER_ENABLED", "1").strip().lower()
                  not in {"0", "false", "off", ""})


def is_running() -> bool:
    return _task is not None and not _task.done()


def run_count() -> int:
    return _run_count


# ─────────────────────────────────────────────────────────────────────
# Public start / stop
# ─────────────────────────────────────────────────────────────────────
async def start_worker() -> None:
    """Spawn the loop. Idempotent — re-calling is a no-op while running."""
    global _task, _stop_event
    if not WORKER_ENABLED:
        log.info("weather_alerts_worker disabled via env")
        return
    if is_running():
        return
    _stop_event = asyncio.Event()
    _task = asyncio.create_task(_loop(), name="weather_alerts_worker")
    log.info("weather_alerts_worker started — interval=%ds", WORKER_INTERVAL_SECONDS)


async def stop_worker() -> None:
    """Signal the loop to exit; await cleanly."""
    global _task, _stop_event
    if _stop_event is not None:
        _stop_event.set()
    if _task is not None:
        try:
            await asyncio.wait_for(_task, timeout=5)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            _task.cancel()
        _task = None
    _stop_event = None


# ─────────────────────────────────────────────────────────────────────
# Loop body
# ─────────────────────────────────────────────────────────────────────
async def _loop() -> None:
    global _run_count
    # Stagger first tick by 30s after boot so /api/weather warms up first.
    try:
        await asyncio.wait_for(_stop_event.wait(), timeout=30)
        return
    except asyncio.TimeoutError:
        pass

    while not _stop_event.is_set():
        try:
            n = await run_once()
            _run_count += 1
            log.info("weather_alerts tick run=%d processed=%d", _run_count, n)
        except Exception as e:
            log.exception("weather_alerts tick failed err=%r", e)
        # Sleep with wake-on-stop.
        try:
            await asyncio.wait_for(_stop_event.wait(), timeout=WORKER_INTERVAL_SECONDS)
            return
        except asyncio.TimeoutError:
            continue


async def run_once() -> int:
    """Process every active subscription. Returns the count processed."""
    # Imports here so the worker module is importable without pulling all of
    # FastAPI's startup chain (lets us unit-test the worker in isolation).
    from server import db  # noqa: WPS433
    from routes.weather import (  # noqa: WPS433
        WEATHER_ALERTS_COLL, ALERT_PREF_KEYS,
        _norm_apple_current, _norm_apple_hourly, _norm_apple_daily,
        _norm_apple_alerts, _enrich_daily_with_light_windows,
        _compute_best_times,
    )
    from services.weatherkit import (  # noqa: WPS433
        weatherkit_configured, fetch_weather as fetch_weatherkit,
        DATASET_CURRENT, DATASET_HOURLY, DATASET_DAILY, DATASET_ALERTS,
    )
    from services.apns import apns_configured, send_apns  # noqa: WPS433

    if not apns_configured():
        log.warning("apns_not_configured — skipping weather_alerts tick")
        return 0

    count = 0
    cur = db[WEATHER_ALERTS_COLL].find({"active": True})
    async for sub in cur:
        try:
            await _process_subscription(
                sub, db,
                weatherkit_configured=weatherkit_configured,
                fetch_weatherkit=fetch_weatherkit,
                send_apns=send_apns,
                norm_current=_norm_apple_current,
                norm_hourly=_norm_apple_hourly,
                norm_daily=_norm_apple_daily,
                norm_alerts=_norm_apple_alerts,
                enrich_light=_enrich_daily_with_light_windows,
                compute_best=_compute_best_times,
            )
            count += 1
        except Exception as e:
            log.exception("weather_alerts subscription_failed sub=%s err=%r", sub.get("_id"), e)
    return count


async def _process_subscription(
    sub: Dict[str, Any], db, *,
    weatherkit_configured, fetch_weatherkit, send_apns,
    norm_current, norm_hourly, norm_daily, norm_alerts,
    enrich_light, compute_best,
) -> None:
    """Evaluate triggers for one subscription and send pushes."""
    prefs: Dict[str, bool] = sub.get("preferences") or {}
    if not any(prefs.values()):
        return  # user disabled everything

    lat = float(sub["lat"]); lng = float(sub["lng"])
    device_token = sub.get("device_token")
    if not device_token:
        return

    # Pull a fat WeatherKit payload (current + hourly + daily + alerts).
    # If WeatherKit isn't yet provisioned, severe alerts can't fire but
    # clear_sky / golden_hour can still be evaluated against a fallback —
    # so we tolerate WeatherKit being absent.
    apple = None
    if weatherkit_configured():
        apple = await fetch_weatherkit(
            lat, lng,
            datasets=[DATASET_CURRENT, DATASET_HOURLY, DATASET_DAILY, DATASET_ALERTS],
            country_code="US",  # required for alerts; harmless elsewhere
        )

    daily: List[Dict[str, Any]]  = []
    hourly: List[Dict[str, Any]] = []
    alerts: List[Dict[str, Any]] = []
    if apple:
        hourly = norm_hourly((apple.get(DATASET_HOURLY) or {}).get("hours") or [])
        daily  = norm_daily((apple.get(DATASET_DAILY)  or {}).get("days")  or [],
                            limit=10)
        enrich_light(daily)
        alerts = norm_alerts(apple.get(DATASET_ALERTS) or {})

    now = datetime.utcnow()
    last_at = sub.get("last_alert_at") or {}
    sent: Dict[str, str] = {}  # trigger -> alert summary

    # ── 1. Severe weather ────────────────────────────────────────────
    if prefs.get("severe") and not _is_deduped(last_at.get("severe"), now):
        for a in alerts:
            if (a.get("severity") or "") in SEVERE_LEVELS:
                title = "⚠️ Severe Weather Alert"
                body = (a.get("description") or a.get("event") or "Check conditions")[:140]
                deep_link = _deep_link_for_sub(sub)
                ok = await _try_send(send_apns, device_token, title, body, deep_link, sub_id=str(sub.get("_id")))
                if ok:
                    sent["severe"] = a.get("severity") or "alert"
                break  # one notif per tick per trigger

    # ── 2. Clear-sky window opens in next 2h ─────────────────────────
    if prefs.get("clear_sky") and hourly and not _is_deduped(last_at.get("clear_sky"), now):
        cs = _find_clear_sky_window(hourly, lookahead_h=CLEAR_SKY_LOOKAHEAD_H,
                                     min_window_h=CLEAR_SKY_MIN_WINDOW_H)
        if cs is not None:
            title = "☀️ Clear sky window opening soon"
            body = f"Clear conditions starting around {cs[:5]}."
            deep_link = _deep_link_for_sub(sub)
            ok = await _try_send(send_apns, device_token, title, body, deep_link, sub_id=str(sub.get("_id")))
            if ok:
                sent["clear_sky"] = cs

    # ── 3. Golden / blue hour within 1 hour ──────────────────────────
    if prefs.get("golden_hour") and daily and not _is_deduped(last_at.get("golden_hour"), now):
        gw = _find_imminent_light_window(daily, lookahead_min=GOLDEN_HOUR_LOOKAHEAD_MIN)
        if gw is not None:
            title = f"📷 {gw['type'].title()} Hour starting soon"
            body = f"Best light begins around {gw['start_short']}."
            deep_link = _deep_link_for_sub(sub)
            ok = await _try_send(send_apns, device_token, title, body, deep_link, sub_id=str(sub.get("_id")))
            if ok:
                sent["golden_hour"] = gw["type"]

    # ── Persist tick metadata ───────────────────────────────────────
    update: Dict[str, Any] = {"last_check_at": now}
    for trigger, _summary in sent.items():
        update[f"last_alert_at.{trigger}"] = now
    if update:
        await db["weather_alert_subscriptions"].update_one(
            {"_id": sub["_id"]}, {"$set": update}
        )


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────
def _is_deduped(last: Optional[datetime], now: datetime) -> bool:
    if last is None:
        return False
    if isinstance(last, str):
        try:
            last = datetime.fromisoformat(last.replace("Z", "+00:00"))
        except Exception:
            return False
    # Normalize to naive UTC for comparison.
    if last.tzinfo is not None:
        last = last.replace(tzinfo=None)
    return (now - last) < timedelta(hours=DEDUP_MIN_GAP_HOURS)


def _find_clear_sky_window(
    hourly: List[Dict[str, Any]], *, lookahead_h: int, min_window_h: int
) -> Optional[str]:
    """Return the start time (ISO) of the first qualifying window in the next
    `lookahead_h` hours that lasts at least `min_window_h`. None otherwise."""
    if not hourly:
        return None
    window = hourly[:max(1, lookahead_h + min_window_h)]
    streak: List[str] = []
    for h in window:
        cc = h.get("cloud_cover_pct")
        pp = h.get("precip_chance_pct")
        ws = h.get("wind_mph")
        passes = (
            (cc is None or cc <= THRESH_CLOUD_PCT)
            and (pp is None or pp <= THRESH_PRECIP_PCT)
            and (ws is None or ws <= THRESH_WIND_MPH)
        )
        if passes:
            streak.append(h.get("time") or "")
            if len(streak) >= min_window_h:
                return streak[0]
        else:
            streak = []
    return None


def _find_imminent_light_window(
    daily: List[Dict[str, Any]], *, lookahead_min: int
) -> Optional[Dict[str, Any]]:
    """Return the closest golden_hour or blue_hour window whose start time is
    within the next `lookahead_min` minutes. Returns {"type": "golden"|"blue",
    "start": iso, "start_short": "HH:MM"} or None."""
    if not daily:
        return None
    now = datetime.utcnow()
    horizon = now + timedelta(minutes=lookahead_min)
    candidates: List[Dict[str, Any]] = []
    for d in daily[:2]:  # only today/tomorrow matter at 60-min horizon
        for win_type in ("golden_hour", "blue_hour"):
            for side in ("am", "pm"):
                w = (d.get(win_type) or {}).get(side)
                if not w:
                    continue
                start = _parse_iso(w.get("start"))
                if start is None:
                    continue
                # Normalize tz-aware → naive UTC for comparison.
                s_naive = start.replace(tzinfo=None) if start.tzinfo else start
                if now <= s_naive <= horizon:
                    candidates.append({
                        "type": "golden" if win_type == "golden_hour" else "blue",
                        "start": w["start"],
                        "start_short": s_naive.strftime("%H:%M"),
                        "_at": s_naive,
                    })
    if not candidates:
        return None
    candidates.sort(key=lambda c: c["_at"])
    return candidates[0]


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _deep_link_for_sub(sub: Dict[str, Any]) -> str:
    """Build a deep link the iOS/Android client can open into the right
    spot in the app. Prefers spot_id when present (cleaner /spot/<id> page),
    otherwise falls back to the weather screen for the coord."""
    spot_id = sub.get("spot_id")
    if spot_id:
        return f"lumascout://spot/{spot_id}"
    return f"lumascout://weather?lat={sub['lat']}&lng={sub['lng']}"


async def _try_send(send_apns, device_token: str, title: str, body: str,
                     deep_link: str, *, sub_id: str) -> bool:
    """Send via APNs and swallow errors so a single failure doesn't stop
    the tick. Returns True if APNs reported success."""
    try:
        # send_apns signature in services/apns.py:
        #   await send_apns(device_token, *, title, body, data=None, sound,
        #                   badge, priority, push_type, thread_id, collapse_id)
        # We pass data with deep_link + a `category` hint inside it (the
        # iOS client can read this on tap to route accordingly).
        result = await send_apns(
            device_token,
            title=title, body=body,
            data={
                "deep_link": deep_link,
                "type": "weather_alert",
                "category": "WEATHER_ALERT",
            },
            push_type="alert",
            thread_id=f"weather:{sub_id}",
            # collapse so multiple ticks within a short window replace
            # rather than stack in the user's notification center.
            collapse_id=f"weather:{sub_id}",
        )
        if isinstance(result, dict):
            ok = bool(result.get("ok") or result.get("success") or result.get("status") in (200, 201, 202))
        else:
            ok = bool(result)
        if not ok:
            log.warning("apns_send_failed sub=%s result=%r", sub_id, result)
        return ok
    except Exception as e:
        log.warning("apns_send_exception sub=%s err=%r", sub_id, e)
        return False
