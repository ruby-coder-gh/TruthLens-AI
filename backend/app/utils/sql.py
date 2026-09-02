"""Small SQL helpers shared by the API modules."""

from __future__ import annotations


def escape_like(value: str) -> str:
    """Escape SQL LIKE/ILIKE wildcards in a user-supplied value.

    Callers must pair this with an explicit ``escape="\\\\"`` on the
    ``like()``/``ilike()`` call, otherwise the backslashes are matched
    literally. Without it a user's ``%`` or ``_`` is a wildcard rather than the
    character they typed, so a substring filter silently becomes a pattern
    filter (``search=%`` matches every row).

    Backslash is escaped first — doing it last would double the backslashes
    this function just introduced.
    """
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
