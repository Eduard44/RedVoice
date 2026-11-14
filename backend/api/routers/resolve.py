"""RedVoice: send exported Script clips to the open DaVinci Resolve timeline.

The clips are files the user has just exported to a folder on this computer,
and Resolve must run on this computer too, so the route is loopback-only.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from services import resolve_timeline

from api.dependencies import require_native_access

logger = logging.getLogger("omnivoice.resolve")

router = APIRouter(dependencies=[Depends(require_native_access)])


class ResolveClip(BaseModel):
    file: str = Field(..., max_length=255)
    start_seconds: float | None = None
    duration_seconds: float | None = None


class ResolveSendRequest(BaseModel):
    folder: str = Field(..., max_length=4096)
    clips: list[ResolveClip] = Field(..., max_length=resolve_timeline.MAX_CLIPS)
    track_name: str = Field(resolve_timeline.TRACK_NAME, min_length=1, max_length=60)


class ResolveSendResult(BaseModel):
    ok: bool
    code: str | None = None
    timeline: str | None = None
    tracks: list[str] = []
    placed: int = 0
    files: list[str] = []
    warnings: list[str] = []


@router.post("/resolve/send", response_model=ResolveSendResult)
async def send_to_resolve(body: ResolveSendRequest) -> ResolveSendResult:
    """Import the clips into Resolve and place them on new audio tracks."""
    try:
        clips = resolve_timeline.parse_clips(body.folder, [clip.model_dump() for clip in body.clips])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    result = await asyncio.to_thread(resolve_timeline.send_to_resolve, clips, body.track_name)
    if not result.get("ok"):
        logger.warning("resolve send failed: code=%s detail=%s", result.get("code"),
                       str(result.get("detail") or "")[:200])
    return ResolveSendResult(
        ok=bool(result.get("ok")),
        code=None if result.get("ok") else str(result.get("code") or resolve_timeline.FAILED),
        timeline=result.get("timeline"),
        tracks=list(result.get("tracks") or []),
        placed=int(result.get("placed") or 0),
        files=list(result.get("files") or []),
        warnings=list(result.get("warnings") or []),
    )
