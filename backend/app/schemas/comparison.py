"""Comparison schemas for API responses."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.schemas.common import (
    ComparisonSource as CommonComparisonSource,
    ComparisonResultResponse as CommonComparisonResultResponse,
    ComparisonResponse as CommonComparisonResponse,
    ComparisonSummary as CommonComparisonSummary,
    ComparisonCreateRequest as CommonComparisonCreateRequest,
    ComparisonCreateResponse as CommonComparisonCreateResponse,
)

# Re-export common schemas with from_attributes config for ORM models


class ComparisonSourceResponse(CommonComparisonSource):
    """A single source/citation in a comparison result."""

    model_config = ConfigDict(from_attributes=True)


class ComparisonResultResponse(CommonComparisonResultResponse):
    """Per-document result within a comparison."""

    model_config = ConfigDict(from_attributes=True)


class ComparisonResponse(CommonComparisonResponse):
    """Full comparison response."""

    model_config = ConfigDict(from_attributes=True)


class ComparisonSummary(CommonComparisonSummary):
    """Summary for listing comparisons."""

    model_config = ConfigDict(from_attributes=True)


class ComparisonCreateRequest(CommonComparisonCreateRequest):
    """Request to create a new comparison."""


class ComparisonCreateResponse(CommonComparisonCreateResponse):
    """Response after creating a comparison (async)."""