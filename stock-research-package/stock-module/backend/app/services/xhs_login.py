"""Administrator-controlled Xiaohongshu QR login flow."""


class XhsLoginService:
    def __init__(self, client) -> None:
        self._client = client

    async def start(self) -> dict:
        return await self._client.call("xhs_add_account", {})

    async def poll(self, session_id: str) -> dict:
        return await self._client.call(
            "xhs_check_login_session",
            {"sessionId": session_id},
        )

    async def status(self) -> dict:
        return await self._client.call("xhs_check_auth_status", {})
