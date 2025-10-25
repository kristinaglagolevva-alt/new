export type NavigationPage = 
  | 'management' 
  | 'estimation' 
  | 'directory' 
  | 'projects' 
  | 'tasks' 
  | 'templates' 
  | 'documents' 
  | 'settings';

export interface DirectoryFocus {
  section?: 'general' | 'legal' | 'individual' | 'contract' | 'contracts';
  performerId?: string;
  legalEntityId?: string;
  contractId?: string;
}
