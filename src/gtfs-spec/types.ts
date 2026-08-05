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

export interface GTFSForeignKeyTarget {
  file: string;
  field: string;
}

export interface GTFSFieldSpec {
  name: string;
  /** Verbatim reference type string, including the compound "Foreign ID referencing `x.y`" forms. */
  type: string;
  presence: GTFSPresence;
  presenceCondition?: string;
  description: string;
  isPrimaryKey?: boolean;
  allowEmpty?: boolean;
  /** A few fields legitimately reference more than one table, hence the array. */
  foreignKey?: GTFSForeignKeyTarget[];
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
