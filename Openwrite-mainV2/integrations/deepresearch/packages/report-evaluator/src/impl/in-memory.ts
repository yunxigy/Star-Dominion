import { BaseReporterService } from "../reporter-base.js";
import type { BaseReporterOptions } from "../types.js";

export type InMemoryReporterOptions = BaseReporterOptions;

export class InMemoryReporterService extends BaseReporterService {}
