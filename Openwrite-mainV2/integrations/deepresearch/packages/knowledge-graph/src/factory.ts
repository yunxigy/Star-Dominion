import type { KgService } from "@deepresearch/contracts";
import { BaseKgService, FixtureKgService, InMemoryKgService, type KgFactoryOptions } from "./kg-service-base.js";

export function createFixtureKgService(opts?: KgFactoryOptions): KgService {
  return new FixtureKgService(opts);
}

export function createInMemoryKgService(opts?: KgFactoryOptions): KgService {
  return new InMemoryKgService(opts);
}

export { BaseKgService, FixtureKgService, InMemoryKgService };
export type { KgFactoryOptions };
