
"""
A feature-rich CLI tool with multiple subcommands.
"""

import argparse
import logging
import sys
from functools import lru_cache
from pathlib import Path
from typing import Sequence


logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)


BOLD = "\033[1m"
GREEN = "\033[32m"
CYAN = "\033[36m"
YELLOW = "\033[33m"
RESET = "\033[0m"


def color(text: str, code: str) -> str:
    return f"{code}{text}{RESET}"


def greet(name: str = "World") -> str:
    """Return a greeting message."""
    return f"Hello, {name}!"


@lru_cache(maxsize=128)
def _fib(n: int) -> int:
    if n < 2:
        return n
    return _fib(n - 1) + _fib(n - 2)


def fibonacci(count: int) -> list[int]:
    """Return the first *count* Fibonacci numbers.  Negative → empty."""
    if count <= 0:
        return []
    return [_fib(i) for i in range(count)]


def count_words(filepath: Path) -> dict[str, int]:
    """Count lines, words, and characters in a text file."""
    text = filepath.read_text(encoding="utf-8")
    return {
        "lines": text.count("\n") + (1 if text and text[-1] != "\n" else 0),
        "words": len(text.split()),
        "chars": len(text),
    }


def evaluate(expression: str) -> float | int:
    """Safely evaluate a simple math expression."""
    allowed = set("0123456789+-*/%(). e")
    cleaned = expression.replace(" ", "")
    if not set(cleaned).issubset(allowed):
        raise ValueError(f"Expression contains disallowed characters: {cleaned!r}")
    return eval(cleaned, {"__builtins__": {}}, {})


def cmd_greet(args: argparse.Namespace) -> None:
    msg = greet(args.name)
    if args.loud:
        msg = msg.upper()
    print(color(msg, GREEN))


def cmd_fib(args: argparse.Namespace) -> None:
    if args.count < 1:
        print(color("Count must be a positive integer.", YELLOW))
        return
    seq = fibonacci(args.count)
    print(color(f"First {args.count} Fibonacci numbers:", CYAN))
    print(" ".join(str(n) for n in seq))


def cmd_wc(args: argparse.Namespace) -> None:
    path = Path(args.file)
    if not path.exists():
        log.error("File not found: %s", path)
        sys.exit(1)
    stats = count_words(path)
    print(color(f"Stats for {path}:", CYAN))
    for key, val in stats.items():
        print(f"  {key:<6} {val}")


def cmd_calc(args: argparse.Namespace) -> None:
    try:
        result = evaluate(args.expression)
    except (ValueError, SyntaxError) as exc:
        log.error("Cannot evaluate: %s", exc)
        sys.exit(1)
    print(color(f"{args.expression} = {result}", BOLD))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Feature-rich CLI demo script",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="Enable debug logging"
    )

    sub = parser.add_subparsers(dest="command", required=True)


    p_greet = sub.add_parser("greet", help="Print a greeting")
    p_greet.add_argument("name", nargs="?", default="World", help="Who to greet")
    p_greet.add_argument("--loud", action="store_true", help="SHOUT IT")


    p_fib = sub.add_parser("fib", help="Generate Fibonacci numbers")
    p_fib.add_argument(
        "count", type=int, nargs="?", default=10, help="How many numbers (default: 10)"
    )


    p_wc = sub.add_parser("wc", help="Count lines/words/chars in a file")
    p_wc.add_argument("file", help="Path to a text file")


    p_calc = sub.add_parser("calc", help="Evaluate a math expression")
    p_calc.add_argument("expression", help="Expression, e.g. '(3+4)*2'")

    return parser


def main(argv: Sequence[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
        log.debug("Verbose mode on")

    dispatch = {
        "greet": cmd_greet,
        "fib":   cmd_fib,
        "wc":    cmd_wc,
        "calc":  cmd_calc,
    }
    dispatch[args.command](args)


if __name__ == "__main__":
    main()
