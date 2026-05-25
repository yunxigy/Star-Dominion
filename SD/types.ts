export interface StarPavilion {
  id: string;
  name: string;
  companyName: string;
  tag: string;
  description: string;
  icon: string;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  icon: string;
}

export enum PlanStatus {
  TODO = 'TODO',
  DOING = 'DOING',
  DONE = 'DONE',
  SHELVED = 'SHELVED'
}

export interface Plan {
  id: string;
  text: string;
  status: PlanStatus;
  action?: () => void;
}

export interface VitsSong {
  id: string;
  title: string;
  url: string;
}

export interface FlowerQuote {
  id: string;
  content: string;
  source?: string;
}
