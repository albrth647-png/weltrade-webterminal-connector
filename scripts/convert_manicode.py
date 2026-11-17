#!/usr/bin/env python3
"""Convert Freebuff/manicode chat sessions to Claude Code JSONL for Longhand.

Freebuff stores sessions as manicode chat-messages.json (a flat list of
user/ai messages with text + tool blocks). Longhand only ingests Claude Code
JSONL. This converter bridges the gap without modifying Longhand internals.

Usage:
    python3 scripts/convert_manicode.py [manicode_projects_dir] [out_dir]

Defaults:
    manicode_projects_dir = ~/.config/manicode/projects
    out_dir               = ~/.longhand/manicode_jsonl
"""
import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

MANICODE_DEFAULT = Path.home() / ".config" / "manicode" / "projects"
OUT_DEFAULT = Path.home() / ".longhand" / "manicode_jsonl"


def _parse_base_date(folder_name: str) -> datetime:
    # folder like "2026-11-10T04-57-56.610Z"
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})", folder_name)
    if m:
        y, mo, d, h, mi, s = m.groups()
        return datetime(int(y), int(mo), int(d), int(h), int(mi), int(s), tzinfo=timezone.utc)
    return datetime.now(timezone.utc)


def _parse_time_str(s: str) -> timedelta | None:
    # "07:39 PM" / "12:05 AM"
    s = (s or "").strip()
    m = re.match(r"(\d{1,2}):(\d{2})\s*(AM|PM)", s, re.I)
    if not m:
        return None
    h, mi, ap = int(m.group(1)), int(m.group(2)), m.group(3).upper()
    if ap == "PM" and h != 12:
        h += 12
    if ap == "AM" and h == 12:
        h = 0
    return timedelta(hours=h, minutes=mi)


def convert_chat(chat_dir: Path, out_dir: Path) -> Path | None:
    meta_path = chat_dir / "chat-meta.json"
    msgs_path = chat_dir / "chat-messages.json"
    if not msgs_path.exists():
        return None
    try:
        msgs = json.load(open(msgs_path))
    except Exception:
        return None
    if not isinstance(msgs, list) or not msgs:
        return None

    meta = {}
    if meta_path.exists():
        try:
            meta = json.load(open(meta_path))
        except Exception:
            meta = {}

    project = chat_dir.parent.name  # e.g. weltrade-webterminal-connector
    project_path = f"/root/{project}" if project not in ("root",) else "/root"
    # better: infer from manicode project dir name
    if project == "root":
        project_path = "/root"
    session_id = f"manicode-{chat_dir.name}"
    base_dt = _parse_base_date(chat_dir.name)

    # first prompt for title
    first_user = next((m.get("content", "") for m in msgs if m.get("variant") == "user" and m.get("content")), "")

    out_lines = []
    seq = 0
    cur_dt = base_dt

    for m in msgs:
        variant = m.get("variant")
        ts_str = m.get("timestamp", "")
        td = _parse_time_str(ts_str)
        if td is not None:
            cur_dt = base_dt.replace(hour=0, minute=0, second=0, microsecond=0) + td
            # if time went backwards (next day), bump a day
            if cur_dt < base_dt - timedelta(hours=12):
                cur_dt = cur_dt + timedelta(days=1)
        ts_iso = cur_dt.isoformat().replace("+00:00", "Z")

        uid = m.get("id") or f"mc-{seq}"

        if variant == "user":
            content = m.get("content", "")
            if not isinstance(content, str) or not content.strip():
                continue
            entry = {
                "type": "user",
                "uuid": uid,
                "sessionId": session_id,
                "timestamp": ts_iso,
                "cwd": project_path,
                "gitBranch": None,
                "isSidechain": False,
                "message": {"role": "user", "content": content},
            }
            out_lines.append(json.dumps(entry, ensure_ascii=False))
            seq += 1

        elif variant == "ai":
            # text blocks -> assistant text
            for b in m.get("blocks", []):
                if b.get("type") == "text" and b.get("content"):
                    entry = {
                        "type": "assistant",
                        "uuid": f"{uid}-text-{seq}",
                        "sessionId": session_id,
                        "timestamp": ts_iso,
                        "cwd": project_path,
                        "gitBranch": None,
                        "isSidechain": False,
                        "message": {
                            "role": "assistant",
                            "model": "freebuff",
                            "content": [{"type": "text", "text": b["content"]}],
                        },
                    }
                    out_lines.append(json.dumps(entry, ensure_ascii=False))
                    seq += 1

            # tool blocks -> assistant tool_use + user tool_result
            for b in m.get("blocks", []):
                if b.get("type") != "tool":
                    continue
                tool_name = b.get("toolName", "tool")
                tool_input = b.get("input", {}) or {}
                tool_id = b.get("toolCallId") or f"tool-{seq}"
                output = b.get("output", "")
                # assistant tool_use
                entry = {
                    "type": "assistant",
                    "uuid": f"{uid}-tooluse-{seq}",
                    "sessionId": session_id,
                    "timestamp": ts_iso,
                    "cwd": project_path,
                    "gitBranch": None,
                    "isSidechain": False,
                    "message": {
                        "role": "assistant",
                        "model": "freebuff",
                        "content": [{
                            "type": "tool_use",
                            "id": tool_id,
                            "name": tool_name,
                            "input": tool_input,
                        }],
                    },
                }
                out_lines.append(json.dumps(entry, ensure_ascii=False))
                seq += 1
                # user tool_result
                entry = {
                    "type": "user",
                    "uuid": f"{uid}-toolresult-{seq}",
                    "sessionId": session_id,
                    "timestamp": ts_iso,
                    "cwd": project_path,
                    "gitBranch": None,
                    "isSidechain": False,
                    "message": {
                        "role": "user",
                        "content": [{
                            "type": "tool_result",
                            "tool_use_id": tool_id,
                            "content": output if isinstance(output, str) else json.dumps(output),
                        }],
                    },
                }
                out_lines.append(json.dumps(entry, ensure_ascii=False))
                seq += 1

        elif variant == "error":
            content = m.get("content", "")
            if isinstance(content, str) and content.strip():
                entry = {
                    "type": "user",
                    "uuid": uid,
                    "sessionId": session_id,
                    "timestamp": ts_iso,
                    "cwd": project_path,
                    "gitBranch": None,
                    "isSidechain": False,
                    "message": {"role": "user", "content": f"[error] {content}"},
                }
                out_lines.append(json.dumps(entry, ensure_ascii=False))
                seq += 1

    if not out_lines:
        return None

    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{session_id}.jsonl"
    out_file.write_text("\n".join(out_lines) + "\n", encoding="utf-8")
    return out_file


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else MANICODE_DEFAULT
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else OUT_DEFAULT
    dst.mkdir(parents=True, exist_ok=True)
    converted = 0
    for project_dir in sorted(src.iterdir()):
        if not project_dir.is_dir():
            continue
        chats_dir = project_dir / "chats"
        if not chats_dir.exists():
            continue
        for chat_dir in sorted(chats_dir.iterdir()):
            if not chat_dir.is_dir():
                continue
            out = convert_chat(chat_dir, dst)
            if out:
                converted += 1
                print(f"converted: {chat_dir.name} -> {out.name}")
    print(f"\ntotal converted: {converted}")


if __name__ == "__main__":
    main()
PY