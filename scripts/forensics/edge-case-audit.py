#!/usr/bin/env python3
"""
API-level edge case audit for /api/brief-to-ifc/v3/runs.

What's testable from CLI:
  - Short brief (<40 chars)
  - Empty brief
  - Very long brief (>20000 chars)
  - Malformed gibberish brief (passes length, fails content)

What's NOT testable from CLI (documented in the report as "needs
manual UI test"): PDF upload, DOCX upload, canvas UI flow.

Usage: python3 edge-case-audit.py <cookie-file> <out-dir>
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

BASE_URL = os.environ.get("BASE_URL", "https://trybuildflow.in")

EDGE_CASES = [
    {
        "name": "short-brief",
        "body": {"brief": "Too short."},
        "expected_status": 400,
        "expected_keywords": ["brief", "min", "40"],
        "notes": "Schema z.string().min(40) should reject this before any AI spend.",
    },
    {
        "name": "empty-body",
        "body": {},
        "expected_status": 400,
        "expected_keywords": ["brief", "briefSpec", "required"],
        "notes": "Schema .refine() requires either `brief` or `briefSpec` to be set.",
    },
    {
        "name": "empty-brief-string",
        "body": {"brief": ""},
        "expected_status": 400,
        "expected_keywords": ["brief", "min", "40"],
        "notes": "Empty string fails min(40) — also fails refine() because Boolean('') is false.",
    },
    {
        "name": "very-long-brief",
        # 21000 chars — over max(20000)
        "body": {"brief": ("A small minimalist studio with a wooden floor. " * 500)[:21000]},
        "expected_status": 400,
        "expected_keywords": ["max", "20000"],
        "notes": "Schema z.string().max(20000) caps brief length to prevent runaway costs.",
    },
    {
        "name": "malformed-gibberish",
        # 100+ chars but content is nonsense. Passes schema, fails enrichment intent.
        "body": {
            "brief": (
                "lorem ipsum dolor sit amet asdfasdf qwerty 123456 lkjhgfdsa "
                "asdfgh jklzxc vbnmqw ertyui opasdf jklzxc vbnmqw ertyui opasdf "
                "jklzxc vbnmqw ertyui opasdf jklzxc vbnmqw ertyui opasdf"
            ),
        },
        "expected_status": 202,
        "expected_keywords": ["runId"],
        "notes": (
            "Passes schema (>40 chars). The enrichment layer may still produce "
            "a BriefSpec (faithful to input — so likely a near-empty spec). "
            "The agent then either succeeds with a degenerate room or fails. "
            "Documents the 'no-compromise' floor: what happens when the user "
            "types junk."
        ),
    },
]


def http_request(method, url, *, cookie, body=None):
    headers = {"Cookie": f"__Secure-authjs.session-token={cookie}"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(body_text)
        except Exception:
            return e.code, {"raw": body_text[:1000]}


def main():
    if len(sys.argv) < 3:
        print("usage: edge-case-audit.py <cookie-file> <out-dir>", file=sys.stderr)
        sys.exit(2)
    cookie = Path(sys.argv[1]).read_text().strip()
    out_dir = Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)

    results = []
    for case in EDGE_CASES:
        print(f"→ {case['name']}", flush=True)
        status, resp = http_request(
            "POST",
            f"{BASE_URL}/api/brief-to-ifc/v3/runs",
            cookie=cookie,
            body=case["body"],
        )
        # Don't sleep waiting on gibberish; capture the submit-time response only.
        # If it 202'd we just record the runId — we'll mark it for later cleanup
        # observation but won't poll inside this script.
        body_text = json.dumps(resp)
        keywords_found = [k for k in case["expected_keywords"] if k.lower() in body_text.lower()]
        ok = (
            status == case["expected_status"]
            and len(keywords_found) >= 1
        )
        results.append({
            "name": case["name"],
            "expected_status": case["expected_status"],
            "actual_status": status,
            "expected_keywords": case["expected_keywords"],
            "keywords_found": keywords_found,
            "ok": ok,
            "response": resp,
            "notes": case["notes"],
        })
        print(f"  HTTP {status} (expected {case['expected_status']}) — {'OK' if ok else 'MISMATCH'}", flush=True)
        time.sleep(1)  # polite

    out_path = out_dir / "edge-case-results.json"
    out_path.write_text(json.dumps({
        "ranAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "baseUrl": BASE_URL,
        "results": results,
    }, indent=2))
    print(f"\nSaved {out_path}", flush=True)

    passed = sum(1 for r in results if r["ok"])
    print(f"PASS: {passed}/{len(results)}", flush=True)


if __name__ == "__main__":
    main()
