#!/usr/bin/env python3
"""
Submit multiple raw-text briefs through /api/brief-to-ifc/v3/runs,
poll until each completes, download IFCs to disk.

Unlike `run-eval-one.sh` (which posts pre-enriched briefSpec to skip
Layer 1), this script posts the RAW BRIEF TEXT so the full pipeline
(enrichment + agent loop) is exercised — same path a canvas user
takes. Cost is correspondingly higher: ~$0.20-0.50 per brief.

Usage:
  python3 scripts/forensics/run-multi-brief-eval.py <cookie-file> <out-dir>

Output (one per brief):
  <out-dir>/<stem>-submit.json   — initial /runs response
  <out-dir>/<stem>-status.json   — final status payload
  <out-dir>/<stem>-logs.json     — full pipeline logs
  <out-dir>/<stem>.ifc           — the generated IFC2X3 file
  <out-dir>/progress.log         — append-only progress log
  <out-dir>/runs.json            — index of all runIds keyed by stem
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

BASE_URL = os.environ.get("BASE_URL", "https://trybuildflow.in")
HARD_TIMEOUT_SEC = int(os.environ.get("HARD_TIMEOUT_SEC", "600"))
POLL_INTERVAL_SEC = int(os.environ.get("POLL_INTERVAL_SEC", "5"))
COST_CAP_USD = float(os.environ.get("COST_CAP_USD", "2.5"))

BRIEFS = [
    (
        "bathroom",
        "Small bathroom, 2 by 2.5 metres, 2.4m ceiling height. One shower in the corner, "
        "one sink along one wall, one toilet against the opposite wall, one small window "
        "above the sink. Walls in light tile. Concrete floor.",
    ),
    (
        "home-office",
        "Home office, 3.5 by 4 metres, 2.8m ceiling. One L-shaped desk along the north wall, "
        "one office chair, two bookshelves against the east wall, one whiteboard on the west "
        "wall, large window on the south wall. Wooden floor, white walls.",
    ),
    (
        "clinic-reception",
        "Small clinic reception area, 8 by 6 metres total, 3m ceiling. Reception desk in one "
        "corner (2 by 1m). Waiting area with 4 chairs along the south wall. Door to "
        "consultation room on the east side. Door to storage on the west side. Two large "
        "windows on the north wall. Light vinyl floor, off-white walls.",
    ),
    (
        "l-shape-office",
        "L-shaped open office, with one 10m long arm by 4m wide and a 4m by 4m extension at "
        "right angles. 3.2m ceiling height. 8 workstations in the long arm laid out in two "
        "rows of 4 desks, a meeting table seating 6 in the extension, kitchenette with sink "
        "and counter in the corner where the L joins. Polished concrete floor, exposed "
        "ceiling, glass partitions for the meeting area.",
    ),
    (
        "coworking-space",
        "Co-working space, 20 by 15 metres, 4m ceiling. Open desks area in the centre "
        "containing 12 workstations laid out in 3 rows of 4. Two phone booths along the east "
        "wall (each 1.5 by 1.5 metres). Coffee and snack area in the north-west corner (4 by "
        "3 metres). Three small meeting rooms along the south wall (each 3 by 3 metres). "
        "Reception and entrance in the south-east corner. Maximum natural light from large "
        "windows on the north wall. Polished concrete floor, white walls.",
    ),
]


def http_request(method, url, *, cookie, body=None, timeout=300):
    headers = {"Cookie": f"__Secure-authjs.session-token={cookie}"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(body_text)
        except Exception:
            return e.code, {"raw": body_text[:1000]}
    except Exception as e:
        return -1, {"error": str(e)}


def log(out_dir, msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(out_dir / "progress.log", "a") as f:
        f.write(line + "\n")


def main():
    if len(sys.argv) < 3:
        print("usage: run-multi-brief-eval.py <cookie-file> <out-dir>", file=sys.stderr)
        sys.exit(2)
    cookie = Path(sys.argv[1]).read_text().strip()
    out_dir = Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)

    # Reset progress log
    (out_dir / "progress.log").write_text("")
    log(out_dir, f"START — {len(BRIEFS)} briefs, base={BASE_URL}")

    # ─── Submit all 5 ───────────────────────────────────────────────────────
    runs = []
    for stem, text in BRIEFS:
        log(out_dir, f"SUBMIT {stem} (len={len(text)})")
        status, resp = http_request(
            "POST",
            f"{BASE_URL}/api/brief-to-ifc/v3/runs",
            cookie=cookie,
            body={"brief": text, "cost_cap_usd": COST_CAP_USD},
            timeout=300,
        )
        (out_dir / f"{stem}-submit.json").write_text(
            json.dumps({"http": status, "response": resp}, indent=2)
        )
        run_id = resp.get("runId") if isinstance(resp, dict) else None
        if status >= 200 and status < 300 and run_id:
            log(out_dir, f"  → {stem}: runId={run_id} (HTTP {status})")
            runs.append({
                "stem": stem,
                "runId": run_id,
                "briefLen": len(text),
                "status": "PENDING",
                "submitted_at": time.time(),
            })
        else:
            log(out_dir, f"  ✗ {stem}: SUBMIT FAILED HTTP {status} — {str(resp)[:200]}")
            runs.append({
                "stem": stem,
                "runId": None,
                "briefLen": len(text),
                "status": "SUBMIT_FAILED",
                "error": resp,
            })

    (out_dir / "runs.json").write_text(json.dumps(runs, indent=2))

    submitted = [r for r in runs if r["runId"]]
    log(out_dir, f"SUBMITTED {len(submitted)}/{len(BRIEFS)}; polling…")

    # ─── Poll until all terminal ────────────────────────────────────────────
    start_ts = time.time()
    last_status = {r["stem"]: "" for r in submitted}
    finals = {}
    while time.time() - start_ts < HARD_TIMEOUT_SEC:
        all_done = True
        for r in submitted:
            if r["stem"] in finals:
                continue
            status, data = http_request(
                "GET",
                f"{BASE_URL}/api/brief-to-ifc/v3/runs/{r['runId']}/status",
                cookie=cookie,
                timeout=30,
            )
            if status != 200:
                log(out_dir, f"  status poll error for {r['stem']}: HTTP {status}")
                all_done = False
                continue
            cur = data.get("status", "?")
            if cur != last_status[r["stem"]]:
                cost = data.get("generatorCostUsd", 0)
                turns = data.get("turns", 0)
                log(out_dir, f"  {r['stem']}: {cur} cost=${cost} turns={turns}")
                last_status[r["stem"]] = cur
            if cur in ("COMPLETED", "FAILED", "CANCELLED"):
                finals[r["stem"]] = data
            else:
                all_done = False
        if all_done:
            break
        time.sleep(POLL_INTERVAL_SEC)

    # ─── Save final state + download IFCs + fetch logs ─────────────────────
    for r in submitted:
        stem = r["stem"]
        if stem not in finals:
            log(out_dir, f"  ⏱ {stem}: still RUNNING at timeout")
            # Get latest status anyway
            status, data = http_request(
                "GET", f"{BASE_URL}/api/brief-to-ifc/v3/runs/{r['runId']}/status",
                cookie=cookie, timeout=30,
            )
            if status == 200:
                finals[stem] = data
        final = finals.get(stem, {})
        (out_dir / f"{stem}-status.json").write_text(json.dumps(final, indent=2))

        # Logs
        log_status, log_data = http_request(
            "GET", f"{BASE_URL}/api/brief-to-ifc/v3/runs/{r['runId']}/logs",
            cookie=cookie, timeout=60,
        )
        (out_dir / f"{stem}-logs.json").write_text(
            json.dumps({"http": log_status, "logs": log_data}, indent=2)
        )

        # Download IFC
        ifc_url = final.get("ifcUrl")
        if final.get("status") == "COMPLETED" and ifc_url:
            log(out_dir, f"  ⬇ {stem}: downloading IFC from R2")
            try:
                with urllib.request.urlopen(ifc_url, timeout=60) as resp:
                    ifc_bytes = resp.read()
                (out_dir / f"{stem}.ifc").write_bytes(ifc_bytes)
                log(out_dir, f"  ✓ {stem}: {len(ifc_bytes)} bytes, entities={final.get('entityCount')}, cost=${final.get('generatorCostUsd')}, turns={final.get('turns')}")
            except Exception as e:
                log(out_dir, f"  ✗ {stem}: download error: {e}")
        else:
            log(out_dir, f"  ✗ {stem}: NOT DOWNLOADED — status={final.get('status')} errCode={final.get('errorCode')} errMsg={final.get('errorMessage')}")

    # ─── Summary ────────────────────────────────────────────────────────────
    log(out_dir, "─── SUMMARY ───")
    total_cost = 0.0
    completed = 0
    for r in submitted:
        stem = r["stem"]
        final = finals.get(stem, {})
        cost = final.get("generatorCostUsd", 0) or 0
        total_cost += cost
        status = final.get("status", "?")
        entities = final.get("entityCount", 0) or 0
        ms = final.get("generatorMs", 0) or 0
        log(out_dir, f"  {stem}: {status} entities={entities} time={ms / 1000:.1f}s cost=${cost:.3f}")
        if status == "COMPLETED":
            completed += 1
    log(out_dir, f"TOTAL: {completed}/{len(submitted)} completed, total spend ${total_cost:.3f}")


if __name__ == "__main__":
    main()
