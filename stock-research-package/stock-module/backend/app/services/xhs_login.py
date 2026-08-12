"""Administrator-controlled Xiaohongshu QR login flow."""


class XhsLoginService:
    def __init__(self, client) -> None:
        self._client = client

    async def start(self) -> dict:
        try:
            return await self._client.call("xhs_add_account", {})
        except Exception as exc:
            return {"status": "unavailable", "message": f"小红书登录窗口无法启动：{str(exc)[:180]}"}

    async def poll(self, session_id: str) -> dict:
        try:
            return await self._client.call(
                "xhs_check_login_session",
                {"sessionId": session_id},
            )
        except Exception as exc:
            return {"status": "unavailable", "message": f"小红书登录状态无法读取：{str(exc)[:180]}"}

    async def status(self) -> dict:
        try:
            return await self._client.call("xhs_check_auth_status", {})
        except Exception as exc:
            return {
                "status": "unavailable",
                "authenticated": False,
                "message": f"小红书登录服务暂不可用：{str(exc)[:180]}",
            }
