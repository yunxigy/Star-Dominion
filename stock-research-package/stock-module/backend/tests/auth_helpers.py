from app.security.site_auth import SiteIdentity


AUTH_COOKIES = {"sd_session": "test-session"}


class AuthenticatedSiteAuthClient:
    def __init__(self, *, role: str = "admin", user_id: str = "local") -> None:
        self.role = role
        self.user_id = user_id

    async def verify(self, *, session_token: str, **_: object) -> SiteIdentity:
        assert session_token == AUTH_COOKIES["sd_session"]
        return SiteIdentity(
            id=self.user_id,
            email=f"{self.user_id}@example.com",
            username=self.user_id,
            role=self.role,
        )
