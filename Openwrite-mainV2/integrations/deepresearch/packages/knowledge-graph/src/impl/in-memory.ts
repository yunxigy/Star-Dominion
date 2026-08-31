// @deepresearch/knowledge-graph
// InMemoryKgService：与 FixtureKgService 共享实现，差异只在是否默认加载 fixture。
// 真实场景下（生产环境或集成测试）用这个，调试或 demo 用 FixtureKgService。
// 实现了可序列化（toJSON / restore / serialize / restoreFromString），
// 方便做 episode 快照、断点续跑。

export {
  BaseKgService,
  InMemoryKgService,
  type KgSnapshot,
  type KgFactoryOptions,
} from "../kg-service-base.js";
