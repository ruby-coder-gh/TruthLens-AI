"""CLI entry point: `python -m app.demo seed [--reset]`."""

from __future__ import annotations

import argparse
import asyncio
import sys

from app.demo.seed import DemoPasswordMissing, seed
from app.utils.logger import logger, setup_logging


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.demo")
    subparsers = parser.add_subparsers(dest="command", required=True)

    seed_parser = subparsers.add_parser("seed", help="Seed the demo workspace")
    seed_parser.add_argument(
        "--reset", action="store_true", help="Tear down and reseed the demo workspace"
    )

    args = parser.parse_args(argv)

    if args.command == "seed":
        setup_logging()
        try:
            result = asyncio.run(seed(reset=args.reset))
        except DemoPasswordMissing as e:
            print(f"error: {e}", file=sys.stderr)
            return 1
        logger.info("demo_seed_cli_done", workspace_id=result["workspace_id"])
        print(f"Demo workspace ready: {result['workspace_id']}")
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
