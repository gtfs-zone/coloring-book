export type GTFSPresence =
  | 'Required'
  | 'Optional'
  | 'Conditionally Required'
  | 'Conditionally Forbidden'
  | 'Recommended';

export interface GTFSEnumValue {
  value: number | string;
  label: string;
  description: string;
}

export interface GTFSFieldSpec {
  name: string;
  type: string;
  presence: GTFSPresence;
  presenceCondition?: string;
  description: string;
  isPrimaryKey?: boolean;
  allowEmpty?: boolean;
  foreignKey?: { file: string; field: string };
  enumValues?: GTFSEnumValue[];
}

export interface GTFSFileSpec {
  filename: string;
  format?: 'csv' | 'geojson';
  presence: GTFSPresence;
  presenceCondition?: string;
  description: string;
  fields?: GTFSFieldSpec[];
}

export interface GTFSSpec {
  specVersion: string;
  files: GTFSFileSpec[];
}
