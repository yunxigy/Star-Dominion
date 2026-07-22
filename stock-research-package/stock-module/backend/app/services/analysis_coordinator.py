"""Bounded background orchestration for detailed individual-stock reports."""

import asyncio
from concurrent.futures import Executor, ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Protocol

from app.domain.analysis_tasks import AnalysisCreate, AnalysisTask, cache_key
from app.domain.model_profiles import StoredModelProfile
from app.repositories.analysis_tasks import AnalysisTaskRepository
from app.security.route_tokens import RouteTokenIssuer


class AnalysisClient(Protocol):
    async def analyze(self, symbol: str, **request: object) -> dict: ...


class AnalysisProfiles(Protocol):
    def get_available_record(self, profile_id: str) -> StoredModelProfile: ...


class AnalysisCoordinator:
    def __init__(
        self,
        repository: AnalysisTaskRepository,
        profiles: AnalysisProfiles,
        client: AnalysisClient,
        route_issuer: RouteTokenIssuer,
        *,
        owner_id: str,
        executor: Executor | None = None,
    ) -> None:
        self._repository = repository
        self._profiles = profiles
        self._client = client
        self._route_issuer = route_issuer
        self._owner_id = owner_id
        self._owns_executor = executor is None
        self._executor = executor or ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="stock-analysis"
        )
        self._repository.recover_incomplete()

    def start(
        self,
        request: AnalysisCreate,
        *,
        owner_id: str | None = None,
        profiles: AnalysisProfiles | None = None,
    ) -> AnalysisTask:
        request_owner = owner_id or self._owner_id
        profile = (profiles or self._profiles).get_available_record(request.profile_id)
        if not profile.enabled:
            raise LookupError("model profile is disabled")
        task = self._repository.create(
            request,
            owner_id=request_owner,
            profile=profile,
        )
        key = self._cache_key(task)
        if not request.force_refresh:
            cached = self._repository.get_cache(key)
            if cached is not None:
                now = datetime.now(UTC)
                task.state = "succeeded"
                task.progress_message = "已使用缓存报告"
                task.cache_hit = True
                task.report, task.upstream_query_id = cached
                task.started_at = now
                task.finished_at = now
                self._repository.save(task)
                return task
        self._executor.submit(self.run, task.task_id, request_owner)
        return task

    def get(self, task_id: str, *, owner_id: str | None = None) -> AnalysisTask | None:
        return self._repository.get(task_id, owner_id=owner_id or self._owner_id)

    def run(self, task_id: str, owner_id: str | None = None) -> None:
        task = self._repository.get(task_id, owner_id=owner_id or self._owner_id)
        if task is None:
            return
        try:
            task.state = "collecting"
            task.progress_message = "正在采集股票数据"
            task.started_at = datetime.now(UTC)
            self._repository.save(task)

            route_owner = "platform" if task.profile_scope == "platform" else task.owner_id
            route_token = self._route_issuer.issue(
                task_id=task.task_id,
                profile_id=task.profile_id,
                owner_id=route_owner,
                model=task.model,
                ttl_seconds=300,
            )
            task.state = "analyzing"
            task.progress_message = "大模型正在分析"
            self._repository.save(task)
            result = asyncio.run(
                self._client.analyze(
                    task.symbol,
                    report_type=task.report_type,
                    force_refresh=task.force_refresh,
                    async_mode=False,
                    notify=False,
                    report_language="zh",
                    model=task.model,
                    model_route_token=route_token,
                )
            )
            if not result.get("success", True) or not isinstance(result.get("report"), dict):
                raise RuntimeError("analysis adapter returned no report")

            task.state = "rendering"
            task.progress_message = "正在整理分析报告"
            self._repository.save(task)
            task.report = result["report"]
            task.upstream_query_id = _optional_text(result.get("query_id"))
            task.state = "succeeded"
            task.progress_message = "分析完成"
            task.finished_at = datetime.now(UTC)
            self._repository.save_cache(
                self._cache_key(task),
                task.report,
                upstream_query_id=task.upstream_query_id,
            )
        except Exception:
            task.state = "failed"
            task.progress_message = "分析失败"
            task.error_code = "ANALYSIS_UPSTREAM_FAILED"
            task.error_message = "个股分析服务暂时不可用，请稍后重试"
            task.report = None
            task.finished_at = datetime.now(UTC)
        self._repository.save(task)

    def shutdown(self) -> None:
        if self._owns_executor and isinstance(self._executor, ThreadPoolExecutor):
            self._executor.shutdown(wait=False, cancel_futures=False)

    def _cache_key(self, task: AnalysisTask) -> str:
        cache_owner = "platform" if task.profile_scope == "platform" else task.owner_id
        return cache_key(
            owner=cache_owner,
            symbol=task.symbol,
            profile=task.profile_id,
            model=task.model,
            report=task.report_type,
        )


def _optional_text(value: object) -> str | None:
    return str(value) if value is not None else None
