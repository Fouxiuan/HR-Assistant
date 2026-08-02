export interface SettingsSectionHandle {
  save(): Promise<void>;
}

export interface SettingsSectionProps {
  embedded?: boolean;
  onDirtyChange?(dirty: boolean): void;
}
