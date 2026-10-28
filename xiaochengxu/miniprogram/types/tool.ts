export type NativeToolCapability = 'local' | 'request' | 'file' | 'camera' | 'audio' | 'unsupported';

export type NativeToolStatus = 'ready' | 'adapting' | 'desktop-only';
export type NativeToolWorkbench = 'dev' | 'calculator' | 'text' | 'fun' | 'assessment' | 'tarot' | 'image' | 'converter' | 'document' | 'request' | 'webmaster' | 'video' | 'audio';

export interface NativeToolDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  capability: NativeToolCapability;
  route: string;
  status: NativeToolStatus;
  tags: string[];
  limitation?: string;
  workbench?: NativeToolWorkbench;
}

export interface NativeCategoryDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
}
