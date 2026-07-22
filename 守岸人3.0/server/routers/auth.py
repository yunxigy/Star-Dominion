"""Retired legacy authentication routes.

Authentication is owned by the root site-auth service. This router is kept only
for an explicit migration response if an old deployment still includes it.
"""

from fastapi import APIRouter, HTTPException


router = APIRouter(prefix="/api/auth", tags=["legacy-auth"])


def _retired() -> None:
    raise HTTPException(
        status_code=410,
        detail="该登录接口已停用，请使用全站统一登录页",
    )


@router.post("/register")
def register() -> None:
    _retired()


@router.post("/login")
def login() -> None:
    _retired()


@router.post("/refresh")
def refresh() -> None:
    _retired()
