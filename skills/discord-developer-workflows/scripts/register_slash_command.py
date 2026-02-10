#!/usr/bin/env python3
"""
Register a single Discord slash command to guild or global scope.

Usage example:
  python3 scripts/register_slash_command.py \
    --app-id "$DISCORD_APP_ID" \
    --token "$DISCORD_TOKEN" \
    --guild-id "$DISCORD_GUILD_ID" \
    --name verify \
    --description "Verify your registration." \
    --option email:string:false:"Your registration email."
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request


def parse_option(raw: str) -> dict:
    """
    Parse option format: name:type:required:description
    Supported types: string, integer, boolean, user, channel, role, mentionable, number
    """
    parts = raw.split(":", 3)
    if len(parts) != 4:
        raise ValueError(
            "Invalid --option format. Expected name:type:required:description"
        )

    name, type_name, required_raw, description = parts
    type_map = {
        "string": 3,
        "integer": 4,
        "boolean": 5,
        "user": 6,
        "channel": 7,
        "role": 8,
        "mentionable": 9,
        "number": 10,
    }
    if type_name not in type_map:
        raise ValueError(f"Unsupported option type: {type_name}")

    required = required_raw.lower() in {"1", "true", "yes", "y"}
    return {
        "type": type_map[type_name],
        "name": name,
        "description": description,
        "required": required,
    }


def build_url(app_id: str, guild_id: str | None) -> str:
    base = "https://discord.com/api/v10/applications"
    if guild_id:
        return f"{base}/{app_id}/guilds/{guild_id}/commands"
    return f"{base}/{app_id}/commands"


def register_command(
    url: str, token: str, payload: list[dict], dry_run: bool = False
) -> int:
    if dry_run:
        print("Dry run; skipping API call.")
        print(json.dumps(payload, indent=2))
        return 0

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="PUT",
        headers={
            "Authorization": f"Bot {token}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req) as res:
            print(f"Status: {res.status}")
            data = res.read().decode("utf-8")
            print(data)
        return 0
    except urllib.error.HTTPError as err:
        error_body = err.read().decode("utf-8", errors="replace")
        print(f"HTTP {err.code}: {error_body}", file=sys.stderr)
        return 1
    except urllib.error.URLError as err:
        print(f"Network error: {err}", file=sys.stderr)
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Register one Discord slash command using the REST API."
    )
    parser.add_argument("--app-id", required=True, help="Discord application ID")
    parser.add_argument("--token", required=True, help="Discord bot token")
    parser.add_argument(
        "--guild-id",
        help="Optional guild ID. Omit for global command registration.",
    )
    parser.add_argument("--name", required=True, help="Slash command name")
    parser.add_argument("--description", required=True, help="Slash command description")
    parser.add_argument(
        "--option",
        action="append",
        default=[],
        help="Option in format name:type:required:description",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print payload and skip API call.",
    )
    args = parser.parse_args()

    options = [parse_option(raw) for raw in args.option]
    payload = [
        {
            "name": args.name,
            "description": args.description,
            "type": 1,
            "options": options,
        }
    ]

    url = build_url(args.app_id, args.guild_id)
    print(f"Target URL: {url}")
    return register_command(url, args.token, payload, dry_run=args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
