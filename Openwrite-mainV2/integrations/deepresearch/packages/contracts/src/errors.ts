// 共享错误类。所有模块抛出和捕获时用这些。

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class IsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IsolationError";
  }
}

export class MockNotFoundError extends NotFoundError {
  constructor(entity: string, id: string) {
    super(entity, id);
    this.name = "MockNotFoundError";
  }
}

export class MockUnimplementedError extends Error {
  constructor(method: string) {
    super(`MockUnimplementedError: ${method} not yet implemented`);
    this.name = "MockUnimplementedError";
  }
}
