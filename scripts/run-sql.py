#!/usr/bin/env python
"""
Run a .sql file against the E Space database.

Why this exists rather than a one-line psycopg call: applying schema to a
database with real people's bookings in it should be boring and repeatable, and
the parts that make it boring are easy to skip when typing a command by hand.

  - Everything runs inside ONE transaction. Postgres does transactional DDL, so
    a file that fails on statement nine leaves the database exactly as it was
    rather than nine-tenths migrated, which is the state nobody knows how to
    recover from.

  - Destructive statements are refused unless they are asked for explicitly.
    Creating tables and dropping them are one keystroke apart in a file, and the
    difference only matters once.

  - Nothing runs without --apply. The default is to read the file, say what it
    would do, and stop.

Usage:
    python scripts/run-sql.py ../e-space/SUPABASE_APPLY_MISSING.sql
    python scripts/run-sql.py ../e-space/SUPABASE_APPLY_MISSING.sql --apply
"""

import argparse
import os
import re
import sys

try:
    import psycopg
except ImportError:
    sys.exit("psycopg is not installed:  pip install 'psycopg[binary]'")


def load_env(path=".env.local"):
    """Read the connection string without dragging in a dependency."""
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    target = os.path.join(here, path)
    env = {}
    if os.path.exists(target):
        for line in open(target, encoding="utf-8"):
            match = re.match(r"\s*([A-Za-z_0-9]+)\s*=\s*(.+?)\s*$", line)
            if match:
                env.setdefault(match.group(1), match.group(2).strip().strip("\"'"))
    return env


def strip_comments(sql: str) -> str:
    """
    Comments out, so the scan below reads code rather than prose.

    Worth doing properly: a first pass at this matched the word "update" inside
    `updated_at timestamptz` and inside a comment explaining what not to update,
    and reported two purely additive files as data-modifying.
    """
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    sql = re.sub(r"--[^\n]*", " ", sql)
    return sql


DESTRUCTIVE = re.compile(
    r"(?is)(?:^|;)\s*(delete\s+from|truncate|drop\s+(?:table|schema|database|column)"
    r"|alter\s+table\s+\S+\s+drop\s+column|update\s+\w)"
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("file")
    parser.add_argument("--apply", action="store_true", help="actually run it")
    parser.add_argument(
        "--allow-destructive",
        action="store_true",
        help="permit DELETE / UPDATE / DROP / TRUNCATE (say why in the commit)",
    )
    args = parser.parse_args()

    sql = open(args.file, encoding="utf-8").read()
    code = strip_comments(sql)

    hits = [m.group(1).strip() for m in DESTRUCTIVE.finditer(code)]
    statements = len([s for s in code.split(";") if s.strip()])

    print(f"file        : {args.file}")
    print(f"statements  : {statements}")
    print(f"destructive : {', '.join(sorted(set(h.lower() for h in hits))) if hits else 'none'}")

    if hits and not args.allow_destructive:
        sys.exit(
            "\nREFUSED. This file changes or removes existing data.\n"
            "Read it, decide it is what you want, then pass --allow-destructive."
        )

    env = load_env()
    url = env.get("SUPABASE_DB_URL", "")
    if not url:
        sys.exit("SUPABASE_DB_URL is not set in espace-admin/.env.local")
    if "REPLACE_WITH" in url:
        sys.exit(
            "SUPABASE_DB_URL still holds the placeholder password.\n"
            "Supabase never displays an existing one -- reset it under\n"
            "Project Settings -> Database -> Reset database password."
        )

    if not args.apply:
        print("\nDry run. Nothing was sent. Add --apply to run it.")
        return

    sep = "?" if "?" not in url else "&"
    with psycopg.connect(f"{url}{sep}connect_timeout=15&sslmode=require") as conn:
        who = conn.execute("select current_user, current_database()").fetchone()
        print(f"\nconnected as {who[0]} on {who[1]}")

        with conn.cursor() as cur:
            # One call, one transaction. psycopg commits on a clean exit from
            # the connection block and rolls back if anything raises.
            cur.execute(sql)

            # Walk the result sets so the check queries at the end of a file
            # actually print something.
            while True:
                if cur.description:
                    cols = [d.name for d in cur.description]
                    for row in cur.fetchall():
                        print("  " + " | ".join(f"{c}={v}" for c, v in zip(cols, row)))
                if not cur.nextset():
                    break

    print("\nCommitted.")


if __name__ == "__main__":
    main()
